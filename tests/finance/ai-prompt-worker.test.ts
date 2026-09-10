import { describe, expect, it, vi } from 'vitest'

import { freezeAiPromptInput, resolveAiInstructions } from '@/features/ai-settings/prompt'
import { createConfiguredDiagnosisRpcClient, createWorkerRpcCaller } from '@/features/diagnosis/worker-rpc'
import { processDiagnosisJob } from '@/features/diagnosis/worker'
import type { ClaimedDiagnosisJob, DiagnosisReport, DiagnosisSnapshot } from '@/features/diagnosis/types'

const config = {
  supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test',
  workerToken: 'a'.repeat(64), codexPath: '/usr/local/bin/codex', model: 'trusted-model',
}
const snapshot: DiagnosisSnapshot = {
  version: 1, month: '2026-08', asOf: '2026-09-10T00:00:00.000Z', sourceHash: 'source',
  current: { month: '2026-08', count: 0, income: 1, salary: 1, salaryCount: 1,
    expense: 0, saving: 0, comparableExpense: 0, otherIncome: 0, salaryRemainder: 1,
    totalRemainder: 1, savingsRate: 100 }, months: [],
  comparison: { previousExpense: null, expenseDelta: null, expenseChangeRate: null,
    baselineMonthCount: 0, expenseAverage: null, comparableExpenseAverage: null },
  categories: [], budget: { total: null, savingsRateTarget: null }, transactions: [], evidenceCount: 0,
}
const report: DiagnosisReport = {
  version: 1, headline: '확인', summary: '확인했어요.', changes: [],
  trend: { summary: '비교 자료가 없어요.', caveat: '기록 기준이에요.' }, checks: [],
  actions: [{ title: '계획', body: '다음 달 계획을 확인해요.' }], positive: null,
}

function frozenInput(common = '설정 A') {
  return freezeAiPromptInput(resolveAiInstructions({
    revision: 3, updatedAt: null, commonInstructions: common,
    ledgerInstructions: '원장 A', budgetInstructions: null,
  }, 'ledger'), {
    version: 'ledger-1', before: 'before', after: 'after', dataTag: 'snapshot',
  }, snapshot)
}

describe('prompt-capable diagnosis RPC adapter', () => {
  it('registers validated model and clamped timeout before configured claims', async () => {
    const requests: Array<{ name: string; body: Record<string, unknown> }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const name = String(input).split('/').at(-1)!
      const body = JSON.parse(String(init?.body))
      requests.push({ name, body })
      return new Response(JSON.stringify(name === 'claim_configured_diagnosis_job' ? null : true))
    }
    const rpc = createConfiguredDiagnosisRpcClient(config, fetcher)
    expect(await rpc.presence()).toBe(true)
    expect(await rpc.claim()).toBeNull()
    expect(requests).toEqual([
      { name: 'heartbeat_ai_worker', body: { p_token: config.workerToken, p_model: 'trusted-model', p_timeout_ms: 180_000 } },
      { name: 'claim_configured_diagnosis_job', body: { p_token: config.workerToken } },
    ])
  })

  it('falls back to the legacy claim only when the configured RPC is absent', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const name = String(input).split('/').at(-1)!
      calls.push(name)
      if (name === 'claim_configured_diagnosis_job') return new Response('{}', { status: 404 })
      return new Response('null')
    }
    expect(await createConfiguredDiagnosisRpcClient(config, fetcher).claim()).toBeNull()
    expect(calls).toEqual(['claim_configured_diagnosis_job', 'claim_diagnosis_job'])
  })

  it('keeps legacy-only deployments available when both prompt RPCs are absent', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const name = String(input).split('/').at(-1)!
      calls.push(name)
      if (name === 'heartbeat_ai_worker' || name === 'claim_configured_diagnosis_job') {
        return new Response('{}', { status: 404 })
      }
      return new Response('null')
    }
    const rpc = createConfiguredDiagnosisRpcClient(config, fetcher)
    expect(await rpc.presence()).toBe(true)
    expect(await rpc.claim()).toBeNull()
    expect(calls).toEqual(['heartbeat_ai_worker', 'claim_configured_diagnosis_job', 'claim_diagnosis_job'])
  })

  it.each([
    ['malformed configured response', async () => new Response('true')],
    ['generic upstream failure', async () => new Response('private', { status: 500 })],
  ])('does not downgrade %s to the legacy claim', async (_label, fetcher) => {
    const wrapped = vi.fn(fetcher as typeof fetch)
    await expect(createConfiguredDiagnosisRpcClient(config, wrapped).claim()).rejects.toThrow('rpc_failed')
    expect(wrapped).toHaveBeenCalledTimes(1)
  })

  it('keeps transport responses bounded and errors secret-safe', async () => {
    const call = createWorkerRpcCaller(config, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    await expect(call('heartbeat_ai_worker', {})).rejects.toMatchObject({ code: 'rpc_failed', message: 'rpc_failed' })
  })
})

describe('frozen diagnosis input', () => {
  it('passes enqueue-time input unchanged even if current defaults or settings change', async () => {
    const promptInput = frozenInput('설정 A')
    const job: ClaimedDiagnosisJob = { id: 'job-1', claimToken: 'claim-1', snapshot, promptInput }
    const changedInput = frozenInput('설정 B')
    const run = vi.fn(async (_snapshot, options) => {
      expect(options.promptInput).toEqual(promptInput)
      expect(options.promptInput).not.toEqual(changedInput)
      return report
    })
    const rpc = { claim: async () => job, heartbeat: async () => true, finish: async () => true }
    expect(await processDiagnosisJob(job, rpc, { codexPath: '/fake', run })).toBe('completed')
    expect(run).toHaveBeenCalledWith(snapshot, expect.objectContaining({ promptInput }))
    expect(JSON.stringify(promptInput)).toContain('설정 A')
    expect(JSON.stringify(changedInput)).toContain('설정 B')
  })

  it('finishes a hash-invalid owned job as invalid_output without invoking the runner or legacy defaults', async () => {
    const promptInput = { ...frozenInput(), promptHash: '0'.repeat(64) }
    const job: ClaimedDiagnosisJob = { id: 'job-1', claimToken: 'claim-1', snapshot, promptInput }
    const run = vi.fn(async () => report)
    let finished: unknown
    const rpc = { claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedDiagnosisJob, value: unknown, code: unknown) => {
        finished = { value, code }
        return true
      },
    }
    expect(await processDiagnosisJob(job, rpc, { codexPath: '/fake', run })).toBe('failed')
    expect(run).not.toHaveBeenCalled()
    expect(finished).toEqual({ value: null, code: 'invalid_output' })
  })

  it('retains identity when a configured claim omits prompt input, then fails it as invalid_output', async () => {
    const claimed = { id: 'job-1', claimToken: 'claim-1', snapshot }
    const fetcher: typeof fetch = async (input) => new Response(JSON.stringify(
      String(input).endsWith('claim_configured_diagnosis_job') ? claimed : true,
    ))
    const job = await createConfiguredDiagnosisRpcClient(config, fetcher).claim()
    if (!job) throw new Error('expected claim')
    const run = vi.fn(async () => report)
    let finished: unknown
    const rpc = { claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedDiagnosisJob, value: unknown, code: unknown) => {
        finished = { value, code }
        return true
      },
    }
    expect(await processDiagnosisJob(job, rpc, { codexPath: '/fake', run })).toBe('failed')
    expect(run).not.toHaveBeenCalled()
    expect(finished).toEqual({ value: null, code: 'invalid_output' })
  })

  it('finishes an oversized legacy snapshot as invalid_output before rendering defaults', async () => {
    const oversized = { ...snapshot, sourceHash: 'x'.repeat(1024 * 1024) }
    const job: ClaimedDiagnosisJob = { id: 'job-1', claimToken: 'claim-1', snapshot: oversized }
    const run = vi.fn(async () => report)
    let code: unknown
    const rpc = { claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedDiagnosisJob, _value: unknown, value: unknown) => { code = value; return true },
    }
    expect(await processDiagnosisJob(job, rpc, { codexPath: '/fake', run })).toBe('failed')
    expect(run).not.toHaveBeenCalled()
    expect(code).toBe('invalid_output')
  })
})

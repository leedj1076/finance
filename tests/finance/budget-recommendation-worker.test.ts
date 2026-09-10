import { describe, expect, it, vi } from 'vitest'

import { buildBudgetPromptInput } from '@/features/budget-recommendations/prompt'
import { createBudgetRpcClient, processBudgetJob } from '@/features/budget-recommendations/worker'
import type { ClaimedBudgetJob } from '@/features/budget-recommendations/types'
import { queueOrder, runFinanceWorker } from '@/features/diagnosis/worker'
import type { ClaimedDiagnosisJob, DiagnosisReport, DiagnosisSnapshot } from '@/features/diagnosis/types'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const diagnosisSnapshot: DiagnosisSnapshot = {
  version: 1, month: '2026-08', asOf: '2026-09-10T00:00:00.000Z', sourceHash: 'ledger-source',
  current: { month: '2026-08', count: 0, income: 1_000_000, salary: 1_000_000,
    salaryCount: 1, expense: 0, saving: 0, comparableExpense: 0, otherIncome: 0,
    salaryRemainder: 1_000_000, totalRemainder: 1_000_000, savingsRate: 100 },
  months: [], comparison: { previousExpense: null, expenseDelta: null, expenseChangeRate: null,
    baselineMonthCount: 0, expenseAverage: null, comparableExpenseAverage: null },
  categories: [], budget: { total: null, savingsRateTarget: null }, transactions: [], evidenceCount: 0,
}

const diagnosisReport: DiagnosisReport = {
  version: 1, headline: '확인', summary: '확인했어요.', changes: [],
  trend: { summary: '비교 자료가 없어요.', caveat: '기록 기준이에요.' }, checks: [],
  actions: [{ title: '계획', body: '다음 달 계획을 확인해요.' }], positive: null,
}

function budgetJob(id = 'budget-1'): ClaimedBudgetJob {
  const snapshot = makeBudgetSnapshot()
  return {
    id,
    claimToken: `claim-${id}`,
    snapshot,
    promptInput: buildBudgetPromptInput(snapshot, {
      revision: 1, updatedAt: null, commonInstructions: '설정 A',
      ledgerInstructions: null, budgetInstructions: '예산 A',
    }),
  }
}

const config = {
  supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test',
  workerToken: 'a'.repeat(64), codexPath: '/usr/local/bin/codex', model: 'trusted-model',
}

describe('budget job ownership', () => {
  it('uses only the budget capability, claim, heartbeat, and finish RPC contracts', async () => {
    const job = budgetJob()
    const requests: Array<{ name: string; body: Record<string, unknown> }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const name = String(input).split('/').at(-1)!
      const body = JSON.parse(String(init?.body))
      requests.push({ name, body })
      return new Response(JSON.stringify(name === 'claim_budget_recommendation_job' ? job : true))
    }
    const rpc = createBudgetRpcClient(config, fetcher)
    expect(await rpc.presence()).toBe(true)
    expect(await rpc.claim()).toEqual(job)
    expect(await rpc.heartbeat(job)).toBe(true)
    expect(await rpc.finish(job, makeBudgetReport(), null)).toBe(true)
    expect(requests.map((request) => request.name)).toEqual([
      'heartbeat_budget_worker', 'claim_budget_recommendation_job',
      'heartbeat_budget_recommendation_job', 'finish_budget_recommendation_job',
    ])
    expect(requests[3].body).toEqual({
      p_token: config.workerToken, p_job_id: job.id, p_claim_token: job.claimToken,
      p_report: makeBudgetReport(), p_error_code: null,
    })
  })

  it('passes the exact frozen prompt input to the runner and completes a validated report', async () => {
    const job = budgetJob()
    const report = makeBudgetReport()
    let finished: unknown
    const run = vi.fn(async () => report)
    const rpc = {
      presence: async () => true,
      claim: async () => job,
      heartbeat: async () => true,
      finish: async (_job: ClaimedBudgetJob, value: unknown, code: unknown) => {
        finished = { value, code }
        return true
      },
    }
    expect(await processBudgetJob(job, rpc, { codexPath: '/fake', run })).toBe('completed')
    expect(run).toHaveBeenCalledWith(job.snapshot, expect.objectContaining({ promptInput: job.promptInput }))
    expect(finished).toEqual({ value: report, code: null })
  })

  it('fails an owned job with invalid_output when required frozen input is missing', async () => {
    const job = { ...budgetJob(), promptInput: undefined } as unknown as ClaimedBudgetJob
    const run = vi.fn(async () => makeBudgetReport())
    let finished: unknown
    const rpc = {
      presence: async () => true, claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedBudgetJob, value: unknown, code: unknown) => {
        finished = { value, code }
        return true
      },
    }
    expect(await processBudgetJob(job, rpc, { codexPath: '/fake', run })).toBe('failed')
    expect(run).not.toHaveBeenCalled()
    expect(finished).toEqual({ value: null, code: 'invalid_output' })
  })

  it('fails an oversized owned snapshot before invoking the runner', async () => {
    const job = budgetJob()
    job.snapshot.fingerprint = 'x'.repeat(1024 * 1024)
    const run = vi.fn(async () => makeBudgetReport())
    let code: unknown
    const rpc = { presence: async () => true, claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedBudgetJob, _value: unknown, value: unknown) => { code = value; return true },
    }
    expect(await processBudgetJob(job, rpc, { codexPath: '/fake', run })).toBe('failed')
    expect(run).not.toHaveBeenCalled()
    expect(code).toBe('invalid_output')
  })

  it('aborts generation and never writes success after heartbeat rejection', async () => {
    const job = budgetJob()
    let finished = false
    const rpc = {
      presence: async () => true, claim: async () => job, heartbeat: async () => false,
      finish: async () => { finished = true; return true },
    }
    const outcome = await processBudgetJob(job, rpc, { codexPath: '/fake', heartbeatMs: 5,
      run: async (_snapshot, options) => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
      }),
    })
    expect(outcome).toBe('lease_lost')
    expect(finished).toBe(false)
  })
})

describe('fair unified finance worker', () => {
  it('the preferred queue alternates, with the other queue as fallback', () => {
    expect(queueOrder('budget')).toEqual(['budget', 'diagnosis'])
    expect(queueOrder('diagnosis')).toEqual(['diagnosis', 'budget'])
  })

  it('serializes D1, B1, D2, B2 without concurrent runners', async () => {
    const controller = new AbortController()
    const order: string[] = []
    let active = 0
    let maximumActive = 0
    const diagnosisJobs: ClaimedDiagnosisJob[] = ['D1', 'D2'].map((id) => ({
      id, claimToken: `claim-${id}`, snapshot: diagnosisSnapshot,
    }))
    const budgetJobs = [budgetJob('B1'), budgetJob('B2')]
    const diagnosisRpc = {
      presence: async () => true,
      claim: async () => diagnosisJobs.shift() ?? null,
      heartbeat: async () => true,
      finish: async () => true,
    }
    const budgetRpc = {
      presence: async () => true,
      claim: async () => budgetJobs.shift() ?? null,
      heartbeat: async () => true,
      finish: async () => true,
    }
    const enter = async <T,>(id: string, value: T): Promise<T> => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      order.push(id)
      await Promise.resolve()
      active -= 1
      return value
    }
    await runFinanceWorker(config, {
      signal: controller.signal, pollMs: 1, diagnosisRpc, budgetRpc,
      diagnosisRun: async () => enter(order.length === 0 ? 'D1' : 'D2', diagnosisReport),
      budgetRun: async () => enter(order.length === 1 ? 'B1' : 'B2', makeBudgetReport()),
      log: (event) => { if (['completed', 'failed', 'lease_lost'].includes(event) && order.length === 4) controller.abort() },
    })
    expect(order).toEqual(['D1', 'B1', 'D2', 'B2'])
    expect(maximumActive).toBe(1)
  })

  it('keeps diagnosis available when the additive budget RPC is missing', async () => {
    const logs: string[] = []
    const diagnosisRpc = {
      presence: async () => true,
      claim: async () => ({ id: 'D1', claimToken: 'claim-D1', snapshot: diagnosisSnapshot }),
      heartbeat: async () => true,
      finish: async () => true,
    }
    const budgetRpc = {
      presence: async () => { throw new Error('missing function') },
      claim: async () => { throw new Error('must stay disabled') },
      heartbeat: async () => true,
      finish: async () => true,
    }
    await runFinanceWorker(config, { once: true, diagnosisRpc, budgetRpc,
      diagnosisRun: async () => diagnosisReport, log: (event) => logs.push(event) })
    expect(logs).toContain('budget_setup_required')
    expect(logs).toContain('completed')
  })

  it('uses the other queue immediately when the preferred queue is empty', async () => {
    const claims: string[] = []
    const diagnosisRpc = {
      presence: async () => true,
      claim: async () => { claims.push('diagnosis'); return null },
      heartbeat: async () => true, finish: async () => true,
    }
    const budgetRpc = {
      presence: async () => true,
      claim: async () => { claims.push('budget'); return budgetJob() },
      heartbeat: async () => true, finish: async () => true,
    }
    await runFinanceWorker(config, { once: true, diagnosisRpc, budgetRpc,
      budgetRun: async () => makeBudgetReport() })
    expect(claims).toEqual(['diagnosis', 'budget'])
  })

  it('refreshes both capabilities during a long diagnosis without overlapping runners', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let diagnosisPresence = 0
    let budgetPresence = 0
    let release!: (value: DiagnosisReport) => void
    const running = new Promise<DiagnosisReport>((resolve) => { release = resolve })
    let started!: () => void
    const began = new Promise<void>((resolve) => { started = resolve })
    const diagnosisRpc = {
      presence: async () => { diagnosisPresence += 1; return true },
      claim: async () => ({ id: 'D1', claimToken: 'claim-D1', snapshot: diagnosisSnapshot }),
      heartbeat: async () => true, finish: async () => true,
    }
    const budgetRpc = {
      presence: async () => { budgetPresence += 1; return true },
      claim: async () => null, heartbeat: async () => true, finish: async () => true,
    }
    try {
      const pending = runFinanceWorker(config, { signal: controller.signal, diagnosisRpc, budgetRpc,
        diagnosisRun: async () => { started(); return running },
        log: (event) => { if (event === 'completed') controller.abort() },
      })
      await began
      const before = { diagnosisPresence, budgetPresence }
      await vi.advanceTimersByTimeAsync(30_000)
      expect(diagnosisPresence).toBeGreaterThan(before.diagnosisPresence)
      expect(budgetPresence).toBeGreaterThan(before.budgetPresence)
      release(diagnosisReport)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })
})

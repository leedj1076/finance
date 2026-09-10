import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCodexDiagnosis } from '@/features/diagnosis/codex-runner'
import { createDiagnosisRpcClient, loadDiagnosisWorkerConfig, processDiagnosisJob, runDiagnosisWorker } from '@/features/diagnosis/worker'
import type { ClaimedDiagnosisJob, DiagnosisReport, DiagnosisSnapshot } from '@/features/diagnosis/types'

const snapshot: DiagnosisSnapshot = {
  version: 1, month: '2026-07', asOf: '2026-09-09T00:00:00.000Z', sourceHash: 'synthetic-only',
  current: { month: '2026-07', count: 3, income: 1000000, salary: 1000000, salaryCount: 1,
    expense: 500000, saving: 100000, comparableExpense: 500000, otherIncome: 0,
    salaryRemainder: 400000, totalRemainder: 400000, savingsRate: 50 },
  months: [], comparison: { previousExpense: null, expenseDelta: null, expenseChangeRate: null,
    baselineMonthCount: 0, expenseAverage: null, comparableExpenseAverage: null },
  categories: [{ major: '식비', amount: 500000, previous: null, delta: null, count: 1, budget: null }],
  budget: { total: null, savingsRateTarget: null },
  transactions: [{ id: 1, date: '2026-07-01', flow: 'expense', amount: 500000,
    major: '식비', sub: '식자재', merchant: 'UNTRUSTED $(touch /tmp/do-not-create) `id` --model evil' }],
  evidenceCount: 1,
}

const report: DiagnosisReport = {
  version: 1, headline: '7월 돈 흐름을 확인했어요', summary: '월급에서 지출과 저축 납입을 구분했어요.',
  changes: [{ title: '비교 기록 확인', body: '이전 달 기록이 없어 증감을 판단하지 않았어요.', category: '식비', transactionIds: [1] }],
  trend: { summary: '비교 기록이 없어요.', caveat: '기록상 차액은 가용 현금과 달라요.' },
  checks: [{ title: '내역 확인', body: '기록이 모두 반영됐는지 확인해요.', transactionIds: [1] }],
  actions: [{ title: '다음 달 계획', body: '예정 지출을 확인해요.' }], positive: null,
}
const job: ClaimedDiagnosisJob = { id: 'job-1', claimToken: 'claim-1', snapshot }
const dirs: string[] = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'diagnosis-worker-test-'))
  dirs.push(dir)
  return dir
}

async function fakeCodex(body: string) {
  const dir = await tempDir()
  const path = join(dir, 'fake-codex')
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 })
  return path
}

const writeReport = `
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('--output-last-message') + 1];
fs.writeFileSync(output, ${JSON.stringify(JSON.stringify(report))});
process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n');
`

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('isolated Codex diagnosis runner', () => {
  it('passes ledger text only on stdin and excludes worker secrets from an isolated process', async () => {
    vi.stubEnv('DIAGNOSIS_TEST_SECRET', 'must-never-reach-codex')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-secret')
    vi.stubEnv('NODE_OPTIONS', '')
    const capturedPath = join(await tempDir(), 'captured.json')
    const codexPath = await fakeCodex(`
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        ${writeReport}
        fs.writeFileSync(${JSON.stringify(capturedPath)}, JSON.stringify({ input, args,
          cwd: process.cwd(), files: fs.readdirSync(process.cwd()),
          envKeys: Object.keys(process.env), canary: process.env.DIAGNOSIS_TEST_SECRET,
          mode: fs.statSync(process.cwd()).mode & 0o777,
          schema: JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'))
        }));
      });
    `)
    expect(await runCodexDiagnosis(snapshot, { codexPath, model: 'trusted-model' })).toEqual(report)
    const captured = JSON.parse(await readFile(capturedPath, 'utf8'))
    expect(captured.input).toContain(snapshot.transactions[0].merchant)
    expect(captured.args.join(' ')).not.toContain('UNTRUSTED')
    expect(captured.args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-schema', '--json', 'read-only', 'trusted-model']))
    expect(captured.args).toContain('orchestrator.mcp.enabled=false')
    expect(captured.args).toContain('orchestrator.skills.enabled=false')
    expect(captured.args).toContain('shell_tool')
    expect(captured.args).toContain('hooks')
    expect(captured.args.at(-1)).toBe('-')
    expect(captured.envKeys).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(captured.envKeys).not.toContain('NODE_OPTIONS')
    expect(captured.canary).toBeUndefined()
    expect(captured.mode).toBe(0o700)
    expect(captured.schema.type).toBe('object')
    expect(captured.files).not.toContain('AGENTS.md')
    await expect(readFile(join(captured.cwd, 'schema.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a failed process without exposing stderr or the prompt', async () => {
    const codexPath = await fakeCodex(`process.stderr.write('private diagnostic secret'); process.exit(7);`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'cli_failed', message: 'cli_failed' })
  })

  it('rejects malformed output and evidence not present in the snapshot', async () => {
    for (const output of ['not json', JSON.stringify({ ...report, checks: [{ ...report.checks[0], transactionIds: [999] }] })]) {
      const codexPath = await fakeCodex(`const fs=require('node:fs'); const a=process.argv; fs.writeFileSync(a[a.indexOf('--output-last-message')+1], ${JSON.stringify(output)}); process.stdout.write('{"type":"turn.completed"}\\n');`)
      await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'invalid_output' })
    }
  })

  it('rejects oversized stdout even when the final report is otherwise valid', async () => {
    const codexPath = await fakeCodex(`${writeReport}\nprocess.stdout.write('x'.repeat(1024 * 1024 + 1));`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('rejects oversized final files independently of stdout size', async () => {
    const codexPath = await fakeCodex(`const fs=require('node:fs'); const a=process.argv; fs.writeFileSync(a[a.indexOf('--output-last-message')+1], 'x'.repeat(1024 * 1024 + 1));`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('times out and terminates a child that ignores SIGTERM', async () => {
    const codexPath = await fakeCodex(`process.on('SIGTERM', () => {}); setInterval(() => {}, 100);`)
    await expect(runCodexDiagnosis(snapshot, { codexPath, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'timeout' })
  }, 5000)

  it('cancels an active process when the worker stops', async () => {
    const codexPath = await fakeCodex(`setInterval(() => {}, 100);`)
    const controller = new AbortController()
    const pending = runCodexDiagnosis(snapshot, { codexPath, signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toMatchObject({ code: 'worker_stopped' })
  })

  it('kills descendants in its own process group on timeout', async () => {
    const pidPath = join(await tempDir(), 'child-pid')
    const codexPath = await fakeCodex(`
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], { stdio: 'ignore' });
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 100);
    `)
    await expect(runCodexDiagnosis(snapshot, { codexPath, timeoutMs: 1500 })).rejects.toMatchObject({ code: 'timeout' })
    const pid = Number(await readFile(pidPath, 'utf8'))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(() => process.kill(pid, 0)).toThrow()
  }, 5000)

  it('does not follow a final-output symlink outside its temporary workspace', async () => {
    const outside = join(await tempDir(), 'outside.json')
    await writeFile(outside, JSON.stringify(report))
    const codexPath = await fakeCodex(`const fs=require('node:fs'); const a=process.argv; fs.symlinkSync(${JSON.stringify(outside)}, a[a.indexOf('--output-last-message')+1]); process.stdout.write('{"type":"turn.completed"}\\n');`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('reports missing executables and aborted-before-start invocations safely', async () => {
    await expect(runCodexDiagnosis(snapshot, { codexPath: join(await tempDir(), 'missing') })).rejects.toMatchObject({ code: 'cli_failed' })
    const controller = new AbortController()
    controller.abort()
    await expect(runCodexDiagnosis(snapshot, { codexPath: '/not-invoked', signal: controller.signal })).rejects.toMatchObject({ code: 'worker_stopped' })
  })

  it('requires a completed turn even when the process exits successfully with a valid file', async () => {
    const codexPath = await fakeCodex(`const fs=require('node:fs'); const a=process.argv; fs.writeFileSync(a[a.indexOf('--output-last-message')+1], ${JSON.stringify(JSON.stringify(report))});`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('aborts when the CLI exposes a command, MCP, web or file-change tool event', async () => {
    for (const type of ['command_execution', 'mcp_tool_call', 'web_search', 'file_change']) {
      const codexPath = await fakeCodex(`process.stdout.write(JSON.stringify({ type: 'item.started', item: { type: ${JSON.stringify(type)} } }) + '\\n'); setInterval(()=>{},100);`)
      await expect(runCodexDiagnosis(snapshot, { codexPath, timeoutMs: 2000 })).rejects.toMatchObject({ code: 'invalid_output' })
    }
  }, 10_000)

  it('rejects a failed-turn event even if the CLI subsequently writes a valid report', async () => {
    const codexPath = await fakeCodex(`process.stdout.write('{"type":"turn.failed","error":{"message":"private"}}\\n'); ${writeReport}`)
    await expect(runCodexDiagnosis(snapshot, { codexPath })).rejects.toMatchObject({ code: 'cli_failed' })
  })
})

const workerConfig = {
  supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test',
  workerToken: 'a'.repeat(64), codexPath: '/usr/local/bin/codex',
}

describe('private worker configuration and scoped RPCs', () => {
  it('loads a private configuration and rejects readable-by-others files', async () => {
    const path = join(await tempDir(), 'worker.json')
    await writeFile(path, JSON.stringify(workerConfig), { mode: 0o600 })
    expect(await loadDiagnosisWorkerConfig(path)).toEqual(workerConfig)
    await chmod(path, 0o644)
    await expect(loadDiagnosisWorkerConfig(path)).rejects.toThrow('invalid_worker_config')
  })

  it('rejects service credentials, unexpected fields, and URLs carrying secrets', async () => {
    const path = join(await tempDir(), 'worker.json')
    const serviceJwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
    for (const value of [
      { ...workerConfig, supabaseAnonKey: 'sb_secret_test' },
      { ...workerConfig, supabaseAnonKey: serviceJwt },
      { ...workerConfig, serviceRoleKey: 'forbidden' },
      { ...workerConfig, supabaseUrl: 'https://user:secret@example.supabase.co' },
    ]) {
      await writeFile(path, JSON.stringify(value), { mode: 0o600 })
      await expect(loadDiagnosisWorkerConfig(path)).rejects.toThrow('invalid_worker_config')
    }
  })

  it('rejects a configuration symlink', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'real.json'), JSON.stringify(workerConfig), { mode: 0o600 })
    await symlink(join(dir, 'real.json'), join(dir, 'link.json'))
    await expect(loadDiagnosisWorkerConfig(join(dir, 'link.json'))).rejects.toThrow('invalid_worker_config')
  })

  it('uses only the three scoped RPCs and never sends worker tokens as authorization headers', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init: init! })
      return new Response(JSON.stringify(String(input).endsWith('claim_diagnosis_job') ? job : true))
    }
    const rpc = createDiagnosisRpcClient(workerConfig, fetcher)
    expect(await rpc.claim()).toEqual(job)
    expect(await rpc.heartbeat(job)).toBe(true)
    expect(await rpc.finish(job, report, null)).toBe(true)
    expect(requests.map(r => r.url.split('/').at(-1))).toEqual(['claim_diagnosis_job', 'heartbeat_diagnosis_job', 'finish_diagnosis_job'])
    const headers = new Headers(requests[0].init.headers)
    expect(headers.get('apikey')).toBe('sb_publishable_test')
    expect(headers.get('authorization') ?? '').not.toContain(workerConfig.workerToken)
    expect(JSON.parse(String(requests[2].init.body))).toEqual({ p_token: workerConfig.workerToken,
      p_job_id: 'job-1', p_claim_token: 'claim-1', p_report: report, p_error_code: null })
  })

  it('normalizes upstream errors without exposing response bodies or credentials', async () => {
    const rpc = createDiagnosisRpcClient(workerConfig, async () => new Response('private backend detail', { status: 500 }))
    await expect(rpc.claim()).rejects.toMatchObject({ code: 'rpc_failed', message: 'rpc_failed' })
  })
})

describe('worker lease ownership', () => {
  it('heartbeats while a job runs and completes the validated report', async () => {
    let beats = 0
    let completed: unknown
    const rpc = { claim: async () => job, heartbeat: async () => { beats++; return true },
      finish: async (_job: ClaimedDiagnosisJob, value: DiagnosisReport | null, code: string | null) => { completed = { value, code }; return true } }
    await processDiagnosisJob(job, rpc, { codexPath: '/fake', heartbeatMs: 10,
      run: async () => { await new Promise(resolve => setTimeout(resolve, 35)); return report } })
    expect(beats).toBeGreaterThan(0)
    expect(completed).toEqual({ value: report, code: null })
  })

  it('aborts generation and refuses completion after losing the lease', async () => {
    let finished = false
    const rpc = { claim: async () => job, heartbeat: async () => false,
      finish: async () => { finished = true; return false } }
    const result = await processDiagnosisJob(job, rpc, { codexPath: '/fake', heartbeatMs: 10,
      run: async (_snapshot, options) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
    expect(result).toBe('lease_lost')
    expect(finished).toBe(false)
  })

  it('marks a stopped job failed only while its lease remains valid', async () => {
    const controller = new AbortController()
    let errorCode: string | null = null
    const rpc = { claim: async () => job, heartbeat: async () => true,
      finish: async (_job: ClaimedDiagnosisJob, _report: DiagnosisReport | null, code: string | null) => { errorCode = code; return true } }
    const pending = processDiagnosisJob(job, rpc, { codexPath: '/fake', signal: controller.signal,
      run: async (_snapshot, options) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
    setTimeout(() => controller.abort(), 10)
    expect(await pending).toBe('failed')
    expect(errorCode).toBe('worker_stopped')
  })

  it('treats heartbeat network failures as uncertain ownership and stops generation', async () => {
    let finished = false
    const rpc = { claim: async () => job, heartbeat: async () => { throw new Error('private detail') },
      finish: async () => { finished = true; return true } }
    expect(await processDiagnosisJob(job, rpc, { codexPath: '/fake', heartbeatMs: 5,
      run: async (_snapshot, options) => new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true })) })).toBe('lease_lost')
    expect(finished).toBe(false)
  })

  it('runs one claim with --once and never logs the report or token', async () => {
    let claims = 0
    const logs: unknown[] = []
    const rpc = { claim: async () => { claims++; return job }, heartbeat: async () => true, finish: async () => true }
    await runDiagnosisWorker(workerConfig, { rpc, once: true, run: async () => report,
      log: (event, jobId) => logs.push({ event, jobId }) })
    expect(claims).toBe(1)
    expect(logs).toEqual([{ event: 'started', jobId: 'job-1' }, { event: 'completed', jobId: 'job-1' }])
  })

  it('stops an idle polling loop promptly on shutdown', async () => {
    const controller = new AbortController()
    let claims = 0
    const rpc = { claim: async () => { claims++; return null }, heartbeat: async () => true, finish: async () => true }
    const pending = runDiagnosisWorker(workerConfig, { rpc, signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    await pending
    expect(claims).toBe(1)
  })

  it('executes the foreground --once script against a local RPC server and a fake CLI', async () => {
    let finishedReport: unknown
    const server = createServer((request, response) => {
      let input = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { input += chunk })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        if (request.url?.endsWith('/claim_configured_diagnosis_job')) {
          response.end(JSON.stringify({ ...job, promptInput: null }))
        }
        else {
          if (request.url?.endsWith('/finish_diagnosis_job')) finishedReport = JSON.parse(input).p_report
          response.end('true')
        }
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('local server unavailable')
      const codexPath = await fakeCodex(writeReport)
      const path = join(await tempDir(), 'worker.json')
      await writeFile(path, JSON.stringify({ ...workerConfig, codexPath, supabaseUrl: `http://127.0.0.1:${address.port}` }), { mode: 0o600 })
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
        const child = spawn(process.execPath, ['--require', 'tsx/cjs', resolve('scripts/diagnosis-worker.ts'), '--once', '--config', path], { shell: false })
        let stdout = '', stderr = ''
        child.stdout.on('data', chunk => { stdout += chunk })
        child.stderr.on('data', chunk => { stderr += chunk })
        child.on('error', reject)
        child.on('close', code => resolveResult({ code, stdout, stderr }))
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim().split('\n').map(line => JSON.parse(line))).toEqual([
        { event: 'started', jobId: 'job-1' }, { event: 'completed', jobId: 'job-1' },
      ])
      expect(finishedReport).toEqual(report)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    }
  }, 15_000)
})

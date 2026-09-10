import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { createBudgetQueueFixture, type BudgetQueueHousehold } from '../fixtures/budget-queue'

const fixture = createBudgetQueueFixture()
const { raw, anon, snapshot, report, prompt, rpc, enqueue, ready, claim, finish } = fixture
let a: BudgetQueueHousehold
let b: BudgetQueueHousehold
beforeAll(async () => { ({ a, b } = await fixture.setup()) })
beforeEach(fixture.reset)
afterAll(fixture.cleanup)

test('durable isolated budget queue and all worker RPCs exist', async () => {
  const [row] = await raw`select to_regclass('public.budget_recommendation_jobs')::text as name`
  expect(row.name).toBe('budget_recommendation_jobs')
  for (const name of ['heartbeat_budget_worker(text)', 'claim_budget_recommendation_job(text)',
    'heartbeat_budget_recommendation_job(text,uuid,uuid)', 'finish_budget_recommendation_job(text,uuid,uuid,jsonb,text)']) {
    const [fn] = await raw`select to_regprocedure(${'public.' + name})::text as name`
    expect(fn.name).not.toBeNull()
  }
})
test('members read only household jobs and browsers cannot mutate jobs or worker credentials', async () => {
  const id = await enqueue()
  expect((await a.client.from('budget_recommendation_jobs').select('id')).data?.map(row => row.id)).toContain(id)
  expect((await b.client.from('budget_recommendation_jobs').select('id')).data).toEqual([])
  expect((await anon.from('budget_recommendation_jobs').select('id')).error).not.toBeNull()
  for (const client of [anon, a.client, b.client]) {
    for (const table of ['budget_recommendation_jobs', 'diagnosis_workers']) {
      expect((await client.from(table).insert({ id: randomUUID() })).error).not.toBeNull()
      expect((await client.from(table).update({ id: randomUUID() }).eq('id', id)).error).not.toBeNull()
      expect((await client.from(table).delete().eq('id', id)).error).not.toBeNull()
    }
  }
})
test('capability heartbeats do not claim and stale capability blocks claims', async () => {
  const id = await enqueue()
  expect(await claim()).toBeNull()
  await ready()
  expect((await raw`select status from budget_recommendation_jobs where id = ${id}`)[0].status).toBe('queued')
  await raw`update diagnosis_workers set budget_last_seen_at = now() - interval '91 seconds' where id = ${a.workerId}`
  expect(await claim()).toBeNull()
  await ready()
  expect((await claim()).id).toBe(id)
})
test('budget claims cannot claim ledger jobs and household tokens cannot see foreign budget jobs', async () => {
  await raw`insert into diagnosis_jobs (household_id, month, snapshot, fingerprint, requested_by)
    values (${a.householdId}, '2026-09', ${raw.json(snapshot)}, ${'a'.repeat(64)}, ${a.userId})`
  await enqueue(b)
  await ready()
  expect(await claim()).toBeNull()
  for (const token of [null, '', randomBytes(32).toString('hex')]) {
    expect(await rpc('heartbeat_budget_worker', { p_token: token })).toBe(false)
    expect(await rpc('claim_budget_recommendation_job', { p_token: token })).toBeNull()
  }
  await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
  expect(await rpc('heartbeat_budget_worker', { p_token: a.token })).toBe(false)
})
test('active monthly uniqueness and durable request id survive completion', async () => {
  const requestId = randomUUID()
  await enqueue(a, '2026-09', requestId)
  await expect(enqueue()).rejects.toMatchObject({ code: '23505' })
  await ready()
  const claims = await Promise.all([claim(), claim()])
  expect(claims.filter(Boolean)).toHaveLength(1)
  const job = claims.find(Boolean)
  expect(Object.keys(job).sort()).toEqual(['claimToken', 'id', 'promptInput', 'snapshot'])
  expect(await finish(job)).toBe(true)
  expect(await finish(job)).toBe(false)
  await expect(enqueue(a, '2026-10', requestId)).rejects.toMatchObject({ code: '23505' })
  await expect(enqueue()).resolves.toEqual(expect.any(String))
  expect((await raw`select status, report, worker_id, claim_token, lease_expires_at from budget_recommendation_jobs where id = ${job.id}`)[0])
    .toMatchObject({ status: 'completed', report, worker_id: null, claim_token: null, lease_expires_at: null })
})
test('heartbeats and finish require active unrevoked owner, claim and lease; errors stay bounded', async () => {
  await enqueue(); await ready()
  const job = await claim()
  const heartbeat = (owner = a, claimToken = job.claimToken) => rpc('heartbeat_budget_recommendation_job', {
    p_token: owner.token, p_job_id: job.id, p_claim_token: claimToken })
  expect(await heartbeat(b)).toBe(false)
  expect(await heartbeat(a, randomUUID())).toBe(false)
  expect(await finish(job, b)).toBe(false)
  expect(await finish({ ...job, claimToken: randomUUID() })).toBe(false)
  expect(await finish(job, a, { version: 1 })).toBe(false)
  expect(await finish(job, a, { version: 2, rows: [] })).toBe(false)
  expect(await finish(job, a, null, 'secret text')).toBe(false)
  expect(await finish(job, a, report, 'timeout')).toBe(false)
  expect(await heartbeat()).toBe(true)
  await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
  expect(await heartbeat()).toBe(false)
  expect(await finish(job)).toBe(false)
  await raw`update diagnosis_workers set revoked_at = null where id = ${a.workerId}`
  await raw`update budget_recommendation_jobs set lease_expires_at = now() - interval '1 second' where id = ${job.id}`
  expect(await heartbeat()).toBe(false)
  expect(await finish(job)).toBe(false)
  expect(await claim()).toBeNull()
  expect((await raw`select status, error_code from budget_recommendation_jobs where id = ${job.id}`)[0])
    .toMatchObject({ status: 'failed', error_code: 'lease_expired' })
})
test('snapshot/request metadata and terminal report are immutable and invalid shapes fail', async () => {
  const id = await enqueue()
  await expect(raw`update budget_recommendation_jobs set snapshot = '{"version":1,"month":"2026-09","changed":true}' where id = ${id}`)
    .rejects.toMatchObject({ code: '23514' })
  await expect(raw`update budget_recommendation_jobs set request_id = ${randomUUID()} where id = ${id}`).rejects.toMatchObject({ code: '23514' })
  await expect(raw`update budget_recommendation_jobs set status = 'completed', report = ${raw.json(report)}, completed_at = now() where id = ${id}`)
    .rejects.toMatchObject({ code: '23514' })
  await expect(enqueue(a, '2026-13')).rejects.toMatchObject({ code: '23514' })
  await ready(); const job = await claim(); await finish(job)
  await expect(raw`update budget_recommendation_jobs set report = '{"version":1,"rows":[]}' where id = ${id}`).rejects.toMatchObject({ code: '23514' })
  await expect(raw`update budget_recommendation_jobs set status = 'queued', report = null, completed_at = null where id = ${id}`).rejects.toMatchObject({ code: '23514' })
})
test('configured budget requires both fresh capabilities and returns exact frozen input', async () => {
  const input = prompt('budget')
  const id = await enqueue(a, '2026-09', randomUUID(), input)
  await ready()
  expect(await claim()).toBeNull()
  expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 300000 })).toBe(true)
  await raw`update diagnosis_workers set prompt_last_seen_at = now() - interval '91 seconds' where id = ${a.workerId}`
  expect(await claim()).toBeNull()
  await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 300000 })
  expect(await claim()).toMatchObject({ id, promptInput: input })
})

test('claims skip locked older rows and expiry never changes foreign households or ledger jobs', async () => {
  const locked = await enqueue(a, '2026-08')
  const available = await enqueue()
  await raw`update budget_recommendation_jobs set created_at = now() - interval '1 hour' where id = ${locked}`
  await ready()
  await raw.begin(async tx => {
    await tx`select id from budget_recommendation_jobs where id = ${locked} for update`
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const job = await Promise.race([claim(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Budget claim blocked on locked job')), 2000)
      })])
      expect(job.id).toBe(available)
    } finally { clearTimeout(timer) }
  })
  expect((await claim()).id).toBe(locked)
  const foreign = await enqueue(b); await ready(b); await claim(b)
  await raw`insert into diagnosis_jobs (household_id, month, snapshot, fingerprint, requested_by)
    values (${a.householdId}, '2026-09', ${raw.json(snapshot)}, ${'a'.repeat(64)}, ${a.userId})`
  const ledger = await rpc('claim_diagnosis_job', { p_token: a.token })
  await raw`update diagnosis_jobs set lease_expires_at = now() - interval '1 second' where id = ${ledger.id}`
  await raw`update budget_recommendation_jobs set lease_expires_at = now() - interval '1 second'
    where id in ${raw([locked, available, foreign])}`
  expect(await claim()).toBeNull()
  expect((await raw`select status from budget_recommendation_jobs where id = ${foreign}`)[0].status).toBe('running')
  expect((await raw`select status from diagnosis_jobs where id = ${ledger.id}`)[0].status).toBe('running')
  expect((await raw`select status from budget_recommendation_jobs where id = ${locked}`)[0].status).toBe('failed')
})

test('same-household different worker cannot heartbeat or finish and failed jobs rotate claim tokens on rerun', async () => {
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  await raw`insert into diagnosis_workers (household_id, token_hash, label) values (${a.householdId}, ${hash}, 'TEST sibling')`
  await enqueue(); await ready()
  const job = await claim()
  expect(await rpc('heartbeat_budget_recommendation_job', { p_token: token, p_job_id: job.id, p_claim_token: job.claimToken })).toBe(false)
  expect(await finish(job, { ...a, token })).toBe(false)
  await raw`update budget_recommendation_jobs set lease_expires_at = now() + interval '10 seconds' where id = ${job.id}`
  expect(await rpc('heartbeat_budget_recommendation_job', { p_token: a.token, p_job_id: job.id, p_claim_token: job.claimToken })).toBe(true)
  expect((await raw`select lease_expires_at > now() + interval '150 seconds' as fresh
    from budget_recommendation_jobs where id = ${job.id}`)[0].fresh).toBe(true)
  expect(await finish(job, a, null, 'timeout')).toBe(true)
  await enqueue()
  const next = await claim()
  expect(next.claimToken).not.toBe(job.claimToken)
  expect(await finish(job)).toBe(false)
  expect(await finish(next)).toBe(true)
})

test('invalid snapshot and prompt envelopes fail at SQL boundary; unsupported budget versions remain queued', async () => {
  for (const value of [{}, { version: 2, month: '2026-09' }, { version: 1, month: '2026-10' }]) {
    await expect(raw`insert into budget_recommendation_jobs (household_id, request_id, month, snapshot, fingerprint, requested_by)
      values (${a.householdId}, ${randomUUID()}, '2026-09', ${raw.json(value)}, ${'a'.repeat(64)}, ${a.userId})`)
      .rejects.toMatchObject({ code: '23514' })
  }
  await expect(enqueue(a, '2026-09', randomUUID(), prompt('ledger'))).rejects.toMatchObject({ code: '23514' })
  await expect(enqueue(a, '2026-09', randomUUID(), { ...prompt('budget'), prefix: 'x'.repeat(131072) }))
    .rejects.toMatchObject({ code: '23514' })
  const id = await enqueue(a, '2026-09', randomUUID(), { ...prompt('budget'), version: 2 })
  await ready()
  await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 1000 })
  expect(await claim()).toBeNull()
  expect((await raw`select status from budget_recommendation_jobs where id = ${id}`)[0].status).toBe('queued')
})

test('security definers have empty search paths and only intended RPC entry points are executable', async () => {
  const functions = ['heartbeat_ai_worker', 'heartbeat_budget_worker', 'claim_configured_diagnosis_job',
    'claim_budget_recommendation_job', 'heartbeat_budget_recommendation_job', 'finish_budget_recommendation_job']
  const rows = await raw`select p.proname, p.prosecdef, p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ${raw(functions)}`
  expect(rows).toHaveLength(6)
  for (const row of rows) expect(row).toMatchObject({ prosecdef: true, proconfig: ['search_path=""'], anon: true, authenticated: true, service: false })
  const triggers = await raw`select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('guard_budget_recommendation_job', 'guard_diagnosis_job_input', 'validate_budget_recommendation_reference')`
  expect(triggers).toHaveLength(3)
  for (const row of triggers) expect(row).toEqual({ anon: false, authenticated: false })
})

test('repeated migrations preserve existing job data and migration count', async () => {
  const id = await enqueue()
  const read = async () => ({
    job: (await raw`select * from budget_recommendation_jobs where id = ${id}`)[0],
    migrations: (await raw`select count(*)::integer as count from drizzle.__drizzle_migrations`)[0].count,
  })
  const before = await read()
  execFileSync('pnpm', ['db:migrate'], { cwd: process.cwd(), stdio: 'pipe', timeout: 20000 })
  expect(await read()).toEqual(before)
})

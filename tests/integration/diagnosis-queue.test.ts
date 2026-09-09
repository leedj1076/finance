import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ClaimedDiagnosisJob, DiagnosisReport, DiagnosisSnapshot } from '@/features/diagnosis/types'

const databaseUrl = process.env.DATABASE_URL!
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
for (const value of [databaseUrl, supabaseUrl]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error('Diagnosis queue integration tests require local Supabase')
  }
}
const raw = postgres(databaseUrl, { prepare: false })
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const userIds: string[] = []
const householdIds: string[] = []
const snapshot: DiagnosisSnapshot = {
  version: 1, sourceHash: 'a'.repeat(64), month: '2026-07', asOf: '2026-09-09T00:00:00.000Z',
  current: {
    month: '2026-07', count: 3, income: 7101720, salary: 7101720, salaryCount: 1,
    expense: 5603949, saving: 850000, comparableExpense: 5603949,
    otherIncome: 0, salaryRemainder: 647771, totalRemainder: 647771, savingsRate: 0.21,
  },
  months: [],
  comparison: {
    previousExpense: null, expenseDelta: null, expenseChangeRate: null, baselineMonthCount: 0,
    expenseAverage: null, comparableExpenseAverage: null,
  },
  categories: [], budget: { total: null, savingsRateTarget: null }, transactions: [], evidenceCount: 0,
}
const report: DiagnosisReport = {
  version: 1, headline: '7월 기록상 남은 금액', summary: '월급에서 지출과 저축을 뺀 금액입니다.',
  changes: [], trend: { summary: '비교 기록 없음', caveat: '기록상 차액입니다.' },
  checks: [], actions: [], positive: null,
}

type Fixture = { householdId: string; userId: string; workerId: string; token: string; client: SupabaseClient }
let a: Fixture
let b: Fixture
let sibling: Fixture

async function fixture(label: string): Promise<Fixture> {
  const suffix = randomUUID()
  const email = `diagnosis-${label}-${suffix}@test.local`
  const password = randomBytes(24).toString('hex')
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userIds.push(data.user.id)
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  const [household] = await raw`insert into households (name) values (${`diagnosis-${label}-${suffix}`}) returning id`
  householdIds.push(household.id)
  await raw`insert into household_members (household_id, user_id) values (${household.id}, ${data.user.id})`
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  const [worker] = await raw`
    insert into diagnosis_workers (household_id, token_hash, label)
    values (${household.id}, ${hash}, 'Integration test') returning id
  `
  return { householdId: household.id, userId: data.user.id, workerId: worker.id, token, client }
}

async function enqueue(owner = a, month = '2026-07') {
  const [job] = await raw`
    insert into diagnosis_jobs (household_id, month, snapshot, fingerprint, requested_by)
    values (${owner.householdId}, ${month}, ${raw.json({ ...snapshot, month })}, ${'a'.repeat(64)}, ${owner.userId})
    returning id
  `
  return job.id as string
}

async function claim(owner = a): Promise<ClaimedDiagnosisJob | null> {
  const { data, error } = await anon.rpc('claim_diagnosis_job', { p_token: owner.token })
  if (error) throw error
  return data
}

async function finish(job: ClaimedDiagnosisJob, owner = a, value: unknown = report, errorCode: string | null = null) {
  const { data, error } = await anon.rpc('finish_diagnosis_job', {
    p_token: owner.token, p_job_id: job.id, p_claim_token: job.claimToken, p_report: value, p_error_code: errorCode,
  })
  if (error) throw error
  return data
}

async function heartbeat(job: ClaimedDiagnosisJob, owner = a) {
  const { data, error } = await anon.rpc('heartbeat_diagnosis_job', {
    p_token: owner.token, p_job_id: job.id, p_claim_token: job.claimToken,
  })
  if (error) throw error
  return data
}

afterAll(async () => {
  if (householdIds.length) await raw`delete from households where id in ${raw(householdIds)}`
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
  await raw.end()
})

test('durable diagnosis queue exists', async () => {
  const [row] = await raw`select to_regclass('public.diagnosis_jobs') as jobs, to_regclass('public.diagnosis_workers') as workers`
  expect(row.jobs).toBe('diagnosis_jobs')
  expect(row.workers).toBe('diagnosis_workers')
})

describe('household-bound diagnosis queue', () => {
  beforeAll(async () => {
    a = await fixture('a')
    b = await fixture('b')
    const token = randomBytes(32).toString('hex')
    const hash = createHash('sha256').update(token).digest('hex')
    const [worker] = await raw`
      insert into diagnosis_workers (household_id, token_hash, label)
      values (${a.householdId}, ${hash}, 'Second household worker') returning id
    `
    sibling = { ...a, token, workerId: worker.id }
  })
  beforeEach(async () => {
    await raw`delete from diagnosis_jobs where household_id in ${raw(householdIds)}`
    await raw`update diagnosis_workers set revoked_at = null, last_seen_at = null where household_id in ${raw(householdIds)}`
  })

  test('members read only their household jobs; anonymous requests cannot read financial snapshots', async () => {
    const id = await enqueue()
    const own = await a.client.from('diagnosis_jobs').select('id, snapshot')
    expect(own.error).toBeNull()
    expect(own.data?.map((row) => row.id)).toContain(id)
    const other = await b.client.from('diagnosis_jobs').select('id')
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
    const unauthenticated = await anon.from('diagnosis_jobs').select('id, snapshot')
    expect(unauthenticated.error).not.toBeNull()
  })

  test('clients cannot enqueue or tamper with jobs or read worker credentials', async () => {
    const id = await enqueue()
    for (const client of [a.client, b.client, anon]) {
      expect((await client.from('diagnosis_jobs').insert({
        household_id: a.householdId, month: '2026-08', snapshot,
        fingerprint: 'b'.repeat(64), requested_by: a.userId,
      })).error).not.toBeNull()
      expect((await client.from('diagnosis_jobs').update({ status: 'failed', error_code: 'timeout' }).eq('id', id)).error).not.toBeNull()
      expect((await client.from('diagnosis_jobs').delete().eq('id', id)).error).not.toBeNull()
      expect((await client.from('diagnosis_workers').select('*')).error).not.toBeNull()
      expect((await client.from('diagnosis_workers').update({ revoked_at: null }).eq('id', a.workerId)).error).not.toBeNull()
    }
    const [job] = await raw`select status from diagnosis_jobs where id = ${id}`
    expect(job.status).toBe('queued')
  })

  test('invalid and missing tokens reveal no jobs', async () => {
    await enqueue()
    for (const token of [null, '', randomBytes(32).toString('hex')]) {
      const result = await anon.rpc('claim_diagnosis_job', { p_token: token })
      expect(result.error).toBeNull()
      expect(result.data).toBeNull()
    }
  })

  test('claim is household-bound and updates worker liveness even when no job exists', async () => {
    const id = await enqueue(b)
    expect(await claim()).toBeNull()
    const [worker] = await raw`select last_seen_at from diagnosis_workers where id = ${a.workerId}`
    expect(worker.last_seen_at).not.toBeNull()
    const job = await claim(b)
    expect(job?.id).toBe(id)
    expect(job?.snapshot.month).toBe('2026-07')
    expect(Object.keys(job!).sort()).toEqual(['claimToken', 'id', 'snapshot'])
  })

  test('concurrent claims process a queued job once and leave it leased to its worker', async () => {
    const id = await enqueue()
    const claims = await Promise.all([claim(), claim(sibling), claim()])
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)?.id).toBe(id)
    const [job] = await raw`select status, worker_id, lease_expires_at > now() as leased from diagnosis_jobs where id = ${id}`
    expect(job).toMatchObject({ status: 'running', leased: true })
    expect([a.workerId, sibling.workerId]).toContain(job.worker_id)
  })

  test('claim takes the oldest queued month before newer requests', async () => {
    const older = await enqueue(a, '2026-06')
    await raw`update diagnosis_jobs set created_at = now() - interval '1 hour' where id = ${older}`
    await enqueue(a, '2026-07')
    expect((await claim())?.id).toBe(older)
  })

  test('a worker skips a queued job locked by another claim instead of blocking the queue', async () => {
    const locked = await enqueue(a, '2026-06')
    await raw`update diagnosis_jobs set created_at = now() - interval '1 hour' where id = ${locked}`
    const available = await enqueue(a, '2026-07')
    await raw.begin(async (transaction) => {
      await transaction`select id from diagnosis_jobs where id = ${locked} for update`
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const claimed = await Promise.race([
          claim(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Claim blocked on a locked job')), 2000)
          }),
        ])
        expect(claimed?.id).toBe(available)
      } finally {
        clearTimeout(timer)
      }
    })
    expect((await claim())?.id).toBe(locked)
  })

  test('active duplicate requests are rejected but completed reports permit regeneration', async () => {
    await enqueue()
    await expect(enqueue()).rejects.toMatchObject({ code: '23505' })
    const job = (await claim())!
    await expect(enqueue()).rejects.toMatchObject({ code: '23505' })
    expect(await finish(job)).toBe(true)
    expect(await finish(job)).toBe(false)
    await enqueue()
    const [saved] = await raw`select status, report, completed_at from diagnosis_jobs where id = ${job.id}`
    expect(saved.status).toBe('completed')
    expect(saved.report).toEqual(report)
    expect(saved.completed_at).not.toBeNull()
  })

  test('heartbeat refreshes a valid lease and rejects foreign workers and forged claims', async () => {
    await enqueue()
    const job = (await claim())!
    await raw`update diagnosis_jobs set lease_expires_at = now() + interval '20 seconds' where id = ${job.id}`
    expect(await heartbeat(job, b)).toBe(false)
    expect(await heartbeat(job, sibling)).toBe(false)
    expect(await heartbeat({ ...job, claimToken: randomUUID() })).toBe(false)
    expect(await heartbeat(job)).toBe(true)
    const [row] = await raw`select lease_expires_at > now() + interval '150 seconds' as renewed from diagnosis_jobs where id = ${job.id}`
    expect(row.renewed).toBe(true)
  })

  test('completion rejects wrong household, wrong claim, malformed report, and arbitrary error text', async () => {
    await enqueue()
    const job = (await claim())!
    expect(await finish(job, b)).toBe(false)
    expect(await finish(job, sibling)).toBe(false)
    expect(await finish({ ...job, claimToken: randomUUID() })).toBe(false)
    expect(await finish(job, a, { version: 1 })).toBe(false)
    expect(await finish(job, a, null, 'private shell output')).toBe(false)
    expect(await finish(job, a, report, 'timeout')).toBe(false)
    expect(await finish(job, a, null, null)).toBe(false)
    expect(await finish(job, a, null, 'timeout')).toBe(true)
    const [saved] = await raw`select status, error_code, report from diagnosis_jobs where id = ${job.id}`
    expect(saved).toMatchObject({ status: 'failed', error_code: 'timeout', report: null })
    await expect(enqueue()).resolves.toEqual(expect.any(String))
  })

  test('expired leases reject stale results and become failed on the next household poll', async () => {
    const foreignId = await enqueue(b)
    const foreign = (await claim(b))!
    await enqueue()
    const job = (await claim())!
    await raw`update diagnosis_jobs set lease_expires_at = now() - interval '1 second' where id in ${raw([job.id, foreignId])}`
    expect(await heartbeat(job)).toBe(false)
    expect(await finish(job)).toBe(false)
    expect(await claim()).toBeNull()
    const rows = await raw`select id, status, error_code from diagnosis_jobs where id in ${raw([job.id, foreignId])}`
    expect(rows.find((row) => row.id === job.id)).toMatchObject({ status: 'failed', error_code: 'lease_expired' })
    expect(rows.find((row) => row.id === foreign.id)?.status).toBe('running')
    await enqueue()
    const fresh = (await claim())!
    expect(fresh.claimToken).not.toBe(job.claimToken)
    expect(await finish(job)).toBe(false)
    expect(await finish(fresh)).toBe(true)
  })

  test('revocation immediately denies claiming, heartbeat, and completion', async () => {
    await enqueue()
    const job = (await claim())!
    await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
    expect(await heartbeat(job)).toBe(false)
    expect(await finish(job)).toBe(false)
    expect(await claim()).toBeNull()
    const [saved] = await raw`select status from diagnosis_jobs where id = ${job.id}`
    expect(saved.status).toBe('running')
  })
})

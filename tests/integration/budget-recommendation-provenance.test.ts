import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

const databaseUrl = process.env.DATABASE_URL!
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
for (const value of [databaseUrl, supabaseUrl]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) throw new Error('Queue tests require local Supabase')
}
const raw = postgres(databaseUrl, { prepare: false })
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const householdIds: string[] = []
const userIds: string[] = []
type Fixture = { householdId: string; userId: string; workerId: string; token: string; client: SupabaseClient }
let a: Fixture
let b: Fixture
const snapshot = { version: 1, month: '2026-09' }
const report = { version: 1, rows: [{ major: '식비', amount: 100000 }] }
async function rpc(name: string, args: Record<string, unknown>) {
  const result = await anon.rpc(name, args)
  if (result.error) throw result.error
  return result.data
}
async function fixture(): Promise<Fixture> {
  const email = `queue-${randomUUID()}@test.local`
  const password = randomBytes(24).toString('hex')
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userIds.push(data.user.id)
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  const [home] = await raw`insert into households (name) values ('TEST-budget-queue') returning id`
  householdIds.push(home.id)
  await raw`insert into household_members (household_id, user_id) values (${home.id}, ${data.user.id})`
  const token = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(token).digest('hex')
  const [worker] = await raw`insert into diagnosis_workers (household_id, token_hash, label)
    values (${home.id}, ${hash}, 'TEST queue') returning id`
  return { householdId: home.id, userId: data.user.id, workerId: worker.id, token, client }
}
beforeAll(async () => { a = await fixture(); b = await fixture() })
beforeEach(async () => {
  await raw`delete from budgets where household_id in ${raw(householdIds)}`
  await raw`delete from budget_recommendation_jobs where household_id in ${raw(householdIds)}`
  await raw`delete from diagnosis_jobs where household_id in ${raw(householdIds)}`
  await raw`update diagnosis_workers set revoked_at = null, budget_protocol_version = 0, budget_last_seen_at = null,
    prompt_protocol_version = 0, prompt_last_seen_at = null where household_id in ${raw(householdIds)}`
})
afterAll(async () => {
  if (householdIds.length) await raw`delete from households where id in ${raw(householdIds)}`
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
  await raw.end()
})
async function enqueue(owner = a, month = '2026-09', requestId = randomUUID(), input: unknown = null) {
  const [job] = await raw`insert into budget_recommendation_jobs
    (household_id, month, request_id, snapshot, prompt_input, fingerprint, requested_by)
    values (${owner.householdId}, ${month}, ${requestId}, ${raw.json({ ...snapshot, month })},
      ${input === null ? null : raw.json(input as never)}, ${'a'.repeat(64)}, ${owner.userId}) returning id`
  return job.id as string
}
async function ready(owner = a) {
  expect(await rpc('heartbeat_budget_worker', { p_token: owner.token })).toBe(true)
}
async function claim(owner = a) {
  return rpc('claim_budget_recommendation_job', { p_token: owner.token })
}
async function finish(job: { id: string; claimToken: string }, owner = a, value: unknown = report, errorCode: string | null = null) {
  return rpc('finish_budget_recommendation_job', { p_token: owner.token, p_job_id: job.id,
    p_claim_token: job.claimToken, p_report: value, p_error_code: errorCode })
}

test('provenance validates completed household/month/category while permitting adjusted amounts and household cascade', async () => {
  const id = await enqueue()
  const { db } = await import('@/db/client')
  const { budgets } = await import('@/db/schema')
  await expect(db.insert(budgets).values({ householdId: a.householdId, month: '2026-09',
    major: '식비', amount: 123456, recommendationJobId: id })).rejects.toMatchObject({ cause: { code: '23514' } })
  const write = (household = a.householdId, month = '2026-09', major = '식비') => raw`
    insert into budgets (household_id, month, major, amount, recommendation_job_id)
    values (${household}, ${month}, ${major}, 123456, ${id}) returning id`
  await expect(write()).rejects.toMatchObject({ code: '23514' })
  await ready(); await finish(await claim())
  for (const args of [[b.householdId, '2026-09', '식비'], [a.householdId, '2026-10', '식비'], [a.householdId, '2026-09', '교통비']]) {
    await expect(write(...args)).rejects.toMatchObject({ code: '23514' })
    await expect(db.insert(budgets).values({ householdId: args[0], month: args[1], major: args[2],
      amount: 123456, recommendationJobId: id })).rejects.toMatchObject({ cause: { code: '23514' } })
  }
  const [budget] = await write()
  expect((await raw`select amount from budgets where id = ${budget.id}`)[0].amount).toBe('123456')
  await expect(raw`update budgets set major = '교통비' where id = ${budget.id}`).rejects.toMatchObject({ code: '23514' })
  await expect(raw`delete from budget_recommendation_jobs where id = ${id}`).rejects.toMatchObject({ code: '23503' })
  expect((await a.client.from('budgets').update({ recommendation_job_id: id, month: '2026-10' }).eq('id', budget.id)).error).not.toBeNull()
  await raw`delete from households where id = ${a.householdId}`
  expect((await raw`select id from budget_recommendation_jobs where id = ${id}`)).toHaveLength(0)
})
test('application snapshot reads saved provenance and budget hash changes when only provenance changes', async () => {
  const { db } = await import('@/db/client')
  const { readBudgetSnapshot } = await import('@/features/budget-recommendations/snapshot')
  await raw`insert into categories (household_id, kind, major, sub) values (${b.householdId}, 'expense', '식비', '장보기')`
  const id = await enqueue(b)
  await ready(b); await finish(await claim(b), b)
  await raw`insert into budgets (household_id, month, major, amount) values (${b.householdId}, '2026-09', '식비', 123456)`
  const read = () => db.transaction(tx => readBudgetSnapshot(tx, b.householdId,
    { month: '2026-09', notes: '', plannedExpenses: [], draftAmounts: [] }, new Date('2026-09-10T00:00:00Z')),
    { isolationLevel: 'repeatable read', accessMode: 'read only' })
  const before = await read()
  await raw`update budgets set recommendation_job_id = ${id} where household_id = ${b.householdId}`
  const after = await read()
  expect(before.rows[0].savedRecommendationJobId).toBeNull()
  expect(after.rows[0].savedRecommendationJobId).toBe(id)
  expect(after.budgetHash).not.toBe(before.budgetHash)
  expect(after.sourceHash).toBe(before.sourceHash)
})

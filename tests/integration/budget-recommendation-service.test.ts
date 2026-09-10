import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { getBudgetRecommendationData, readApplicableBudgetRecommendation, readSavedBudgetRecommendations, requestBudgetRecommendation } from '@/features/budget-recommendations/service'
import type { BudgetRequest, BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'
import { hashBudgetPayload } from '@/features/budget-recommendations/snapshot'
import { createBudgetQueueFixture, type BudgetQueueHousehold } from '../fixtures/budget-queue'

const fixture = createBudgetQueueFixture()
const { raw } = fixture
let a: BudgetQueueHousehold
let b: BudgetQueueHousehold
let food: number
const month = '2026-09'
const request = (overrides: Partial<BudgetRequest> = {}): BudgetRequest => ({ requestId: randomUUID(), month, notes: '', plannedExpenses: [], draftAmounts: [], ...overrides })
const create = (input = request()) => requestBudgetRecommendation(a.householdId, a.userId, input)
const get = () => getBudgetRecommendationData(a.householdId, month)
beforeAll(async () => { ({ a, b } = await fixture.setup()) })
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T03:00:00Z'))
  await fixture.reset()
  await raw`delete from transactions where household_id in (${a.householdId}, ${b.householdId})`
  await raw`delete from categories where household_id in (${a.householdId}, ${b.householdId})`
  await raw`delete from ai_diagnosis_settings where household_id in (${a.householdId}, ${b.householdId})`
  const [category] = await raw`insert into categories (household_id, kind, major, sub) values (${a.householdId}, 'expense', '식비', '외식') returning id`
  food = Number(category.id)
  await raw`insert into transactions (household_id, date, flow, amount, category_id) values (${a.householdId}, '2026-01-01', 'income', 1000000, null), (${a.householdId}, '2026-09-01', 'expense', 10000, ${food})`
  await raw`update diagnosis_workers set budget_protocol_version = 1, prompt_protocol_version = 1, budget_last_seen_at = now(), prompt_last_seen_at = now() where id = ${a.workerId}`
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
afterAll(() => fixture.cleanup())
async function complete(input = request()) {
  const state = await create(input)
  const job = await fixture.claim(a)
  expect(job.id).toBe(state.latestJob?.id)
  const snapshot: BudgetRecommendationSnapshot = job.snapshot
  const report = { version: 1, summary: '월 전체 예산', limitations: [], overCeilingReason: '', adjustments: [], rows: snapshot.rows.map(row => ({ major: row.major, amount: 30000, reason: '계획', references: [], exceptional: [], reducible: [] })) }
  expect(await fixture.finish(job, a, report)).toBe(true)
  return { input, job }
}
async function completeFor(owner: BudgetQueueHousehold, input: BudgetRequest) {
  const state = await requestBudgetRecommendation(owner.householdId, owner.userId, input)
  const job = await fixture.claim(owner)
  expect(job.id).toBe(state.latestJob?.id)
  const snapshot: BudgetRecommendationSnapshot = job.snapshot
  const report = { version: 1, summary: '월 전체 예산', limitations: [], overCeilingReason: '', adjustments: [], rows: snapshot.rows.map(row => ({ major: row.major, amount: 30000, reason: '계획', references: [], exceptional: [], reducible: [] })) }
  expect(await fixture.finish(job, owner, report)).toBe(true)
  return job
}
test('freezes settings and recovers exact completed request A after newer B', async () => {
  await raw`insert into ai_diagnosis_settings (household_id, common_instructions, revision, updated_by) values (${a.householdId}, 'instruction A', 1, ${a.userId})`
  const first = await complete()
  expect(first.job.id).not.toBe(first.input.requestId)
  await raw`update ai_diagnosis_settings set common_instructions = 'instruction B', revision = 2 where household_id = ${a.householdId}`
  const second = await complete()
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'))
  const retried = await create(first.input)
  expect(retried.latestJob?.id).toBe(first.job.id)
  expect(retried.completed?.id).toBe(first.job.id)
  expect(retried.latestJob?.requestId).toBe(first.input.requestId)
  expect(retried.completed?.requestId).toBe(first.input.requestId)
  expect(retried.completed?.promptInput?.instructions.common).toBe('instruction A')
  expect(retried.completed?.snapshot).toEqual(first.job.snapshot)
  expect(retried.instructionsChanged).toBe(true)
  expect((await get()).completed?.id).toBe(second.job.id)

  const [before] = await raw`select * from budget_recommendation_jobs where household_id = ${a.householdId} and id = ${first.job.id}`
  const recovered = await getBudgetRecommendationData(a.householdId, month, first.input.requestId)
  expect(recovered.latestJob).toMatchObject({ id: first.job.id, requestId: first.input.requestId, status: 'completed' })
  expect(recovered.completed).toMatchObject({ id: first.job.id, requestId: first.input.requestId })
  const [after] = await raw`select * from budget_recommendation_jobs where household_id = ${a.householdId} and id = ${first.job.id}`
  expect(after).toEqual(before)
  const foreign = await getBudgetRecommendationData(b.householdId, month, first.input.requestId)
  expect(foreign.latestJob).toBeNull()
  expect(foreign.completed).toBeNull()
  const otherMonth = await getBudgetRecommendationData(a.householdId, '2026-10', first.input.requestId)
  expect(otherMonth.latestJob).toBeNull()
  expect(otherMonth.completed).toBeNull()
  expect((await getBudgetRecommendationData(a.householdId, month, randomUUID())).latestJob?.id).toBe(second.job.id)
})
test('same UUID conflicts before any input rebuilding and another active request conflicts', async () => {
  const input = request()
  const first = await create(input)
  await raw`delete from transactions where household_id = ${a.householdId}`
  expect((await create(input)).latestJob?.id).toBe(first.latestJob?.id)
  await expect(create({ ...input, month: '2026-10' })).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
  await expect(create({ ...input, notes: 'changed' })).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
  await expect(create()).rejects.toMatchObject({ code: 'active_job_exists', status: 409 })
})
test('GET projects expiration without writes and same UUID terminalizes without requeueing', async () => {
  const input = request()
  await create(input)
  const job = await fixture.claim(a)
  await raw`update budget_recommendation_jobs set lease_expires_at = now() - interval '1 second' where id = ${job.id}`
  const [before] = await raw`select * from budget_recommendation_jobs where id = ${job.id}`
  expect((await get()).latestJob).toMatchObject({ id: job.id, status: 'failed', errorCode: 'lease_expired' })
  const [after] = await raw`select * from budget_recommendation_jobs where id = ${job.id}`
  expect(after).toEqual(before)
  await expect(create({ ...input, notes: 'wrong' })).rejects.toMatchObject({ status: 409 })
  expect((await raw`select * from budget_recommendation_jobs where id = ${job.id}`)[0]).toEqual(before)
  expect((await create(input)).latestJob).toMatchObject({ id: job.id, status: 'failed', errorCode: 'lease_expired' })
  const [expired] = await raw`select status, claim_token, worker_id, lease_expires_at from budget_recommendation_jobs where id = ${job.id}`
  expect(expired).toEqual({ status: 'failed', claim_token: null, worker_id: null, lease_expires_at: null })
})
test('new UUID expires an old running job and queues for a previously capable offline worker', async () => {
  await create()
  const job = await fixture.claim(a)
  await raw`update budget_recommendation_jobs set lease_expires_at = now() - interval '1 second' where id = ${job.id}`
  await raw`update diagnosis_workers set budget_last_seen_at = now() - interval '10 minutes', prompt_last_seen_at = now() - interval '10 minutes' where id = ${a.workerId}`
  const state = await create()
  expect(state).toMatchObject({ worker: 'offline', latestJob: { status: 'queued' } })
  expect(state.latestJob?.id).not.toBe(job.id)
  expect((await raw`select status from budget_recommendation_jobs where id = ${job.id}`)[0].status).toBe('failed')
})
test('freshness allows adjusted own saves but rejects previous or manual drift and prioritizes source', async () => {
  const { job } = await complete()
  expect((await get()).freshness).toBe('current')
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id) values (${a.householdId}, ${month}, '식비', 35000, ${job.id})`
  expect((await get()).freshness).toBe('applied')
  expect((await readApplicableBudgetRecommendation(db, a.householdId, month, job.id)).id).toBe(job.id)
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, '2026-08', '식비', 20000)`
  expect((await get()).freshness).toBe('budgets_changed')
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, job.id)).rejects.toMatchObject({ code: 'budgets_changed' })
  await raw`update transactions set memo = 'changed' where household_id = ${a.householdId}`
  expect((await get()).freshness).toBe('source_changed')
  await expect(readApplicableBudgetRecommendation(db, b.householdId, month, job.id)).rejects.toMatchObject({ code: 'invalid_result' })
})
test('invalid stored output preserves previous success and never becomes applicable', async () => {
  const first = await complete()
  await create()
  const second = { job: await fixture.claim(a) }
  expect(await fixture.finish(second.job, a, { version: 1, rows: [] })).toBe(true)
  const state = await get()
  expect(state.latestJob).toMatchObject({ id: second.job.id, status: 'failed', errorCode: 'invalid_output' })
  expect(state.completed?.id).toBe(first.job.id)
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, second.job.id)).rejects.toMatchObject({ code: 'invalid_result' })
})
test('loads only valid saved provenance across historical, invalid and foreign references', async () => {
  await raw`insert into categories (household_id, kind, major, sub) values (${a.householdId}, 'expense', '건강', '병원')`
  const historical = await complete()
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id)
    values (${a.householdId}, ${month}, '식비', 30000, ${historical.job.id})`

  await raw`update transactions set memo = 'source changed after save' where household_id = ${a.householdId} and flow = 'expense'`
  const newer = await complete()
  expect(newer.job.id).not.toBe(historical.job.id)

  await create()
  const invalid = await fixture.claim(a)
  expect(await fixture.finish(invalid, a, { version: 1, rows: [{ major: '건강', amount: 30000 }] })).toBe(true)
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id)
    values (${a.householdId}, ${month}, '건강', 30000, ${invalid.id})`

  const otherMonth = await completeFor(a, request({ month: '2026-10' }))
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id)
    values (${a.householdId}, '2026-10', '식비', 30000, ${otherMonth.id})`

  const [bCategory] = await raw`insert into categories (household_id, kind, major, sub)
    values (${b.householdId}, 'expense', '식비', '외식') returning id`
  await raw`insert into transactions (household_id, date, flow, amount, category_id)
    values (${b.householdId}, '2026-01-01', 'income', 1000000, null), (${b.householdId}, '2026-09-01', 'expense', 10000, ${Number(bCategory.id)})`
  await raw`update diagnosis_workers set budget_protocol_version = 1, prompt_protocol_version = 1,
    budget_last_seen_at = now(), prompt_last_seen_at = now() where id = ${b.workerId}`
  const foreign = await completeFor(b, request())
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id)
    values (${b.householdId}, ${month}, '식비', 30000, ${foreign.id})`

  const saved = await readSavedBudgetRecommendations(db, a.householdId, month)
  expect(saved.map(item => item.id)).toEqual([historical.job.id])
  expect(saved[0].report.rows.find(row => row.major === '식비')?.reason).toBe('계획')
  expect(saved.map(item => item.id)).not.toContain(newer.job.id)
  expect(saved.map(item => item.id)).not.toContain(invalid.id)
  expect(saved.map(item => item.id)).not.toContain(otherMonth.id)
  expect(saved.map(item => item.id)).not.toContain(foreign.id)
  expect(await raw`select major, recommendation_job_id from budgets where household_id = ${a.householdId} and month = ${month} order by major`).toEqual([
    { major: '건강', recommendation_job_id: invalid.id },
    { major: '식비', recommendation_job_id: historical.job.id },
  ])
})
test('snapshot failure rolls back expiration and creates no new job', async () => {
  await create()
  const job = await fixture.claim(a)
  await raw`update budget_recommendation_jobs set lease_expires_at = now() - interval '1 second' where id = ${job.id}`
  await raw`update transactions set amount = 9007199254740992 where household_id = ${a.householdId} and flow = 'income'`
  await expect(create()).rejects.toMatchObject({ code: 'invalid_input' })
  const rows = await raw`select status from budget_recommendation_jobs where household_id = ${a.householdId}`
  expect(rows.map(row => row.status)).toEqual(['running'])
})

test.each(['23505', '40001'])('wrapped %s recovery returns addressed A, never later B', async code => {
  const first = await complete()
  await complete()
  vi.spyOn(db, 'transaction').mockRejectedValueOnce(Object.assign(new Error('wrapped'), { cause: { code } }))
  const retried = await create(first.input)
  expect(retried.latestJob?.id).toBe(first.job.id)
  expect(retried.completed?.id).toBe(first.job.id)
  expect(retried.completed?.snapshot).toEqual(first.job.snapshot)
})
test('concurrent equal requests deduplicate while changed input conflicts', async () => {
  const input = request()
  const states = await Promise.all([create(input), create(input), create(input)])
  expect(new Set(states.map(state => state.latestJob?.id)).size).toBe(1)
  const outcomes = await Promise.allSettled([create(input), create({ ...input, notes: 'different' })])
  expect(outcomes[0].status).toBe('fulfilled')
  expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'request_conflict' } })
  expect((await raw`select id from budget_recommendation_jobs where household_id = ${a.householdId}`)).toHaveLength(1)
})
test('a retry of queued A retains only its preceding success even when B later completes', async () => {
  const preceding = await complete()
  const input = request()
  await create(input)
  const claimed = await fixture.claim(a)
  await fixture.finish(claimed, a, null, 'cli_failed')
  await complete()
  const retry = await create(input)
  expect(retry.latestJob?.id).toBe(claimed.id)
  expect(retry.completed?.id).toBe(preceding.job.id)
})
test('prompt scope changes advise only the affected budget instructions', async () => {
  await raw`insert into ai_diagnosis_settings (household_id, revision, updated_by) values (${a.householdId}, 1, ${a.userId})`
  await complete()
  await raw`update ai_diagnosis_settings set ledger_instructions = 'ledger only', revision = revision + 1 where household_id = ${a.householdId}`
  expect((await get()).instructionsChanged).toBe(false)
  await raw`update ai_diagnosis_settings set budget_instructions = 'budget only', revision = revision + 1 where household_id = ${a.householdId}`
  expect((await get()).instructionsChanged).toBe(true)
  expect((await get()).freshness).toBe('current')
})
test.each(['current_amount', 'current_source', 'previous_amount', 'previous_source', 'fallback'])('detects exact %s tuple drift', async kind => {
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, '*', '식비', 20000)`
  const { job } = await complete()
  if (kind === 'fallback') await raw`update budgets set amount = 21000 where household_id = ${a.householdId}`
  else await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, ${kind.startsWith('current') ? month : '2026-08'}, '식비', ${kind.endsWith('amount') ? 21000 : 20000})`
  const state = await get()
  expect(state.freshness).toBe('budgets_changed')
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, job.id)).rejects.toMatchObject({ code: 'budgets_changed' })
})
test('mixed own and manual changes cannot be called applied', async () => {
  await raw`insert into categories (household_id, kind, major, sub) values (${a.householdId}, 'expense', '건강', '병원')`
  const { job } = await complete()
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id) values (${a.householdId}, ${month}, '식비', 35000, ${job.id}), (${a.householdId}, ${month}, '건강', 35000, null)`
  expect((await get()).freshness).toBe('budgets_changed')
})
test('foreign recommendation provenance and clearing own provenance invalidate application', async () => {
  const first = await complete()
  const second = await complete()
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id) values (${a.householdId}, ${month}, '식비', 35000, ${second.job.id})`
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, first.job.id)).rejects.toMatchObject({ code: 'budgets_changed' })
  expect((await get()).freshness).toBe('applied')
  await raw`update budgets set recommendation_job_id = null where household_id = ${a.householdId}`
  expect((await get()).freshness).toBe('budgets_changed')
})
test('previous-month provenance-only drift blocks an otherwise unchanged recommendation', async () => {
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, '2026-08', '식비', 20000)`
  const { job } = await complete()
  const [previous] = await raw`insert into budget_recommendation_jobs (household_id, month, request_id, requested_by, snapshot, fingerprint, report, status, completed_at)
    values (${a.householdId}, '2026-08', ${randomUUID()}, ${a.userId}, '{"version":1,"month":"2026-08"}'::jsonb,
      ${'a'.repeat(64)}, '{"version":1,"rows":[{"major":"식비","amount":20000}]}'::jsonb, 'completed', now()) returning id`
  await raw`update budgets set recommendation_job_id = ${previous.id} where household_id = ${a.householdId} and month = '2026-08'`
  expect((await get()).freshness).toBe('budgets_changed')
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, job.id)).rejects.toMatchObject({ code: 'budgets_changed' })
})
test('saved input whose category disappeared is source_changed, without an uncaught input error', async () => {
  const { job } = await complete(request({ draftAmounts: [{ major: '식비', amount: 30000 }] }))
  await raw`update categories set hidden = true where household_id = ${a.householdId}`
  expect((await get()).freshness).toBe('source_changed')
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, job.id)).rejects.toMatchObject({ code: 'source_changed' })
})
test('malformed stored baseline is unavailable; null-prompt historical missing baseline remains displayable', async () => {
  const { job } = await complete()
  const [source] = await raw`select snapshot, report, fingerprint from budget_recommendation_jobs where id = ${job.id}`
  const insert = async (snapshot: Record<string, unknown>) => {
    const [row] = await raw`insert into budget_recommendation_jobs (household_id, month, request_id, requested_by, snapshot, fingerprint, report, status, completed_at)
      values (${a.householdId}, ${month}, ${randomUUID()}, ${a.userId}, ${raw.json(snapshot as never)}, ${source.fingerprint}, ${raw.json(source.report)}, 'completed', now()) returning id`
    return row.id as string
  }
  const malformed = await insert({ ...source.snapshot, budgetState: { month, current: null, previous: [] } })
  expect((await get()).latestJob).toMatchObject({ id: malformed, status: 'failed', errorCode: 'invalid_output' })
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, malformed)).rejects.toMatchObject({ code: 'invalid_result' })
  const malformedIdState = structuredClone(source.snapshot)
  malformedIdState.budgetState.current[0].recommendationJobId = 'aaaaaaaa----------------------------'
  malformedIdState.budgetHash = hashBudgetPayload(malformedIdState.budgetState)
  const malformedId = await insert(malformedIdState)
  await expect(readApplicableBudgetRecommendation(db, a.householdId, month, malformedId)).rejects.toMatchObject({ code: 'invalid_result' })
  const historical = { ...source.snapshot }; delete historical.budgetState
  const legacyId = await insert(historical)
  expect((await get()).completed).toMatchObject({ id: legacyId, promptInput: null })
  expect((await get()).freshness).toBe('current')
  await raw`insert into budgets (household_id, month, major, amount, recommendation_job_id) values (${a.householdId}, ${month}, '식비', 30000, ${legacyId})`
  expect((await get()).freshness).toBe('budgets_changed')
})
test('capabilities must belong to the same unrevoked worker', async () => {
  await raw`update diagnosis_workers set prompt_protocol_version = 0, prompt_last_seen_at = null where id = ${a.workerId}`
  const [split] = await raw`insert into diagnosis_workers (household_id, token_hash, label, prompt_protocol_version, prompt_last_seen_at)
    values (${a.householdId}, ${randomUUID().replaceAll('-', '').repeat(2)}, 'TEST split capability', 1, now()) returning id`
  expect((await get()).worker).toBe('upgrade_required')
  await expect(create()).rejects.toMatchObject({ code: 'setup_required', status: 503 })
  await raw`delete from diagnosis_workers where id = ${split.id}`
  await raw`update diagnosis_workers set prompt_protocol_version = 1, prompt_last_seen_at = now(), budget_last_seen_at = now() - interval '10 minutes' where id = ${a.workerId}`
  expect((await get()).worker).toBe('offline')
  await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
  expect((await get()).worker).toBe('not_registered')
  await expect(create()).rejects.toMatchObject({ code: 'setup_required' })
})

test('normal GET chooses the most recent valid completion independently of newest job creation', async () => {
  const { job } = await complete()
  const [source] = await raw`select snapshot, report, fingerprint from budget_recommendation_jobs where id = ${job.id}`
  const [late] = await raw`insert into budget_recommendation_jobs (household_id, month, request_id, requested_by, snapshot, fingerprint, report, status, created_at, completed_at)
    values (${a.householdId}, ${month}, ${randomUUID()}, ${a.userId}, ${raw.json(source.snapshot)}, ${source.fingerprint}, ${raw.json(source.report)}, 'completed', now() - interval '1 day', now() + interval '1 second') returning id`
  const state = await get()
  expect(state.latestJob).toMatchObject({ id: job.id, status: 'completed' })
  expect(state.completed?.id).toBe(late.id)
})
test('missing canonical income and December rollover obey current/next eligibility while past GET stays readable', async () => {
  expect((await getBudgetRecommendationData(a.householdId, '2020-01')).availability).toBe('past_or_distant_month')
  await expect(create(request({ month: '2026-11' }))).rejects.toMatchObject({ code: 'past_or_distant_month' })
  vi.setSystemTime(new Date('2026-12-31T14:59:59Z'))
  expect((await create(request({ month: '2026-12' }))).latestJob?.status).toBe('queued')
  await expect(create(request({ month: '2027-01' }))).rejects.toMatchObject({ code: 'missing_income' })
  vi.setSystemTime(new Date('2026-12-31T15:00:00Z'))
  await expect(create(request({ month: '2027-03' }))).rejects.toMatchObject({ code: 'past_or_distant_month' })
  await raw`delete from transactions where household_id = ${a.householdId}`
  await expect(create(request({ month: '2027-01' }))).rejects.toMatchObject({ code: 'missing_income' })
})
test('only allowlisted missing schema errors become setup_required', async () => {
  const missing = Object.assign(new Error('wrapped'), { cause: { code: '42703', message: 'column "prompt_input" does not exist' } })
  vi.spyOn(db, 'transaction').mockRejectedValueOnce(missing)
  expect((await get()).availability).toBe('setup_required')
  vi.spyOn(db, 'transaction').mockRejectedValueOnce(missing)
  await expect(create()).rejects.toMatchObject({ code: 'setup_required' })
  const unexpected = Object.assign(new Error('wrapped'), { cause: { code: '42P01', message: 'relation "transactions" does not exist' } })
  vi.spyOn(db, 'transaction').mockRejectedValueOnce(unexpected)
  await expect(get()).rejects.toBe(unexpected)
})

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { readBudgetBaselines, readBudgetSaveEvaluation, saveBudgetChanges } from '@/features/budgets/save-service'
import type { BudgetSaveRequest } from '@/features/budgets/save-contract'
import { requestBudgetRecommendation } from '@/features/budget-recommendations/service'
import { createBudgetQueueFixture, type BudgetQueueHousehold } from '../fixtures/budget-queue'

const fixture = createBudgetQueueFixture()
const { raw } = fixture
let a: BudgetQueueHousehold
let b: BudgetQueueHousehold
let food: number
const month = '2026-09'
const read = () => readBudgetBaselines(db, a.householdId, month)
const save = (request: BudgetSaveRequest) => saveBudgetChanges(a.householdId, request)
async function patch(major = '식비', amount = 723693): Promise<BudgetSaveRequest> {
  const baseline = (await read()).rows.find(row => row.major === major)!
  return { month, changes: [{ major, amount, recommendationJobId: null, expectedVersion: baseline.version }],
    targetChange: null, acknowledgeOverage: true }
}
beforeAll(async () => { ({ a, b } = await fixture.setup()) })
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T03:00:00Z'))
  await fixture.reset()
  await raw`delete from transactions where household_id = ${a.householdId}`
  await raw`delete from recurring where household_id = ${a.householdId}`
  await raw`delete from categories where household_id = ${a.householdId}`
  await raw`delete from settings where household_id = ${a.householdId}`
  const [category] = await raw`insert into categories (household_id, kind, major, sub) values
    (${a.householdId}, 'expense', '식비', '외식'), (${a.householdId}, 'expense', '교통', '버스') returning id`
  food = Number(category.id)
  await raw`insert into budgets (household_id, month, major, amount) values
    (${a.householdId}, ${month}, '식비', 100000), (${a.householdId}, ${month}, '교통', 20000),
    (${b.householdId}, ${month}, '식비', 111)`
  await raw`insert into transactions (household_id, date, flow, amount, category_id) values
    (${a.householdId}, '2026-01-01', 'income', 1000000, null), (${a.householdId}, '2026-09-01', 'expense', 10000, ${food})`
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
afterAll(fixture.cleanup)

test('partial exact-won save preserves untouched and foreign rows and does not create settings', async () => {
  const before = await read()
  const request = await patch()
  const result = await save(request)
  expect(result.rows.find(row => row.major === '식비')?.amount).toBe(723693)
  expect(result.rows.find(row => row.major === '교통')).toEqual(before.rows.find(row => row.major === '교통'))
  expect(await raw`select value from settings where household_id = ${a.householdId}`).toHaveLength(0)
  expect((await raw`select amount from budgets where household_id = ${b.householdId}`)[0].amount).toBe('111')
  expect(await save(request)).toEqual(result)
  expect(await raw`select id from budgets where household_id = ${a.householdId}`).toHaveLength(2)
  await expect(save({ ...request, changes: [{ ...request.changes[0], amount: 700000 }] })).rejects.toThrow('budget_conflict')
  expect(await read()).toEqual({ rows: result.rows, savingsTarget: result.savingsTarget, targetVersion: result.targetVersion })
})
test('conflict in any row rolls back all changes and explicit target', async () => {
  const first = await patch()
  const other = await patch('교통', 30000)
  const baseline = await read()
  await save(other)
  await expect(save({ ...first, changes: [...first.changes, { ...other.changes[0], amount: 40000 }],
    targetChange: { value: 40, expectedVersion: baseline.targetVersion } })).rejects.toThrow('budget_conflict')
  expect((await read()).rows.find(row => row.major === '식비')?.amount).toBe(100000)
  expect(await raw`select value from settings where household_id = ${a.householdId}`).toHaveLength(0)
})
test('concurrent conflicting saves have one winner without replaying stale intent', async () => {
  const request = await patch()
  const results = await Promise.allSettled([save(request), save({ ...request, changes: [{ ...request.changes[0], amount: 700000 }] })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'budget_conflict' } })
})
test('concurrent inserts into a missing baseline have one winner and no duplicate rows', async () => {
  await raw`delete from budgets where household_id = ${a.householdId} and major = '식비'`
  const request = await patch()
  const results = await Promise.allSettled([save(request), save({ ...request, changes: [{ ...request.changes[0], amount: 700000 }] })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'budget_conflict' } })
  expect(await raw`select id from budgets where household_id = ${a.householdId} and major = '식비'`).toHaveLength(1)
})
test('versions distinguish missing, fallback, explicit zero, and raw target presence', async () => {
  await raw`delete from budgets where household_id = ${a.householdId}`
  const missing = await read()
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, '*', '식비', 0)`
  const fallback = await read()
  expect(fallback.rows.find(row => row.major === '식비')?.version).not.toBe(missing.rows.find(row => row.major === '식비')?.version)
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, ${month}, '식비', 0)`
  const explicit = await read()
  expect(explicit.rows.find(row => row.major === '식비')?.version).not.toBe(fallback.rows.find(row => row.major === '식비')?.version)
  await raw`insert into settings (household_id, key, value) values (${a.householdId}, 'savings_target', '30')`
  expect((await read()).targetVersion).not.toBe(missing.targetVersion)
  const stale = { month, changes: [], targetChange: { value: 40, expectedVersion: missing.targetVersion }, acknowledgeOverage: true }
  await expect(save(stale)).rejects.toThrow('budget_conflict')
})
test('concurrent explicit targets across months use the household target version', async () => {
  const baseline = await read()
  const request: BudgetSaveRequest = { month, changes: [], targetChange: { value: 40, expectedVersion: baseline.targetVersion }, acknowledgeOverage: true }
  const results = await Promise.allSettled([save(request), save({ ...request, month: '2026-10', targetChange: { ...request.targetChange!, value: 50 } })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'budget_conflict' } })
  expect(await raw`select value from settings where household_id = ${a.householdId}`).toHaveLength(1)
})
test('fallback mutation invalidates a changed row while unrelated explicit rows stay valid', async () => {
  await raw`delete from budgets where household_id = ${a.householdId} and major = '식비'`
  await raw`insert into budgets (household_id, month, major, amount) values (${a.householdId}, '*', '식비', 50000)`
  const request = await patch()
  await raw`update budgets set amount = 60000 where household_id = ${a.householdId} and month = '*'`
  await expect(save(request)).rejects.toThrow('budget_conflict')
})
test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid amount %s atomically', async amount => {
  const before = await read()
  await expect(save(await patch('식비', amount))).rejects.toThrow('invalid_input')
  expect(await read()).toEqual(before)
})
test('rejects inactive or unknown majors without saving the valid sibling', async () => {
  const request = await patch()
  await expect(save({ ...request, changes: [...request.changes, { ...request.changes[0], major: '없는분류' }] })).rejects.toThrow('invalid_input')
  expect((await read()).rows.find(row => row.major === '식비')?.amount).toBe(100000)
})
test('evaluates latest untouched rows and requires overage confirmation', async () => {
  const request = await patch('식비', 500000)
  await save(await patch('교통', 300000))
  await expect(save({ ...request, acknowledgeOverage: false })).rejects.toThrow('overage_confirmation_required')
  const result = await save(request)
  expect(result.total).toBe(800000)
  expect(result.overage).toBe(100000)
})
test('manual historical saves need no income, worker, model evidence, or holiday dates', async () => {
  await raw`delete from transactions where household_id = ${a.householdId}`
  await raw`insert into recurring (household_id, flow, amount, adjust_to_business_day) values (${a.householdId}, 'expense', 7000, true)`
  const baseline = await readBudgetBaselines(db, a.householdId, '1990-01')
  const result = await saveBudgetChanges(a.householdId, { month: '1990-01', changes: [{ major: '식비', amount: 123,
    recommendationJobId: null, expectedVersion: baseline.rows.find(row => row.major === '식비')!.version }], targetChange: null, acknowledgeOverage: true })
  expect(result.total).toBe(7123)
  expect(result.overage).toBe(7123)
})
test('manual save remains available with aggregate recurring evidence larger than the model limit', async () => {
  await raw`insert into recurring (household_id, flow, amount, category_id, memo) values
    (${a.householdId}, 'expense', 1, ${food}, ${'큰'.repeat(400000)})`
  expect((await save(await patch('식비', 123))).rows.find(row => row.major === '식비')?.amount).toBe(123)
})
test('rejects aggregate overflow even when each changed row is a valid integer', async () => {
  const request = await patch('식비', Number.MAX_SAFE_INTEGER)
  await expect(save(request)).rejects.toThrow('invalid_amount')
  expect((await read()).rows.find(row => row.major === '식비')?.amount).toBe(100000)
})
test('unallocated reserve includes signed hidden/null actuals and due unposted hidden rules with posting identity', async () => {
  const [hidden] = await raw`insert into categories (household_id, kind, major, sub, hidden) values (${a.householdId}, 'expense', '식비', '숨김', true) returning id`
  await raw`insert into transactions (household_id, date, flow, amount, category_id) values
    (${a.householdId}, '2026-09-01', 'expense', 3000, ${hidden.id}), (${a.householdId}, '2026-09-02', 'expense', -1000, null)`
  const rules = await raw`insert into recurring (household_id, flow, amount, category_id, start_month, end_month, adjust_to_business_day) values
    (${a.householdId}, 'expense', 4000, ${hidden.id}, null, null, true),
    (${a.householdId}, 'expense', 9000, null, '2026-10', null, false),
    (${a.householdId}, 'expense', 8000, null, null, '2026-08', false),
    (${a.householdId}, 'expense', 6000, null, null, null, false) returning id`
  await raw`insert into transactions (household_id, date, flow, amount, recurring_id, import_uid) values
    (${a.householdId}, '2026-10-01', 'expense', 6000, ${rules[3].id}, ${`recurring:${rules[3].id}:${month}`})`
  const evaluation = await readBudgetSaveEvaluation(db, a.householdId, month, [{ major: '교통', amount: 20000 }, { major: '식비', amount: 100000 }])
  expect(evaluation.unallocatedReserve).toBe(6000)
  expect(evaluation.total).toBe(126000)
  expect(evaluation.rows.find(row => row.major === '식비')?.remainingAllocation).toBe(90000)
})
async function complete(jobMonth = month, invalidReport = false) {
  await raw`update diagnosis_workers set budget_protocol_version = 1, prompt_protocol_version = 1, budget_last_seen_at = now(), prompt_last_seen_at = now() where id = ${a.workerId}`
  await requestBudgetRecommendation(a.householdId, a.userId, { month: jobMonth, requestId: randomUUID(), notes: '', plannedExpenses: [], draftAmounts: [] })
  const job = await fixture.claim(a)
  await fixture.finish(job, a, invalidReport ? {} : { version: 1, summary: '월 예산', limitations: [], overCeilingReason: '', adjustments: [],
    rows: ['교통', '식비'].map(major => ({ major, amount: 50000, reason: '기록 기반', references: [], exceptional: [], reducible: [] })) })
  return job.id as string
}
test('AI user adjustment preserves origin even below the proposal floor and explicit conversion clears it', async () => {
  const id = await complete()
  const request = await patch('식비', 1)
  request.changes[0].recommendationJobId = id
  const result = await save(request)
  expect(result.rows.find(row => row.major === '식비')).toMatchObject({ amount: 1, recommendationJobId: id })
  expect(await save(request)).toEqual(result)
  await raw`update transactions set amount = 12000 where household_id = ${a.householdId} and flow = 'expense'`
  const stale = await patch('식비', 2)
  stale.changes[0].recommendationJobId = id
  await expect(save(stale)).rejects.toThrow('source_changed')
  stale.changes[0].recommendationJobId = null
  expect((await save(stale)).rows.find(row => row.major === '식비')).toMatchObject({ amount: 2, recommendationJobId: null })
})
test('target changes reject mixed AI saves and invalidate prior reports', async () => {
  const id = await complete()
  const request = await patch('식비', 50000)
  request.changes[0].recommendationJobId = id
  const baseline = await read()
  await expect(save({ ...request, targetChange: { value: 40, expectedVersion: baseline.targetVersion } })).rejects.toThrow('save_target_first')
  await save({ ...request, changes: [], targetChange: { value: 40, expectedVersion: baseline.targetVersion } })
  await expect(save(request)).rejects.toThrow('source_changed')
})
test.each(['foreign', 'unfinished', 'wrong-month', 'missing-row', 'invalid-report'])('rejects %s recommendation and rolls back valid manual sibling', async kind => {
  let id: string
  if (kind === 'foreign') id = await fixture.enqueue(b)
  else if (kind === 'unfinished') id = await fixture.enqueue(a)
  else {
    id = await complete(kind === 'wrong-month' ? '2026-10' : month, kind === 'invalid-report')
    if (kind === 'missing-row') {
      await raw`insert into categories (household_id, kind, major, sub) values (${a.householdId}, 'expense', '신규', '신규')`
    }
  }
  const ai = await patch(kind === 'missing-row' ? '신규' : '식비', 60000)
  ai.changes[0].recommendationJobId = id
  const manual = await patch('교통', 33333)
  await expect(save({ ...ai, changes: [...manual.changes, ...ai.changes] })).rejects.toThrow()
  expect((await read()).rows.find(row => row.major === '교통')?.amount).toBe(20000)
})

import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { createBudgetQueueFixture, type BudgetQueueHousehold } from '../fixtures/budget-queue'

const fixture = createBudgetQueueFixture()
const { raw, enqueue, ready, claim, finish } = fixture
let a: BudgetQueueHousehold
let b: BudgetQueueHousehold
beforeAll(async () => { ({ a, b } = await fixture.setup()) })
beforeEach(fixture.reset)
afterAll(fixture.cleanup)

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

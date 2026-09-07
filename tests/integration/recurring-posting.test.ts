import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { households, recurring, transactions } from '@/db/schema'
import { getHomeTodos } from '@/features/analytics/home-todos'
import { saveTransaction } from '@/features/ledger/actions'
import { applyRecurringMonth } from '@/features/recurring/actions'
import { getRecurringData } from '@/features/recurring/queries'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'

const context = vi.hoisted(() => ({ householdId: '' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) },
}))

const month = currentMonthInKorea()
const nextMonth = shiftMonth(month, 1)
let ruleId: number

beforeEach(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-recurring-posting' }).returning()
  context.householdId = household.id
  const [rule] = await db.insert(recurring).values({
    householdId: household.id, flow: 'expense', memo: '정기 지출', amount: 5000, day: 15,
  }).returning()
  ruleId = rule.id
})

afterEach(async () => {
  await db.delete(households).where(eq(households.id, context.householdId))
})

async function post(targetMonth: string, added: number, skipped: number) {
  const form = new FormData()
  form.set('month', targetMonth)
  await expect(applyRecurringMonth(form)).rejects.toThrow(
    `REDIRECT:/ledger?month=${targetMonth}&recurringAdded=${added}&recurringSkipped=${skipped}`,
  )
}

function editForm(id: number, date: string) {
  const form = new FormData()
  Object.entries({
    transactionId: String(id), date, flow: 'expense', amount: '5000', memo: '정기 지출', inline: '1',
  }).forEach(([key, value]) => form.set(key, value))
  return form
}

async function postedRows() {
  return db.select().from(transactions).where(eq(transactions.householdId, context.householdId))
}

test('date edits preserve the source month in both recurring status and home todos', async () => {
  await post(month, 1, 0)
  const [row] = await postedRows()
  expect(await saveTransaction({}, editForm(row.id, `${nextMonth}-15`))).toHaveProperty('saved')
  await post(month, 0, 1)
  expect(await postedRows()).toHaveLength(1)
  expect((await getRecurringData(context.householdId, month)).generatedCount).toBe(1)
  expect((await getRecurringData(context.householdId, nextMonth)).generatedCount).toBe(0)
  expect((await getHomeTodos(context.householdId)).some((todo) => todo.kind === 'recurring')).toBe(false)
})

test('a moved posting does not prevent the following month from being generated', async () => {
  await post(month, 1, 0)
  const [row] = await postedRows()
  await saveTransaction({}, editForm(row.id, `${nextMonth}-15`))
  await post(nextMonth, 1, 0)
  expect((await postedRows()).map((item) => item.importUid).sort()).toEqual([
    `recurring:${ruleId}:${month}`, `recurring:${ruleId}:${nextMonth}`,
  ].sort())
})

test('stamps a legacy null-UID posting with its original month before moving its date', async () => {
  const [legacy] = await db.insert(transactions).values({
    householdId: context.householdId, recurringId: ruleId, date: `${month}-15`,
    flow: 'expense', amount: 5000, source: 'recurring',
  }).returning()
  expect((await getRecurringData(context.householdId, month)).generatedCount).toBe(1)
  await saveTransaction({}, editForm(legacy.id, `${nextMonth}-15`))
  const [saved] = await postedRows()
  expect(saved.importUid).toBe(`recurring:${ruleId}:${month}`)
  await post(month, 0, 1)
  await post(nextMonth, 1, 0)
  expect(await postedRows()).toHaveLength(2)
})

test('concurrent month posting inserts exactly one transaction', async () => {
  const form = new FormData()
  form.set('month', month)
  const results = await Promise.allSettled([applyRecurringMonth(form), applyRecurringMonth(form)])
  expect(results.every((result) => result.status === 'rejected' && String(result.reason).includes('REDIRECT:'))).toBe(true)
  const rows = await postedRows()
  expect(rows).toHaveLength(1)
  expect(rows[0].importUid).toBe(`recurring:${ruleId}:${month}`)
})

test('a legacy identity conflict returns a reviewable error without changing the date', async () => {
  await post(month, 1, 0)
  const [legacy] = await db.insert(transactions).values({
    householdId: context.householdId, recurringId: ruleId, date: `${month}-15`,
    flow: 'expense', amount: 5000, source: 'recurring',
  }).returning()
  const result = await saveTransaction({}, editForm(legacy.id, `${nextMonth}-15`))
  expect(result.error).toContain('정기거래')
  expect(result.saved).toBeUndefined()
  const [unchanged] = await db.select().from(transactions).where(and(
    eq(transactions.householdId, context.householdId), eq(transactions.id, legacy.id),
  ))
  expect(unchanged.date).toBe(`${month}-15`)
  expect(unchanged.importUid).toBeNull()
})

test('manual and imported transactions keep their identities when edited', async () => {
  for (const importUid of [null, 'existing-import-fingerprint']) {
    const [row] = await db.insert(transactions).values({
      householdId: context.householdId, date: `${month}-15`, flow: 'expense', amount: 5000,
      source: importUid ? 'banksalad:dj' : 'manual', importUid,
    }).returning()
    expect(await saveTransaction({}, editForm(row.id, `${nextMonth}-15`))).toHaveProperty('saved')
    const saved = (await postedRows()).find((item) => item.id === row.id)!
    expect(saved.importUid).toBe(importUid)
    expect(saved.recurringId).toBeNull()
  }
})

test('another household cannot mark this household rule as posted', async () => {
  const [foreign] = await db.insert(households).values({ name: 'TEST-recurring-foreign' }).returning()
  try {
    // The schema allows this cross-household reference; queries must still
    // isolate it rather than suppressing our household's pending rule.
    await db.insert(transactions).values({
      householdId: foreign.id, recurringId: ruleId, date: `${month}-15`,
      flow: 'expense', amount: 5000, source: 'recurring', importUid: `recurring:${ruleId}:${month}`,
    })
    expect((await getRecurringData(context.householdId, month)).generatedCount).toBe(0)
    expect((await getHomeTodos(context.householdId)).some((todo) => todo.kind === 'recurring')).toBe(true)
    await post(month, 1, 0)
    expect(await postedRows()).toHaveLength(1)
  } finally {
    await db.delete(households).where(eq(households.id, foreign.id))
  }
})

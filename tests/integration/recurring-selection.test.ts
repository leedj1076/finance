import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { households, recurring, transactions } from '@/db/schema'
import { applySelectedRecurringMonth, loadPendingRecurringMonth } from '@/features/recurring/actions'

const auth = vi.hoisted(() => ({ householdId: '', signedIn: true }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => auth.signedIn ? auth : null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let ids: number[]
let otherHousehold: string
let foreignId: number
beforeEach(async () => {
  auth.signedIn = true
  const own = await db.insert(households).values({ name: 'TEST-recurring-select' }).returning()
  const other = await db.insert(households).values({ name: 'TEST-recurring-select-other' }).returning()
  auth.householdId = own[0].id
  otherHousehold = other[0].id
  const rows = await db.insert(recurring).values([
    { householdId: auth.householdId, flow: 'expense', memo: '월세', amount: 500000, day: 10 },
    { householdId: auth.householdId, flow: 'saving', memo: '부모급여 (X회)', amount: 500000, day: 25, startMonth: '2026-09', endMonth: '2027-04', startOccurrence: 17, adjustToBusinessDay: true },
    { householdId: auth.householdId, flow: 'expense', memo: '비활성', amount: 100, day: 1, active: false },
    { householdId: auth.householdId, flow: 'expense', memo: '종료', amount: 100, day: 1, endMonth: '2026-08' },
    { householdId: otherHousehold, flow: 'expense', memo: '다른 가구', amount: 100, day: 1 },
  ]).returning()
  ids = rows.slice(0, 4).map(row => row.id)
  foreignId = rows[4].id
})
afterEach(async () => {
  await db.delete(households).where(eq(households.id, auth.householdId))
  await db.delete(households).where(eq(households.id, otherHousehold))
})
const rows = () => db.select().from(transactions).where(eq(transactions.householdId, auth.householdId))

test('preview lists only pending due rules, using the actual numbered memo and business date', async () => {
  const preview = await loadPendingRecurringMonth('2026-09')
  expect(preview.error).toBeUndefined()
  expect(preview.rows).toEqual([
    expect.objectContaining({ id: ids[0], date: '2026-09-10', memo: '월세', amount: 500000 }),
    expect.objectContaining({ id: ids[1], date: '2026-09-23', memo: '부모급여 (17회)', amount: 500000 }),
  ])
  expect(await rows()).toHaveLength(0)
})

test('only selected rules are posted; unselected rules stay pending and schedules are unchanged', async () => {
  const result = await applySelectedRecurringMonth('2026-09', [ids[1], ids[1]])
  expect(result).toMatchObject({ ok: true, added: 1, skipped: 0, remaining: 1, handledIds: [ids[1]] })
  expect(await rows()).toEqual([expect.objectContaining({ recurringId: ids[1], date: '2026-09-23', memo: '부모급여 (17회)', importUid: `recurring:${ids[1]}:2026-09` })])
  expect((await loadPendingRecurringMonth('2026-09')).rows?.map(row => row.id)).toEqual([ids[0]])
  const [unchanged] = await db.select().from(recurring).where(eq(recurring.id, ids[1]))
  expect(unchanged).toMatchObject({ memo: '부모급여 (X회)', active: true, day: 25, endMonth: '2027-04' })
})

test('empty, malformed, foreign and non-due selections fail closed without posting other rules', async () => {
  for (const selection of [[], [0], [1.5], [ids[0], foreignId], [ids[0], ids[2]], [ids[3]], 'all', null]) {
    const result = await applySelectedRecurringMonth('2026-09', selection as number[])
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(await rows()).toHaveLength(0)
  }
  expect((await applySelectedRecurringMonth('bad-month', [ids[0]])).ok).toBe(false)
})

test('concurrent or stale selections cannot duplicate a posted rule', async () => {
  const result = await Promise.all([
    applySelectedRecurringMonth('2026-09', [ids[0]]),
    applySelectedRecurringMonth('2026-09', [ids[0]]),
  ])
  expect(result.map(item => item.added).sort()).toEqual([0, 1])
  expect(result.every(item => item.ok && item.remaining === 1)).toBe(true)
  expect(await rows()).toHaveLength(1)
  expect((await loadPendingRecurringMonth('2026-09')).rows?.map(row => row.id)).toEqual([ids[1]])
})

test('a successful selection returns pending IDs after other selections have been posted', async () => {
  expect((await loadPendingRecurringMonth('2026-09')).rows).toHaveLength(2)
  await applySelectedRecurringMonth('2026-09', [ids[1]])
  expect(await applySelectedRecurringMonth('2026-09', [ids[0]])).toMatchObject({
    ok: true, added: 1, remaining: 0, pendingIds: [], handledIds: [ids[0]],
  })
  expect(await rows()).toHaveLength(2)
})

test('a moved legacy posting stays excluded from the original source month', async () => {
  await db.insert(transactions).values({ householdId: auth.householdId, recurringId: ids[0],
    date: '2026-10-10', flow: 'expense', amount: 500000, source: 'recurring', importUid: `recurring:${ids[0]}:2026-09` })
  expect((await loadPendingRecurringMonth('2026-09')).rows?.map(row => row.id)).toEqual([ids[1]])
  expect(await applySelectedRecurringMonth('2026-09', [ids[0]])).toMatchObject({ ok: true, added: 0, skipped: 1, remaining: 1 })
  expect(await rows()).toHaveLength(1)
})

test('unauthenticated requests return an error without reading or writing another household', async () => {
  auth.signedIn = false
  expect((await loadPendingRecurringMonth('2026-09')).error).toBeTruthy()
  expect(await applySelectedRecurringMonth('2026-09', [ids[0]])).toMatchObject({ ok: false })
  expect(await rows()).toHaveLength(0)
})

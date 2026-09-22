import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { db } from '@/db/client'
import { households, transactions } from '@/db/schema'
import { deleteTransaction, saveTransaction } from '@/features/ledger/actions'

const auth = vi.hoisted(() => ({ householdId: '' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))

beforeEach(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-ledger-navigation' }).returning()
  auth.householdId = household.id
})
afterEach(async () => { await db.delete(households).where(eq(households.id, auth.householdId)) })
function form(fields: Record<string, string>) {
  const data = new FormData()
  Object.entries(fields).forEach(([key, value]) => data.set(key, value))
  return data
}

test('saving and deleting a transaction return to its list, retaining filters and sort', async () => {
  const filters = { returnFlow: 'expense', returnQ: '커피', returnSort: 'amount-asc' }
  const target = 'REDIRECT:/ledger?month=2026-07&flow=expense&q=%EC%BB%A4%ED%94%BC&sort=amount-asc&tab=list'
  await expect(saveTransaction({}, form({ date: '2026-07-10', flow: 'expense', memo: '커피', amount: '5000', ...filters }))).rejects.toThrow(target)
  const [created] = await db.select().from(transactions).where(eq(transactions.householdId, auth.householdId))
  expect(created.memo).toBe('커피')
  await expect(deleteTransaction(form({ transactionId: String(created.id), month: '2026-07', ...filters }))).rejects.toThrow(target)
  expect(await db.select().from(transactions).where(eq(transactions.householdId, auth.householdId))).toHaveLength(0)
})

test('deleting without a return month still opens the list', async () => {
  await expect(deleteTransaction(form({ transactionId: '0' }))).rejects.toThrow('REDIRECT:/ledger?tab=list')
})

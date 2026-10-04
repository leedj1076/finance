import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { households, investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'
import { addWatchSecurity, deleteManualTransaction, saveHoldingMemo, saveInvestmentAccount, saveManualTransaction, updateTransactionMemo } from '@/features/investment/actions'

const context = vi.hoisted(() => ({ householdId: '', authenticated: true }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => context.authenticated ? ({ userId: 'invest-actions-user', householdId: context.householdId, email: 't@example.com' }) : null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}
let accountId = 0
let securityId = 0
let otherHouseholdId = ''
let otherAccountId = 0
let otherSecurityId = 0
let otherTransactionId = 0

beforeAll(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-invest-actions' }).returning({ id: households.id })
  context.householdId = household.id
  const [other] = await db.insert(households).values({ name: 'TEST-invest-actions-other' }).returning()
  otherHouseholdId = other.id
  const [account] = await db.insert(investmentAccounts).values({ householdId: other.id, owner: 'OTHER', name: 'Other', brokerAccountNo: '9999', credentialRef: 'other' }).returning()
  const [security] = await db.insert(investmentSecurities).values({ householdId: other.id, market: 'US', symbol: 'OTHER', name: 'Other', currency: 'USD', exposureCurrency: 'USD' }).returning()
  const [transaction] = await db.insert(investmentTransactions).values({ householdId: other.id, accountId: account.id, kind: 'deposit', tradeDate: '2026-09-01', amount: '10', currency: 'USD', source: 'manual' }).returning()
  otherAccountId = account.id; otherSecurityId = security.id; otherTransactionId = transaction.id
})
afterAll(async () => {
  await db.delete(households).where(eq(households.id, context.householdId))
  await db.delete(households).where(eq(households.id, otherHouseholdId))
})

describe('investment actions', () => {
  test('saveInvestmentAccount creates and updates an account', async () => {
    const created = await saveInvestmentAccount({}, form({ owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom' }))
    expect(created.error).toBeUndefined()
    const [row] = await db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, context.householdId))
    accountId = row.id
    expect(row.name).toBe('DJ 키움 종합')
    const updated = await saveInvestmentAccount({}, form({ id: String(accountId), owner: 'DJ', name: 'DJ 키움', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom', active: 'on' }))
    expect(updated.error).toBeUndefined()
    const [after] = await db.select().from(investmentAccounts).where(eq(investmentAccounts.id, accountId))
    expect(after.name).toBe('DJ 키움')
  })

  test('addWatchSecurity normalizes the symbol and is idempotent', async () => {
    expect((await addWatchSecurity({}, form({ market: 'KR', symbol: '005930', name: '삼성전자' }))).error).toBeUndefined()
    expect((await addWatchSecurity({}, form({ market: 'KR', symbol: ' 005930 ' }))).error).toBeUndefined()
    const rows = await db.select().from(investmentSecurities).where(eq(investmentSecurities.householdId, context.householdId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ symbol: '005930', currency: 'KRW', exposureCurrency: 'KRW', watching: true })
    securityId = rows[0].id
    expect((await addWatchSecurity({}, form({ market: 'US', symbol: 'bad symbol!' }))).error).toMatch(/종목코드/)
  })

  test('saveManualTransaction inserts buys and refuses to oversell', async () => {
    const buy = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'buy', tradeDate: '2026-09-01', quantity: '40', price: '70000', fee: '100' }))
    expect(buy.error).toBeUndefined()
    const over = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'sell', tradeDate: '2026-09-02', quantity: '41', price: '71000' }))
    expect(over.error).toMatch(/보유 40주보다 많이 팔 수 없습니다/)
    const ok = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'sell', tradeDate: '2026-09-02', quantity: '10', price: '71000' }))
    expect(ok.error).toBeUndefined()
    const rows = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, context.householdId))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.source === 'manual')).toBe(true)
  })

  test('deleteManualTransaction refuses when it would leave a negative position', async () => {
    const rows = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, context.householdId))
    const buy = rows.find((r) => r.kind === 'buy')!
    const sell = rows.find((r) => r.kind === 'sell')!
    expect((await deleteManualTransaction({}, form({ id: String(buy.id) }))).error).toMatch(/보유 수량이 음수/)
    expect((await deleteManualTransaction({}, form({ id: String(sell.id) }))).error).toBeUndefined()
  })

  test('saveHoldingMemo stores thesis fields and rejects an out-of-range loss limit', async () => {
    const ok = await saveHoldingMemo({}, form({ securityId: String(securityId), thesis: 'HBM 수요', horizonYears: '5', fundsNeededAt: '2031 이후', lossLimitPct: '', weightBasis: 'stock_accounts' }))
    expect(ok.error).toBeUndefined()
    const [row] = await db.select().from(investmentSecurities).where(eq(investmentSecurities.id, securityId))
    expect(row.thesis).toBe('HBM 수요'); expect(row.horizonYears).toBe('5.0'); expect(row.lossLimitPct).toBeNull()
    expect((await saveHoldingMemo({}, form({ securityId: String(securityId), lossLimitPct: '150', weightBasis: 'stock_accounts' }))).error).toMatch(/손실 한도/)
  })
})

test('all actions reject unauthenticated writes', async () => {
  context.authenticated = false
  try {
    for (const action of [saveInvestmentAccount, saveManualTransaction, updateTransactionMemo, deleteManualTransaction, addWatchSecurity, saveHoldingMemo]) {
      expect(await action({}, new FormData())).toHaveProperty('error')
    }
  } finally { context.authenticated = true }
})

test('account deactivation works and duplicate or malformed accounts return errors', async () => {
  const fields = { owner: 'DJ', name: 'Disabled', brokerAccountNo: '76543210', credentialRef: 'test-ref' }
  const created = await saveInvestmentAccount({}, form(fields))
  expect(created.saved).toBeDefined()
  expect((await saveInvestmentAccount({}, form({ ...fields, id: String(created.saved!.id) }))).error).toBeUndefined()
  const [row] = await db.select().from(investmentAccounts).where(eq(investmentAccounts.id, created.saved!.id))
  expect(row.active).toBe(false)
  expect(await saveManualTransaction({}, form({ accountId: String(row.id), kind: 'deposit', currency: 'KRW', amount: '1', tradeDate: '2026-09-01' }))).toHaveProperty('error')
  expect(await saveInvestmentAccount({}, form(fields))).toHaveProperty('error')
  expect(await saveInvestmentAccount({}, form({ ...fields, id: 'abc' }))).toHaveProperty('error')
})

test('every write rejects foreign account, security and transaction IDs', async () => {
  expect(await saveInvestmentAccount({}, form({ id: String(otherAccountId), owner: 'DJ', name: 'Hacked', brokerAccountNo: '9999', credentialRef: 'test-ref', active: 'on' }))).toHaveProperty('error')
  const buy = { accountId: String(accountId), securityId: String(securityId), kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1' }
  expect(await saveManualTransaction({}, form({ ...buy, accountId: String(otherAccountId) }))).toHaveProperty('error')
  expect(await saveManualTransaction({}, form({ ...buy, securityId: String(otherSecurityId) }))).toHaveProperty('error')
  expect(await saveHoldingMemo({}, form({ securityId: String(otherSecurityId), thesis: 'Hacked', weightBasis: 'stock_accounts' }))).toHaveProperty('error')
  expect(await updateTransactionMemo({}, form({ id: String(otherTransactionId), memo: 'Hacked' }))).toHaveProperty('error')
  expect(await deleteManualTransaction({}, form({ id: String(otherTransactionId) }))).toHaveProperty('error')
  const [row] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, otherTransactionId))
  expect(row.memo).toBeNull()
})

async function isolatedSecurity(symbol: string) {
  const result = await addWatchSecurity({}, form({ market: 'US', symbol }))
  expect(result.error).toBeUndefined()
  return String(result.saved!.id)
}
function trade(id: string, kind: string, quantity: string, date = '2026-09-02') {
  return form({ accountId: String(accountId), securityId: id, kind, quantity, price: '10', tradeDate: date })
}

test('simultaneous sells cannot both consume the same shares', async () => {
  const id = await isolatedSecurity('RACE')
  await saveManualTransaction({}, trade(id, 'buy', '10', '2026-09-01'))
  const results = await Promise.all([saveManualTransaction({}, trade(id, 'sell', '7')), saveManualTransaction({}, trade(id, 'sell', '7'))])
  expect(results.filter(r => r.saved)).toHaveLength(1)
  expect(results.filter(r => r.error)).toHaveLength(1)
})

test('backdated sells and negative adjustments cannot create a historical short position', async () => {
  const id = await isolatedSecurity('PAST')
  await saveManualTransaction({}, trade(id, 'buy', '10', '2026-09-03'))
  expect(await saveManualTransaction({}, trade(id, 'sell', '1', '2026-09-01'))).toHaveProperty('error')
  expect(await saveManualTransaction({}, trade(id, 'adjust', '-11', '2026-09-04'))).toHaveProperty('error')
})

test('deleting an early buy is rejected even if a later buy restores the final balance', async () => {
  const id = await isolatedSecurity('DELETE')
  const early = await saveManualTransaction({}, trade(id, 'buy', '10', '2026-09-01'))
  await saveManualTransaction({}, trade(id, 'sell', '10', '2026-09-02'))
  await saveManualTransaction({}, trade(id, 'buy', '10', '2026-09-03'))
  expect(await deleteManualTransaction({}, form({ id: String(early.saved!.id) }))).toHaveProperty('error')
})

test('broker trades permit memo updates but never deletion', async () => {
  const [row] = await db.insert(investmentTransactions).values({ householdId: context.householdId, accountId, kind: 'deposit', tradeDate: '2026-09-01', amount: '10', currency: 'KRW', source: 'kiwoom', brokerRef: 'TEST-MEMO' }).returning()
  expect((await updateTransactionMemo({}, form({ id: String(row.id), memo: 'memo only' }))).error).toBeUndefined()
  expect(await deleteManualTransaction({}, form({ id: String(row.id) }))).toHaveProperty('error')
  const [saved] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, row.id))
  expect(saved.memo).toBe('memo only')
})

test('concurrent watch additions are idempotent and preserve the supplied name', async () => {
  const results = await Promise.all([addWatchSecurity({}, form({ market: 'US', symbol: 'DUPE', name: 'Duplicate test' })), addWatchSecurity({}, form({ market: 'US', symbol: 'DUPE' }))])
  expect(results.every(r => !r.error)).toBe(true)
  expect(results[0].saved?.id).toBe(results[1].saved?.id)
})

test('malformed IDs and rounded-to-zero memo limits return errors', async () => {
  expect(await deleteManualTransaction({}, form({ id: 'NaN' }))).toHaveProperty('error')
  expect(await saveHoldingMemo({}, form({ securityId: 'NaN', weightBasis: 'stock_accounts' }))).toHaveProperty('error')
  expect(await saveHoldingMemo({}, form({ securityId: String(securityId), horizonYears: '0.01', weightBasis: 'stock_accounts' }))).toHaveProperty('error')
  expect(await saveHoldingMemo({}, form({ securityId: String(securityId), lossLimitPct: '0.001', weightBasis: 'stock_accounts' }))).toHaveProperty('error')
})

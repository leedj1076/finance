import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { db } from '@/db/client'
import { fxRates, households, investmentAccounts, investmentSecurities, investmentTransactions, latestQuotes, priceSnapshots } from '@/db/schema'
import { getHoldingsData, getInvestmentSettingsData, getSecurityDetail, getTransactionsData, getTrendData, getWatchData } from '@/features/investment/queries'

let householdId = ''
let otherHouseholdId = ''
let dj = 0, yj = 0, samsung = 0, nvda = 0, amat = 0

beforeAll(async () => {
  const created = await db.insert(households).values([{ name: 'TEST-invest-queries' }, { name: 'TEST-invest-queries-other' }]).returning({ id: households.id })
  householdId = created[0].id; otherHouseholdId = created[1].id
  const accounts = await db.insert(investmentAccounts).values([
    { householdId, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '1234', credentialRef: 'dj', sortOrder: 1 },
    { householdId, owner: 'YJ', name: 'YJ 키움 종합', brokerAccountNo: '5678', credentialRef: 'yj', sortOrder: 2 },
  ]).returning({ id: investmentAccounts.id })
  dj = accounts[0].id; yj = accounts[1].id
  const securities = await db.insert(investmentSecurities).values([
    { householdId, market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW' },
    { householdId, market: 'US', symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', exposureCurrency: 'USD' },
    { householdId, market: 'US', symbol: 'AMAT', name: 'Applied Materials', currency: 'USD', exposureCurrency: 'USD', watching: true },
    { householdId: otherHouseholdId, market: 'KR', symbol: '000660', name: '남의 종목', currency: 'KRW', exposureCurrency: 'KRW' },
  ]).returning({ id: investmentSecurities.id })
  samsung = securities[0].id; nvda = securities[1].id; amat = securities[2].id
  await db.insert(investmentTransactions).values([
    { householdId, accountId: dj, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', amount: '10000000', currency: 'KRW', source: 'manual' },
    { householdId, accountId: dj, securityId: samsung, kind: 'buy', tradeDate: '2026-09-02', quantity: '120', price: '71200', fee: '0', amount: '-8544000', currency: 'KRW', source: 'manual' },
    { householdId, accountId: dj, securityId: samsung, kind: 'sell', tradeDate: '2026-09-04', quantity: '30', price: '80700', fee: '500', amount: '2420500', currency: 'KRW', source: 'kiwoom', brokerRef: 'F-1' },
    { householdId, accountId: yj, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', amount: '2000', currency: 'USD', source: 'manual' },
    { householdId, accountId: yj, securityId: nvda, kind: 'buy', tradeDate: '2026-09-03', quantity: '15', price: '118.2', fee: '0', amount: '-1773', currency: 'USD', source: 'manual' },
  ])
  await db.insert(latestQuotes).values([
    { securityId: samsung, householdId, price: '78400', changeRate: '-1.2', quotedAt: new Date('2026-09-28T05:32:00Z'), source: 'manual' },
    { securityId: nvda, householdId, price: '131.05', changeRate: '0.8', quotedAt: new Date('2026-09-27T20:00:00Z'), source: 'manual' },
  ])
  await db.insert(fxRates).values({ householdId, date: '2026-09-27', pair: 'USDKRW', rate: '1380.2', source: 'manual' })
})

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId))
  await db.delete(households).where(eq(households.id, otherHouseholdId))
})

describe('getHoldingsData', () => {
  test('settings preserves keychain references and isolates households', async () => {
    const data = await getInvestmentSettingsData(householdId)
    expect(data.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: dj, credentialRef: 'dj' }), expect.objectContaining({ id: yj, credentialRef: 'yj' })]))
    expect((await getInvestmentSettingsData(otherHouseholdId)).accounts).toEqual([])
  })
  test('groups by account then market, values in native currency, converts only totals', async () => {
    const data = await getHoldingsData(householdId)
    expect(data.groups.map((g) => g.account.name)).toEqual(['DJ 키움 종합', 'YJ 키움 종합'])
    const djKR = data.groups[0].markets.find((m) => m.market === 'KR')!
    expect(djKR.rows[0].quantity).toBe(90)
    expect(djKR.rows[0].avgCost).toBe(71200)
    expect(djKR.value).toBe(90 * 78400)
    expect(data.groups[0].cashKRW).toBe(10000000 - 8544000 + 2420500)
    const yjUS = data.groups[1].markets.find((m) => m.market === 'US')!
    expect(yjUS.value).toBeCloseTo(15 * 131.05, 2)
    expect(yjUS.valueKRW).toBe(Math.round(15 * 131.05 * 1380.2))
    expect(data.summary.fxMissing).toBe(false)
    expect(data.status.fx?.rate).toBe(1380.2)
    expect(data.securitiesCount).toEqual({ KR: 1, US: 1 })
  })
  test('owner filter keeps only that owner\'s accounts and never leaks other households', async () => {
    const data = await getHoldingsData(householdId, 'YJ')
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].account.owner).toBe('YJ')
    const other = await getHoldingsData(otherHouseholdId)
    expect(other.groups).toEqual([])
  })
})

describe('getTransactionsData', () => {
  test('lists the month, computes realized on sells, and flags kiwoom rows as memo-only', async () => {
    const data = await getTransactionsData(householdId, '2026-09', 'all')
    expect(data.rows).toHaveLength(5)
    const sell = data.rows.find((r) => r.kind === 'sell')!
    expect(sell.realized).toBe((80700 - 71200) * 30 - 500)
    expect(sell.editable).toBe(false)
    expect(data.realizedKRW).toBe(sell.realized)
    expect(data.realizedUSD).toBe(0)
    expect(data.netCashKRW).toBe(10000000)
    expect(data.netCashUSD).toBe(2000)
    expect((await getTransactionsData(householdId, '2026-09', 'US')).rows.every((r) => r.currency === 'USD')).toBe(true)
    expect((await getTransactionsData(householdId, '2026-08', 'all')).rows).toEqual([])
  })
})

describe('getWatchData / getTrendData / getSecurityDetail', () => {
  test('detail reads only this security daily closes for the price chart', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const [snapshot] = await db.insert(priceSnapshots).values({ householdId, securityId: samsung, date, close: '78000', currency: 'KRW', source: 'manual' }).returning()
    try {
      expect((await getSecurityDetail(householdId, samsung))?.priceHistory).toEqual([{ date, close: 78000 }])
      expect((await getSecurityDetail(householdId, nvda))?.priceHistory).toEqual([])
      expect(await getSecurityDetail(otherHouseholdId, samsung)).toBeNull()
    } finally { await db.delete(priceSnapshots).where(eq(priceSnapshots.id, snapshot.id)) }
  })
  test('watch lists watching securities without a position', async () => {
    const rows = await getWatchData(householdId)
    expect(rows.map((r) => r.security.symbol)).toEqual(['AMAT'])
  })
  test('trend is empty without snapshots but allocation reflects current positions', async () => {
    const data = await getTrendData(householdId, '3m', 'total')
    expect(data.empty).toBe(true)
    expect(data.allocation.map((a) => a.label)).toEqual(['국내 주식', '해외 주식', '원화 예수금', '달러 예수금'])
    expect(data.allocation.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(100, 6)
  })
  test('security detail carries positions, its transactions and neighbors', async () => {
    const detail = await getSecurityDetail(householdId, samsung)
    expect(detail?.positions[0].quantity).toBe(90)
    expect(detail?.transactions).toHaveLength(2)
    // 이웃은 시장·종목코드 순: KR 005930 → US AMAT → US NVDA
    expect(detail?.neighbors.next?.id).toBe(amat)
    expect((await getSecurityDetail(householdId, nvda))?.neighbors.prev?.id).toBe(amat)
    expect(await getSecurityDetail(otherHouseholdId, samsung)).toBeNull()
  })
})

test('a month excludes the first day of the next month', async () => {
  const [row] = await db.insert(investmentTransactions).values({ householdId, accountId: dj, kind: 'deposit', tradeDate: '2026-10-01', amount: '100', currency: 'KRW', source: 'manual' }).returning()
  try {
    expect((await getTransactionsData(householdId, '2026-09', 'all')).rows.map(r => r.id)).not.toContain(row.id)
    expect((await getTransactionsData(householdId, '2026-10', 'all')).rows.map(r => r.id)).toContain(row.id)
  } finally { await db.delete(investmentTransactions).where(eq(investmentTransactions.id, row.id)) }
})

test('market subtotals do not invent gains on positions whose basis is unknown', async () => {
  const [security] = await db.insert(investmentSecurities).values({ householdId, market: 'KR', symbol: 'UNKNOWN', name: 'Unknown', currency: 'KRW', exposureCurrency: 'KRW' }).returning()
  const [transaction] = await db.insert(investmentTransactions).values({ householdId, accountId: dj, securityId: security.id, kind: 'adjust', tradeDate: '2026-09-01', quantity: '1', amount: '0', currency: 'KRW', source: 'manual' }).returning()
  await db.insert(latestQuotes).values({ householdId, securityId: security.id, price: '100000', quotedAt: new Date(), source: 'manual' })
  try {
    const data = await getHoldingsData(householdId)
    expect(data.groups[0].markets[0].unrealized).toBe(90 * (78400 - 71200))
    expect(data.summary.KR.unrealized).toBe(data.groups[0].markets[0].unrealized)
  } finally {
    await db.delete(investmentTransactions).where(eq(investmentTransactions.id, transaction.id))
    await db.delete(investmentSecurities).where(eq(investmentSecurities.id, security.id))
  }
})

test('trend includes cash, uses historical FX only, and does not value missing FX at zero', async () => {
  const [account] = await db.insert(investmentAccounts).values({ householdId: otherHouseholdId, owner: 'OTHER', name: 'Historical', brokerAccountNo: '1111', credentialRef: 'history' }).returning()
  const [security] = await db.insert(investmentSecurities).values({ householdId: otherHouseholdId, market: 'US', symbol: 'HISTORY', name: 'Historical', currency: 'USD', exposureCurrency: 'USD' }).returning()
  await db.insert(investmentTransactions).values([
    { householdId: otherHouseholdId, accountId: account.id, kind: 'deposit', tradeDate: '2026-09-01', amount: '100', currency: 'USD', source: 'manual' },
    { householdId: otherHouseholdId, accountId: account.id, securityId: security.id, kind: 'buy', tradeDate: '2026-09-01', quantity: '10', price: '5', amount: '-50', currency: 'USD', source: 'manual' },
  ])
  await db.insert(priceSnapshots).values([
    { householdId: otherHouseholdId, securityId: security.id, date: '2026-09-01', close: '10', currency: 'USD', source: 'manual' },
    { householdId: otherHouseholdId, securityId: security.id, date: '2026-09-02', close: '12', currency: 'USD', source: 'manual' },
  ])
  expect((await getTrendData(otherHouseholdId, 'all', 'total')).empty).toBe(true)
  expect((await getTrendData(otherHouseholdId, 'all', 'US')).points).toEqual([
    { date: '2026-09-01', value: 150, cost: 100 }, { date: '2026-09-02', value: 170, cost: 100 },
  ])
  await db.insert(fxRates).values([
    { householdId: otherHouseholdId, date: '2026-09-01', rate: '1000', source: 'manual' },
    { householdId: otherHouseholdId, date: '2026-09-02', rate: '2000', source: 'manual' },
    { householdId: otherHouseholdId, date: '2026-10-01', rate: '9999', source: 'manual' },
  ])
  expect((await getTrendData(otherHouseholdId, 'all', 'total')).points).toEqual([
    { date: '2026-09-01', value: 150000, cost: 100000 }, { date: '2026-09-02', value: 340000, cost: 200000 },
  ])
})

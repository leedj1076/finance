import { and, asc, desc, eq, gte, lt, lte } from 'drizzle-orm'

import { db } from '@/db/client'
import { brokerPositions, fxRates, investmentAccounts, investmentSecurities, investmentTransactions, latestQuotes, priceSnapshots } from '@/db/schema'
import { monthBounds } from '@/lib/finance'

import {
  aggregateByMarket, cashBalances, discrepancies, foldPositions, realizedByTransaction, valuePositions, weightsKRW,
  type Discrepancy, type MarketSummary, type ValuedPosition,
} from './calculations'
import type { AccountRow, BrokerPositionRow, FxRow, Market, QuoteRow, SecurityRow, TransactionRow } from './types'

const n = (value: string | null | undefined) => value === null || value === undefined ? null : Number(value)
const n0 = (value: string | null | undefined) => Number(value ?? 0)
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null

export type StatusLine = { quotedAt: string | null; fx: FxRow | null; lastSyncedAt: string | null; workerConnected: boolean }
export type HoldingRow = ValuedPosition & { security: SecurityRow; weightPct: number | null; discrepancy: Discrepancy | null }
export type MarketGroup = { market: Market; count: number; value: number; unrealized: number; returnPct: number | null; valueKRW: number | null; rows: HoldingRow[] }
export type AccountGroup = { account: AccountRow; cashKRW: number; cashUSD: number; markets: MarketGroup[] }
export type AttentionItem = { kind: 'discrepancy'; securityId: number; title: string; detail: string; href: string }
export type HoldingsData = { status: StatusLine; summary: MarketSummary; groups: AccountGroup[]; attention: AttentionItem[]; securitiesCount: Record<Market, number> }
export type TransactionListRow = TransactionRow & { accountName: string; brokerRef: string | null; memo: string | null; security: { market: Market; symbol: string; name: string } | null; realized: number | null; editable: boolean }
export type TransactionsData = { month: string; rows: TransactionListRow[]; realizedKRW: number; realizedUSD: number; dividendKRW: number; dividendUSD: number; netCashKRW: number; netCashUSD: number }
export type WatchRow = { security: SecurityRow; price: number | null; changeRate: number | null }
export type TrendData = { points: Array<{ date: string; value: number; cost: number }>; allocation: Array<{ label: string; pct: number }>; empty: boolean }
export type SecurityDetail = {
  security: SecurityRow & { thesis: string | null; horizonYears: number | null; fundsNeededAt: string | null; lossLimitPct: number | null; weightBasis: 'total_assets' | 'stock_accounts'; businessType: string | null; nextCheckDate: string | null }
  positions: HoldingRow[]
  price: number | null
  changeRate: number | null
  transactions: TransactionListRow[]
  priceHistory: Array<{ date: string; close: number }>
  neighbors: { prev: { id: number; name: string } | null; next: { id: number; name: string } | null }
}
export type PortfolioInputs = {
  accounts: AccountRow[]; securities: SecurityRow[]; transactions: TransactionRow[]; quotes: QuoteRow[]
  closes: Map<number, number>; fx: FxRow | null; broker: BrokerPositionRow[]; quotedAt: string | null; lastSyncedAt: string | null
}

const securityColumns = {
  id: investmentSecurities.id, market: investmentSecurities.market, symbol: investmentSecurities.symbol, name: investmentSecurities.name,
  currency: investmentSecurities.currency, exposureCurrency: investmentSecurities.exposureCurrency, sector: investmentSecurities.sector, watching: investmentSecurities.watching,
}

export async function loadPortfolioInputs(householdId: string): Promise<PortfolioInputs> {
  const [accountRows, securities, txRows, quoteRows, closeRows, fxRow, brokerRows] = await Promise.all([
    db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, householdId)).orderBy(asc(investmentAccounts.sortOrder), asc(investmentAccounts.id)),
    db.select(securityColumns).from(investmentSecurities).where(eq(investmentSecurities.householdId, householdId)).orderBy(asc(investmentSecurities.market), asc(investmentSecurities.symbol)),
    db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId)),
    db.select().from(latestQuotes).where(eq(latestQuotes.householdId, householdId)),
    db.select({ securityId: priceSnapshots.securityId, close: priceSnapshots.close })
      .from(priceSnapshots).where(eq(priceSnapshots.householdId, householdId))
      .orderBy(asc(priceSnapshots.securityId), desc(priceSnapshots.date)),
    db.select().from(fxRates).where(and(eq(fxRates.householdId, householdId), eq(fxRates.pair, 'USDKRW'))).orderBy(desc(fxRates.date)).limit(1),
    db.select().from(brokerPositions).where(eq(brokerPositions.householdId, householdId)),
  ])
  const closes = new Map<number, number>()
  for (const row of closeRows) if (!closes.has(row.securityId)) closes.set(row.securityId, Number(row.close))
  const quotes: QuoteRow[] = quoteRows.map((q) => ({ securityId: q.securityId, price: Number(q.price), changeRate: n(q.changeRate), quotedAt: q.quotedAt.toISOString() }))
  const quotedAt = quotes.reduce<string | null>((latest, q) => latest === null || q.quotedAt > latest ? q.quotedAt : latest, null)
  const accounts: AccountRow[] = accountRows.map((a) => ({ id: a.id, owner: a.owner, name: a.name, brokerAccountNo: a.brokerAccountNo, active: a.active, lastSyncedAt: iso(a.lastSyncedAt) }))
  return {
    accounts,
    securities,
    transactions: txRows.map((t) => ({
      id: t.id, accountId: t.accountId, securityId: t.securityId, kind: t.kind, tradeDate: t.tradeDate,
      quantity: n(t.quantity), price: n(t.price), fee: n0(t.fee), amount: n0(t.amount), currency: t.currency, source: t.source,
    })),
    quotes, closes,
    fx: fxRow[0] && Number(fxRow[0].rate) > 0 && Number.isFinite(Number(fxRow[0].rate)) ? { date: fxRow[0].date, rate: Number(fxRow[0].rate) } : null,
    broker: brokerRows.map((b) => ({ accountId: b.accountId, securityId: b.securityId, quantity: Number(b.quantity), avgCost: Number(b.avgCost), syncedAt: b.syncedAt.toISOString() })),
    quotedAt,
    lastSyncedAt: accounts.reduce<string | null>((latest, a) => a.lastSyncedAt && (latest === null || a.lastSyncedAt > latest) ? a.lastSyncedAt : latest, null),
  }
}

function status(inputs: PortfolioInputs): StatusLine {
  return { quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }
}

function activeAccountIds(inputs: PortfolioInputs, owner?: string) {
  return new Set(inputs.accounts.filter(a => a.active && (!owner || a.owner === owner)).map(a => a.id))
}

function marketGroups(rows: HoldingRow[], fx: FxRow | null): MarketGroup[] {
  return (['KR', 'US'] as Market[]).flatMap((market) => {
    const group = rows.filter((r) => r.market === market)
    if (group.length === 0) return []
    const value = group.reduce((s, r) => s + (r.marketValue ?? 0), 0)
    const cost = group.reduce((s, r) => s + (r.unrealized === null ? 0 : r.costBasis), 0)
    const unrealized = group.reduce((s, r) => s + (r.unrealized ?? 0), 0)
    const valueKRW = market === 'KR' ? Math.round(value) : fx ? Math.round(value * fx.rate) : null
    return [{ market, count: group.length, value, unrealized, returnPct: cost === 0 ? null : unrealized / cost * 100, valueKRW, rows: group }]
  })
}

export async function getHoldingsData(householdId: string, owner?: string): Promise<HoldingsData> {
  const inputs = await loadPortfolioInputs(householdId)
  const accountIds = activeAccountIds(inputs, owner)
  const accounts = inputs.accounts.filter(a => accountIds.has(a.id))
  const transactions = inputs.transactions.filter((t) => accountIds.has(t.accountId))
  const positions = foldPositions(transactions)
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const cash = cashBalances(transactions)
  const weights = weightsKRW(valued, cash, inputs.fx)
  const diffs = discrepancies(positions, inputs.broker.filter((b) => accountIds.has(b.accountId)))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const rows: HoldingRow[] = valued.map((v) => ({
    ...v, security: secById.get(v.securityId)!, weightPct: weights.get(v.securityId) ?? null,
    discrepancy: diffs.find((d) => d.accountId === v.accountId && d.securityId === v.securityId) ?? null,
  }))
  const groups: AccountGroup[] = accounts.map((account) => ({
    account,
    cashKRW: cash.find((c) => c.accountId === account.id && c.currency === 'KRW')?.amount ?? 0,
    cashUSD: cash.find((c) => c.accountId === account.id && c.currency === 'USD')?.amount ?? 0,
    markets: marketGroups(rows.filter((r) => r.accountId === account.id), inputs.fx),
  }))
  const attention: AttentionItem[] = diffs.map((d) => {
    const security = secById.get(d.securityId)!
    const detail = d.qtyDiffers
      ? `수량이 증권사(${d.brokerQty})와 다름 · 우리 ${d.ourQty}`
      : `평균단가가 증권사 값과 ${d.avgDiffPct!.toFixed(1)}% 차이 · 정정 필요 여부 확인`
    return { kind: 'discrepancy', securityId: d.securityId, title: security.name, detail, href: `/investment/${security.id}` }
  })
  const held = new Set(rows.map((r) => r.securityId))
  const securitiesCount = { KR: 0, US: 0 } as Record<Market, number>
  for (const id of held) securitiesCount[secById.get(id)!.market] += 1
  return { status: status(inputs), summary: aggregateByMarket(valued, cash, inputs.fx), groups, attention, securitiesCount }
}

function listRows(inputs: PortfolioInputs, transactions: TransactionRow[], raw: Array<{ id: number; brokerRef: string | null; memo: string | null }>): TransactionListRow[] {
  const realized = realizedByTransaction(inputs.transactions)
  const accountName = new Map(inputs.accounts.map((a) => [a.id, a.name]))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const rawById = new Map(raw.map((r) => [r.id, r]))
  return transactions
    .sort((a, b) => a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : b.id - a.id)
    .map((t) => {
      const security = t.securityId === null ? null : secById.get(t.securityId) ?? null
      return {
        ...t, accountName: accountName.get(t.accountId) ?? '', brokerRef: rawById.get(t.id)?.brokerRef ?? null, memo: rawById.get(t.id)?.memo ?? null,
        security: security ? { market: security.market, symbol: security.symbol, name: security.name } : null,
        realized: t.kind === 'sell' ? realized.get(t.id) ?? null : null, editable: t.source === 'manual',
      }
    })
}

export async function getTransactionsData(householdId: string, month: string, market: Market | 'all', owner?: string): Promise<TransactionsData> {
  const inputs = await loadPortfolioInputs(householdId)
  const { start, end } = monthBounds(month)
  const raw = await db.select({ id: investmentTransactions.id, brokerRef: investmentTransactions.brokerRef, memo: investmentTransactions.memo })
    .from(investmentTransactions)
    .where(and(eq(investmentTransactions.householdId, householdId), gte(investmentTransactions.tradeDate, start), lt(investmentTransactions.tradeDate, end)))
  const accountIds = new Set(inputs.accounts.filter((a) => !owner || a.owner === owner).map((a) => a.id))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const inMonth = inputs.transactions.filter((t) => t.tradeDate >= start && t.tradeDate < end && accountIds.has(t.accountId))
    .filter((t) => market === 'all' || (t.securityId === null ? (market === 'KR' ? t.currency === 'KRW' : t.currency === 'USD') : secById.get(t.securityId)?.market === market))
  const rows = listRows(inputs, inMonth, raw)
  const sum = (predicate: (r: TransactionListRow) => boolean, pick: (r: TransactionListRow) => number) => Math.round(rows.filter(predicate).reduce((s, r) => s + pick(r), 0) * 100) / 100
  return {
    month, rows,
    realizedKRW: sum((r) => r.kind === 'sell' && r.currency === 'KRW', (r) => r.realized ?? 0),
    realizedUSD: sum((r) => r.kind === 'sell' && r.currency === 'USD', (r) => r.realized ?? 0),
    dividendKRW: sum((r) => r.kind === 'dividend' && r.currency === 'KRW', (r) => r.amount),
    dividendUSD: sum((r) => r.kind === 'dividend' && r.currency === 'USD', (r) => r.amount),
    netCashKRW: sum((r) => (r.kind === 'deposit' || r.kind === 'withdraw') && r.currency === 'KRW', (r) => r.amount),
    netCashUSD: sum((r) => (r.kind === 'deposit' || r.kind === 'withdraw') && r.currency === 'USD', (r) => r.amount),
  }
}

export async function getWatchData(householdId: string): Promise<WatchRow[]> {
  const inputs = await loadPortfolioInputs(householdId)
  const accountIds = activeAccountIds(inputs)
  const held = new Set(foldPositions(inputs.transactions.filter(t => accountIds.has(t.accountId))).map((p) => p.securityId))
  const quoteById = new Map(inputs.quotes.map((q) => [q.securityId, q]))
  return inputs.securities.filter((s) => s.watching && !held.has(s.id)).map((security) => ({
    security, price: quoteById.get(security.id)?.price ?? inputs.closes.get(security.id) ?? null, changeRate: quoteById.get(security.id)?.changeRate ?? null,
  }))
}

const RANGE_DAYS = { '1m': 31, '3m': 92, '1y': 366, all: 36500 } as const

export async function getTrendData(householdId: string, range: keyof typeof RANGE_DAYS, scope: 'total' | Market): Promise<TrendData> {
  const inputs = await loadPortfolioInputs(householdId)
  const accountIds = activeAccountIds(inputs)
  const transactions = inputs.transactions.filter(t => accountIds.has(t.accountId))
  const positions = foldPositions(transactions)
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const cash = cashBalances(transactions)
  const summary = aggregateByMarket(valued, cash, inputs.fx)
  const toKRW = (usd: number) => inputs.fx ? usd * inputs.fx.rate : 0
  const parts = [
    { label: '국내 주식', krw: summary.KR.value }, { label: '해외 주식', krw: toKRW(summary.US.value) },
    { label: '원화 예수금', krw: summary.cashKRW }, { label: '달러 예수금', krw: toKRW(summary.cashUSD) },
  ]
  const total = parts.reduce((s, p) => s + p.krw, 0)
  const allocation = parts.map((p) => ({ label: p.label, pct: total === 0 ? 0 : p.krw / total * 100 }))
  const since = new Date(); since.setDate(since.getDate() - RANGE_DAYS[range])
  const sinceKey = since.toISOString().slice(0, 10)
  const [snapshots, rates] = await Promise.all([
    db.select({ securityId: priceSnapshots.securityId, date: priceSnapshots.date, close: priceSnapshots.close })
      .from(priceSnapshots).where(eq(priceSnapshots.householdId, householdId)).orderBy(asc(priceSnapshots.date)),
    db.select({ date: fxRates.date, rate: fxRates.rate }).from(fxRates)
      .where(and(eq(fxRates.householdId, householdId), eq(fxRates.pair, 'USDKRW'))).orderBy(asc(fxRates.date)),
  ])
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const dates = [...new Set(snapshots.map((s) => s.date))].filter(date => date >= sinceKey)
  const points: TrendData['points'] = []
  for (const date of dates) {
    const dayTransactions = transactions.filter(t => t.tradeDate <= date)
    const dayPositions = foldPositions(dayTransactions).filter(p => scope === 'total' || secById.get(p.securityId)?.market === scope)
    const dayCash = cashBalances(dayTransactions).filter(c => scope === 'total' || c.currency === (scope === 'US' ? 'USD' : 'KRW'))
    const dayCloses = new Map<number, number>()
    for (const snapshot of snapshots) {
      if (snapshot.date > date) break
      const close = Number(snapshot.close)
      if (Number.isFinite(close) && close >= 0) dayCloses.set(snapshot.securityId, close)
    }
    const rateRow = rates.filter(r => r.date <= date).at(-1)
    const rate = rateRow ? Number(rateRow.rate) : null
    const needsFX = scope === 'total' && (dayPositions.some(p => secById.get(p.securityId)?.currency === 'USD') || dayCash.some(c => c.currency === 'USD' && c.amount !== 0))
    // Missing prices or historical FX are unknown, never zero-valued investments.
    if (dayPositions.some(p => !dayCloses.has(p.securityId)) || (needsFX && (rate === null || !Number.isFinite(rate) || rate <= 0))) continue
    const factor = (currency: string) => scope === 'total' && currency === 'USD' ? rate! : 1
    const value = dayPositions.reduce((sum, p) => sum + dayCloses.get(p.securityId)! * p.quantity * factor(secById.get(p.securityId)!.currency), 0)
      + dayCash.reduce((sum, c) => sum + c.amount * factor(c.currency), 0)
    const cost = dayTransactions.filter(t => (t.kind === 'deposit' || t.kind === 'withdraw') && (scope === 'total' || t.currency === (scope === 'US' ? 'USD' : 'KRW')))
      .reduce((sum, t) => sum + t.amount * factor(t.currency), 0)
    points.push({ date, value: Math.round(value * 100) / 100, cost: Math.round(cost * 100) / 100 })
  }
  return { points, allocation, empty: points.length === 0 }
}

export async function getSecurityDetail(householdId: string, securityId: number): Promise<SecurityDetail | null> {
  const [row] = await db.select().from(investmentSecurities).where(and(eq(investmentSecurities.id, securityId), eq(investmentSecurities.householdId, householdId))).limit(1)
  if (!row) return null
  const inputs = await loadPortfolioInputs(householdId)
  const accountIds = activeAccountIds(inputs)
  const transactions = inputs.transactions.filter(t => accountIds.has(t.accountId))
  const positions = foldPositions(transactions).filter((p) => p.securityId === securityId)
  const allValued = valuePositions(foldPositions(transactions), inputs.securities, inputs.quotes, inputs.closes)
  const weights = weightsKRW(allValued, cashBalances(transactions), inputs.fx)
  const diffs = discrepancies(positions, inputs.broker.filter((b) => accountIds.has(b.accountId) && b.securityId === securityId))
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const security = inputs.securities.find((s) => s.id === securityId)!
  const raw = await db.select({ id: investmentTransactions.id, brokerRef: investmentTransactions.brokerRef, memo: investmentTransactions.memo })
    .from(investmentTransactions).where(and(eq(investmentTransactions.householdId, householdId), eq(investmentTransactions.securityId, securityId)))
  const quote = inputs.quotes.find((q) => q.securityId === securityId)
  const today = new Date()
  const since = new Date(today); since.setUTCMonth(since.getUTCMonth() - 3)
  const prices = await db.select({ date: priceSnapshots.date, close: priceSnapshots.close }).from(priceSnapshots)
    .where(and(eq(priceSnapshots.householdId, householdId), eq(priceSnapshots.securityId, securityId), gte(priceSnapshots.date, since.toISOString().slice(0, 10)), lte(priceSnapshots.date, today.toISOString().slice(0, 10))))
    .orderBy(asc(priceSnapshots.date))
  const ordered = inputs.securities
  const index = ordered.findIndex((s) => s.id === securityId)
  return {
    security: {
      ...security, thesis: row.thesis, horizonYears: n(row.horizonYears), fundsNeededAt: row.fundsNeededAt, lossLimitPct: n(row.lossLimitPct),
      weightBasis: row.weightBasis, businessType: row.businessType, nextCheckDate: row.nextCheckDate,
    },
    positions: valued.map((v) => ({ ...v, security, weightPct: weights.get(securityId) ?? null, discrepancy: diffs.find((d) => d.accountId === v.accountId) ?? null })),
    price: quote?.price ?? inputs.closes.get(securityId) ?? null,
    changeRate: quote?.changeRate ?? null,
    transactions: listRows(inputs, inputs.transactions.filter((t) => t.securityId === securityId), raw),
    priceHistory: prices.map(p => ({ date: p.date, close: Number(p.close) })).filter(p => Number.isFinite(p.close) && p.close >= 0),
    neighbors: {
      prev: index > 0 ? { id: ordered[index - 1].id, name: ordered[index - 1].name } : null,
      next: index >= 0 && index < ordered.length - 1 ? { id: ordered[index + 1].id, name: ordered[index + 1].name } : null,
    },
  }
}

export async function getInvestmentSettingsData(householdId: string) {
  const rows = await db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, householdId)).orderBy(asc(investmentAccounts.sortOrder), asc(investmentAccounts.id))
  const accounts: Array<AccountRow & { credentialRef: string }> = rows.map(a => ({ id: a.id, owner: a.owner, name: a.name, brokerAccountNo: a.brokerAccountNo, credentialRef: a.credentialRef, active: a.active, lastSyncedAt: iso(a.lastSyncedAt) }))
  return { accounts }
}

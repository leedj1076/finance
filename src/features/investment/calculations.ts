import type { BrokerPositionRow, Currency, FxRow, Market, QuoteRow, SecurityRow, TransactionRow } from './types'

export type Position = { accountId: number; securityId: number; quantity: number; avgCost: number | null; costBasis: number }
export type CashBalance = { accountId: number; currency: Currency; amount: number }
export type ValuedPosition = Position & {
  market: Market
  currency: Currency
  price: number | null
  priceSource: 'quote' | 'close' | 'none'
  marketValue: number | null
  unrealized: number | null
  returnPct: number | null
}
export type MarketTotals = { value: number; cost: number; unrealized: number; returnPct: number | null; count: number }
export type MarketSummary = {
  KR: MarketTotals
  US: MarketTotals
  cashKRW: number
  cashUSD: number
  totalKRW: number
  totalUnrealizedKRW: number
  fxMissing: boolean
}
export type Discrepancy = {
  accountId: number; securityId: number
  ourQty: number; brokerQty: number
  ourAvg: number | null; brokerAvg: number
  qtyDiffers: boolean; avgDiffPct: number | null
}

export function round6(n: number) { return Math.round(n * 1e6) / 1e6 || 0 }
const round2 = (n: number) => Math.round(n * 100) / 100

function ordered(rows: TransactionRow[]) {
  return [...rows].sort((a, b) => a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : a.id - b.id)
}

/**
 * Walk trades in date order keeping a moving-average cost per (account,
 * security). Sells reduce quantity only; the average survives so the next
 * sell still has a basis. `adjust` adds quantity (may be negative) and, when
 * it carries a price, resets the average to that price.
 */
function walk(rows: TransactionRow[], onSell?: (row: TransactionRow, avgBefore: number | null) => void) {
  const state = new Map<string, Position>()
  for (const row of ordered(rows)) {
    if (row.securityId === null) continue
    if (row.kind !== 'buy' && row.kind !== 'sell' && row.kind !== 'adjust') continue
    const key = `${row.accountId}:${row.securityId}`
    const current = state.get(key) ?? { accountId: row.accountId, securityId: row.securityId, quantity: 0, avgCost: null, costBasis: 0 }
    const qty = row.quantity ?? 0
    if (row.kind === 'buy') {
      const spent = qty * (row.price ?? 0) + row.fee
      const newQty = current.quantity + qty
      current.avgCost = newQty > 0 && (current.quantity === 0 || current.avgCost !== null)
        ? round6((current.costBasis + spent) / newQty) : null
      current.quantity = newQty
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * newQty
    } else if (row.kind === 'sell') {
      onSell?.(row, qty <= current.quantity ? current.avgCost : null)
      current.quantity = Math.max(0, current.quantity - qty)
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * current.quantity
    } else {
      current.quantity = Math.max(0, current.quantity + qty)
      if (row.price !== null) current.avgCost = row.price
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * current.quantity
    }
    current.quantity = round6(current.quantity)
    if (current.quantity === 0) current.avgCost = null
    current.costBasis = round2(current.costBasis)
    state.set(key, current)
  }
  return state
}

export function foldPositions(rows: TransactionRow[]): Position[] {
  return [...walk(rows).values()].filter((p) => p.quantity > 0)
}

export function realizedByTransaction(rows: TransactionRow[]) {
  const out = new Map<number, number | null>()
  walk(rows, (row, avgBefore) => {
    if (avgBefore === null || row.price === null || row.quantity === null) { out.set(row.id, null); return }
    out.set(row.id, round2((row.price - avgBefore) * row.quantity - row.fee))
  })
  return out
}

export function cashBalances(rows: TransactionRow[]): CashBalance[] {
  const sums = new Map<string, CashBalance>()
  for (const row of rows) {
    if (row.kind === 'adjust') continue
    const key = `${row.accountId}:${row.currency}`
    const entry = sums.get(key) ?? { accountId: row.accountId, currency: row.currency, amount: 0 }
    entry.amount = round2(entry.amount + row.amount)
    sums.set(key, entry)
  }
  return [...sums.values()].sort((a, b) => a.accountId - b.accountId || a.currency.localeCompare(b.currency))
}

export function valuePositions(
  positions: Position[],
  securities: SecurityRow[],
  quotes: QuoteRow[],
  closeBySecurity: Map<number, number>,
): ValuedPosition[] {
  const secById = new Map(securities.map((s) => [s.id, s]))
  const quoteById = new Map(quotes.map((q) => [q.securityId, q]))
  return positions.flatMap((p) => {
    const security = secById.get(p.securityId)
    if (!security) return []
    const quote = quoteById.get(p.securityId)
    const close = closeBySecurity.get(p.securityId)
    const validPrice = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0
    const price = validPrice(quote?.price) ? quote!.price : validPrice(close) ? close : null
    const priceSource: ValuedPosition['priceSource'] = validPrice(quote?.price) ? 'quote' : validPrice(close) ? 'close' : 'none'
    const marketValue = price === null ? null : round2(price * p.quantity)
    const unrealized = marketValue === null || p.avgCost === null ? null : round2(marketValue - p.costBasis)
    const returnPct = unrealized === null || p.costBasis === 0 ? null : unrealized / p.costBasis * 100
    return [{ ...p, market: security.market, currency: security.currency, price, priceSource, marketValue, unrealized, returnPct }]
  })
}

function totals(valued: ValuedPosition[], market: Market): MarketTotals {
  const rows = valued.filter((v) => v.market === market)
  const value = round2(rows.reduce((s, v) => s + (v.marketValue ?? 0), 0))
  const cost = round2(rows.reduce((s, v) => s + (v.unrealized === null ? 0 : v.costBasis), 0))
  const unrealized = round2(rows.reduce((sum, row) => sum + (row.unrealized ?? 0), 0))
  return { value, cost, unrealized, returnPct: cost === 0 ? null : unrealized / cost * 100, count: rows.length }
}

export function aggregateByMarket(valued: ValuedPosition[], cash: CashBalance[], fx: FxRow | null): MarketSummary {
  const KR = totals(valued, 'KR')
  const US = totals(valued, 'US')
  const cashKRW = round2(cash.filter((c) => c.currency === 'KRW').reduce((s, c) => s + c.amount, 0))
  const cashUSD = round2(cash.filter((c) => c.currency === 'USD').reduce((s, c) => s + c.amount, 0))
  const rate = fx && Number.isFinite(fx.rate) && fx.rate > 0 ? fx.rate : null
  const usdToKrw = (usd: number) => rate === null ? 0 : usd * rate
  return {
    KR, US, cashKRW, cashUSD,
    totalKRW: Math.round(KR.value + cashKRW + usdToKrw(US.value + cashUSD)),
    totalUnrealizedKRW: Math.round(KR.unrealized + usdToKrw(US.unrealized)),
    fxMissing: rate === null,
  }
}

export function weightsKRW(valued: ValuedPosition[], cash: CashBalance[], fx: FxRow | null) {
  const summary = aggregateByMarket(valued, cash, fx)
  const out = new Map<number, number | null>()
  for (const v of valued) {
    if (v.marketValue === null || summary.totalKRW <= 0) { out.set(v.securityId, null); continue }
    if (v.currency === 'USD' && summary.fxMissing) { out.set(v.securityId, null); continue }
    const krw = v.currency === 'USD' ? v.marketValue * (fx?.rate ?? 0) : v.marketValue
    const previous = out.get(v.securityId) ?? 0
    out.set(v.securityId, (previous ?? 0) + krw / summary.totalKRW * 100)
  }
  return out
}

export function discrepancies(positions: Position[], broker: BrokerPositionRow[], thresholdPct = 3): Discrepancy[] {
  const byKey = new Map(positions.map((p) => [`${p.accountId}:${p.securityId}`, p]))
  const out: Discrepancy[] = []
  for (const b of broker) {
    const ours = byKey.get(`${b.accountId}:${b.securityId}`)
    const ourQty = ours?.quantity ?? 0
    const ourAvg = ours?.avgCost ?? null
    const qtyDiffers = round6(ourQty) !== round6(b.quantity)
    const avgDiffPct = ourAvg === null || b.avgCost === 0 ? null : Math.abs(ourAvg - b.avgCost) / b.avgCost * 100
    if (qtyDiffers || (avgDiffPct !== null && avgDiffPct >= thresholdPct)) {
      out.push({ accountId: b.accountId, securityId: b.securityId, ourQty, brokerQty: b.quantity, ourAvg, brokerAvg: b.avgCost, qtyDiffers, avgDiffPct })
    }
  }
  return out
}

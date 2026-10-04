import { describe, expect, it } from 'vitest'

import {
  aggregateByMarket, cashBalances, discrepancies, foldPositions, realizedByTransaction, valuePositions, weightsKRW,
} from '@/features/investment/calculations'
import type { SecurityRow, TransactionRow } from '@/features/investment/types'

const sec: SecurityRow[] = [
  { id: 1, market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW', sector: null, watching: false },
  { id: 2, market: 'US', symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', exposureCurrency: 'USD', sector: null, watching: false },
]
let nextId = 1
function tx(partial: Partial<TransactionRow> & Pick<TransactionRow, 'kind' | 'tradeDate'>): TransactionRow {
  return { id: nextId++, accountId: 1, securityId: 1, quantity: null, price: null, fee: 0, amount: 0, currency: 'KRW', source: 'manual', ...partial }
}

describe('foldPositions (moving average)', () => {
  it('averages buys including fees and keeps the average on sells', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-07-30', quantity: 20, price: 179000, fee: 1000, amount: -3581000 }),
      tx({ kind: 'buy', tradeDate: '2026-08-12', quantity: 20, price: 185000, fee: 1000, amount: -3701000 }),
      tx({ kind: 'sell', tradeDate: '2026-09-04', quantity: 10, price: 190000, fee: 500, amount: 1899500 }),
    ]
    const [p] = foldPositions(rows)
    expect(p.quantity).toBe(30)
    expect(p.avgCost).toBeCloseTo((3581000 + 3701000) / 40, 6)
    expect(p.costBasis).toBeCloseTo(30 * ((3581000 + 3701000) / 40), 2)
  })

  it('folds in date then id order even when rows arrive shuffled', () => {
    const later = tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 3, price: 100, amount: 300 })
    const earlier = tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 5, price: 80, amount: -400 })
    const [p] = foldPositions([later, earlier])
    expect(p.quantity).toBe(2)
    expect(p.avgCost).toBe(80)
    expect(realizedByTransaction([later, earlier]).get(later.id)).toBe(60)
  })

  it('adjust adds quantity and resets the average only when a price is given', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 10, price: 100, amount: -1000 }),
      tx({ kind: 'adjust', tradeDate: '2026-09-02', quantity: 2, price: null }),
      tx({ kind: 'adjust', tradeDate: '2026-09-03', quantity: 0, price: 120 }),
    ]
    const [p] = foldPositions(rows)
    expect(p.quantity).toBe(12)
    expect(p.avgCost).toBe(120)
  })

  it('drops positions that return to zero and never goes negative', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 3, price: 10, amount: -30 }),
      tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 3, price: 12, amount: 36 }),
    ]
    expect(foldPositions(rows)).toEqual([])
  })

  it('a sell before any buy leaves avgCost null instead of crashing', () => {
    const rows = [tx({ kind: 'sell', tradeDate: '2026-09-01', quantity: 1, price: 10, amount: 10 })]
    const positions = foldPositions(rows)
    expect(positions).toEqual([])
    expect(realizedByTransaction(rows).get(rows[0].id)).toBeNull()
  })

  it('keeps fractional US quantities to six decimals', () => {
    const rows = [tx({ kind: 'buy', tradeDate: '2026-09-01', securityId: 2, currency: 'USD', quantity: 0.123456789, price: 100, amount: -12.35 })]
    expect(foldPositions(rows)[0].quantity).toBe(0.123457)
  })
})

describe('realizedByTransaction', () => {
  it('is (price − avg) × qty − fee at the time of the sell', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 30, price: 80000, fee: 0, amount: -2400000 }),
      tx({ kind: 'sell', tradeDate: '2026-09-04', quantity: 30, price: 80700, fee: 500, amount: 2420500 }),
    ]
    expect(realizedByTransaction(rows).get(rows[1].id)).toBe(700 * 30 - 500)
  })
})

describe('cashBalances', () => {
  it('sums signed amounts per account and currency; adjust contributes nothing', () => {
    const rows = [
      tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, amount: 3000000 }),
      tx({ kind: 'buy', tradeDate: '2026-09-02', quantity: 10, price: 100000, fee: 100, amount: -1000100 }),
      tx({ kind: 'dividend', tradeDate: '2026-09-03', securityId: 2, currency: 'USD', amount: 6.63 }),
      tx({ kind: 'adjust', tradeDate: '2026-09-04', quantity: 1, amount: 0 }),
      tx({ kind: 'withdraw', tradeDate: '2026-09-05', securityId: null, accountId: 2, amount: -500 }),
    ]
    expect(cashBalances(rows)).toEqual([
      { accountId: 1, currency: 'KRW', amount: 1999900 },
      { accountId: 1, currency: 'USD', amount: 6.63 },
      { accountId: 2, currency: 'KRW', amount: -500 },
    ])
  })
})

describe('valuePositions and aggregateByMarket', () => {
  const rows = [
    tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 120, price: 71200, amount: -8544000 }),
    tx({ kind: 'buy', tradeDate: '2026-09-01', securityId: 2, currency: 'USD', quantity: 15, price: 118.2, amount: -1773 }),
    tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, amount: 9664000 }),
    tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, currency: 'USD', amount: 2413 }),
  ]
  const positions = foldPositions(rows)
  const quotes = [{ securityId: 1, price: 78400, changeRate: -1.2, quotedAt: '2026-09-28T05:32:00Z' }]
  const closes = new Map([[2, 131.05]])

  it('prefers the live quote, falls back to the last close, and marks missing prices', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const kr = valued.find((v) => v.securityId === 1)!
    const us = valued.find((v) => v.securityId === 2)!
    expect(kr.priceSource).toBe('quote'); expect(kr.marketValue).toBe(9408000); expect(kr.unrealized).toBe(864000); expect(kr.returnPct).toBeCloseTo(10.11, 1)
    expect(us.priceSource).toBe('close'); expect(us.marketValue).toBeCloseTo(1965.75, 2)
    const none = valuePositions(positions, sec, [], new Map())
    expect(none[0].priceSource).toBe('none'); expect(none[0].marketValue).toBeNull()
  })

  it('aggregates per market in native currency and converts only the total', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const cash = cashBalances(rows)
    const s = aggregateByMarket(valued, cash, { date: '2026-09-27', rate: 1380.2 })
    expect(s.KR.value).toBe(9408000); expect(s.KR.count).toBe(1)
    expect(s.US.value).toBeCloseTo(1965.75, 2); expect(s.US.unrealized).toBeCloseTo(192.75, 2)
    expect(s.cashKRW).toBe(1120000); expect(s.cashUSD).toBe(640)
    expect(s.totalKRW).toBeCloseTo(9408000 + 1120000 + (1965.75 + 640) * 1380.2, 0)
    expect(s.fxMissing).toBe(false)
  })

  it('without an fx row the total counts won only and flags fxMissing (no NaN)', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const s = aggregateByMarket(valued, cashBalances(rows), null)
    expect(s.fxMissing).toBe(true)
    expect(s.totalKRW).toBe(9408000 + 1120000)
    expect(Number.isNaN(s.totalUnrealizedKRW)).toBe(false)
  })

  it('weights are shares of the won-converted total including cash', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const w = weightsKRW(valued, cashBalances(rows), { date: '2026-09-27', rate: 1380.2 })
    const total = 9408000 + 1120000 + (1965.75 + 640) * 1380.2
    expect(w.get(1)).toBeCloseTo(9408000 / total * 100, 3)
    expect(w.get(2)).toBeCloseTo(1965.75 * 1380.2 / total * 100, 3)
  })
})

describe('discrepancies', () => {
  it('flags quantity mismatch or average cost off by 3% or more', () => {
    const positions = foldPositions([tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 120, price: 71200, amount: -8544000 })])
    const broker = [{ accountId: 1, securityId: 1, quantity: 120, avgCost: 73640, syncedAt: '2026-09-27T07:05:00Z' }]
    const [d] = discrepancies(positions, broker)
    expect(d.qtyDiffers).toBe(false)
    expect(d.avgDiffPct).toBeCloseTo(3.31, 1) // |71,200 − 73,640| / 73,640
    expect(discrepancies(positions, [{ ...broker[0], avgCost: 71500 }])).toEqual([])
  })
})

describe('missing data and position boundaries', () => {
  it('does not infer zero acquisition cost for an adjustment without price', () => {
    const rows = [tx({ kind: 'adjust', tradeDate: '2026-09-01', quantity: 2, price: null }),
      tx({ kind: 'buy', tradeDate: '2026-09-02', quantity: 1, price: 100, amount: -100 })]
    const positions = foldPositions(rows)
    expect(positions[0].avgCost).toBeNull()
    const valued = valuePositions(positions, sec, [], new Map([[1, 120]]))
    expect(valued[0]).toMatchObject({ marketValue: 360, unrealized: null, returnPct: null })
    expect(aggregateByMarket(valued, [], null).KR.unrealized).toBe(0)
  })
  it('clears the old cost after closing a position', () => {
    const rows = [tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 1, price: 100, amount: -100 }),
      tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 1, price: 120, amount: 120 }),
      tx({ kind: 'adjust', tradeDate: '2026-09-03', quantity: 1, price: null })]
    expect(foldPositions(rows)[0].avgCost).toBeNull()
  })
  it('does not claim realized profit on quantities without a cost basis', () => {
    const rows = [tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 1, price: 100, amount: -100 }),
      tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 2, price: 120, amount: 240 })]
    expect(realizedByTransaction(rows).get(rows[1].id)).toBeNull()
    expect(foldPositions(rows)).toEqual([])
  })
  it.each([0, -1, NaN, Infinity])('treats invalid exchange rate %s as missing', (rate) => {
    const positions = foldPositions([tx({ kind: 'buy', tradeDate: '2026-09-01', securityId: 2, currency: 'USD', quantity: 1, price: 10, amount: -10 })])
    const valued = valuePositions(positions, sec, [], new Map([[2, 12]]))
    const summary = aggregateByMarket(valued, [], { date: '2026-09-01', rate })
    expect(summary).toMatchObject({ totalKRW: 0, totalUnrealizedKRW: 0, fxMissing: true })
    expect(weightsKRW(valued, [], { date: '2026-09-01', rate }).get(2)).toBeNull()
  })
  it('falls back from invalid live prices and returns no valuation without prices', () => {
    const positions = foldPositions([tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 1, price: 10, amount: -10 })])
    const quote = { securityId: 1, price: NaN, changeRate: null, quotedAt: '2026-09-01T00:00:00Z' }
    expect(valuePositions(positions, sec, [quote], new Map([[1, 12]]))[0]).toMatchObject({ price: 12, priceSource: 'close' })
    expect(valuePositions(positions, sec, [quote], new Map([[1, Infinity]]))[0]).toMatchObject({ marketValue: null, unrealized: null })
    expect(aggregateByMarket([], [], null)).toMatchObject({ totalKRW: 0, totalUnrealizedKRW: 0 })
  })
})

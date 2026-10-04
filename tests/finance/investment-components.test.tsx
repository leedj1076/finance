import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HoldingsTable } from '@/features/investment/holdings-table'
import { KpiBand } from '@/features/investment/kpi-band'
import { StatusLineView } from '@/features/investment/status-line'
import type { AccountGroup } from '@/features/investment/queries'

const security = { id: 1, market: 'KR' as const, symbol: '005930', name: '삼성전자', currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: false }
const nvda = { ...security, id: 2, market: 'US' as const, symbol: 'NVDA', name: 'NVIDIA', currency: 'USD' as const, exposureCurrency: 'USD' as const }
const groups: AccountGroup[] = [{
  account: { id: 1, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', active: true, lastSyncedAt: null },
  cashKRW: 1120000, cashUSD: 640,
  markets: [
    { market: 'KR', count: 1, value: 9408000, unrealized: 864000, returnPct: 10.11, valueKRW: 9408000, rows: [{
      accountId: 1, securityId: 1, quantity: 120, avgCost: 71200, costBasis: 8544000, market: 'KR', currency: 'KRW', price: 78400, priceSource: 'quote', marketValue: 9408000, unrealized: 864000, returnPct: 10.11, security, weightPct: 15.3,
      discrepancy: { accountId: 1, securityId: 1, ourQty: 120, brokerQty: 120, ourAvg: 71200, brokerAvg: 73640, qtyDiffers: false, avgDiffPct: 3.43 },
    }] },
    { market: 'US', count: 1, value: 1965.75, unrealized: 192.75, returnPct: 10.87, valueKRW: 2713000, rows: [{
      accountId: 1, securityId: 2, quantity: 15, avgCost: 118.2, costBasis: 1773, market: 'US', currency: 'USD', price: 131.05, priceSource: 'close', marketValue: 1965.75, unrealized: 192.75, returnPct: 10.87, security: nvda, weightPct: 4.4, discrepancy: null,
    }] },
  ],
}]

describe('HoldingsTable', () => {
  const html = renderToStaticMarkup(<HoldingsTable householdId="test-household" fx={{ date: '2026-09-27', rate: 1380.2 }} groups={groups} />)
  it('renders account row, market subgroup rows in native currency and a won-converted overseas subtotal', () => {
    expect(html).toContain('DJ 키움 종합')
    expect(html).toContain('····5678')
    expect(html).toContain('국내')
    expect(html).toContain('해외')
    expect(html).toContain('$1,965.75')
    expect(html).toContain('₩2,713,000 환산')
    expect(html).toContain('+$192.75')
  })
  it('marks a discrepancy row and links every security row to its detail page', () => {
    expect(html).toContain('증권사 값과 3.4% 차이')
    expect(html).toContain('href="/investment/1"')
    expect(html).toContain('href="/investment/2"')
  })
  it('exposes collapse toggles with aria-expanded and fixed column widths', () => {
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(html).toContain('<colgroup>')
  })
  it('labels the price source when it is a close, not a live quote', () => {
    expect(html).toContain('종가 기준')
  })
})

describe('StatusLineView', () => {
  it('spells out missing quote, fx and sync instead of rendering blanks or NaN', () => {
    const html = renderToStaticMarkup(<StatusLineView status={{ quotedAt: null, fx: null, lastSyncedAt: null, workerConnected: false }} />)
    expect(html).toContain('시세 없음')
    expect(html).toContain('환율 없음 · 해외 미포함')
    expect(html).toContain('동기화 전')
    expect(html).toContain('연결 안 됨')
    expect(html).not.toContain('NaN')
    expect(html).toMatch(/<button[^>]*disabled/)
  })
  it('formats a present fx rate with its date', () => {
    const html = renderToStaticMarkup(<StatusLineView status={{ quotedAt: '2026-09-28T05:32:00Z', fx: { date: '2026-09-27', rate: 1380.2 }, lastSyncedAt: null, workerConnected: false }} />)
    expect(html).toContain('USDKRW')
    expect(html).toContain('1,380.20')
    expect(html).toContain('(09-27)')
  })
})

describe('KpiBand', () => {
  it('renders exactly the four items with their tones', () => {
    const html = renderToStaticMarkup(<KpiBand items={[
      { label: '국내 평가', value: '46,555,500', tone: 'ink' }, { label: '해외 평가', value: '$8,409.75' },
      { label: '합계', value: '61,402,500', tone: 'blue' }, { label: '예수금', value: '₩1,860,000', caption: '$1,000.00' },
    ]} />)
    expect((html.match(/<article/g) ?? []).length).toBe(4)
    expect(html).toContain('kpi-band')
    expect(html).toContain('text-finance-blue')
  })
})

it('keeps the three footer totals and filters only the table market', () => {
  const all = renderToStaticMarkup(<HoldingsTable householdId="test-household" fx={null} groups={groups} />)
  for (const label of ['국내 합계', '해외 합계', '합계 (원화 환산)']) expect(all).toContain(label)
  const kr = renderToStaticMarkup(<HoldingsTable householdId="test-household" fx={null} groups={groups} market="KR" />)
  expect(kr).toContain('삼성전자')
  expect(kr).not.toContain('NVIDIA')
  expect(kr).not.toContain('해외 합계')
})

it('does not report zero value for unpriced positions and offers mobile detail expansion', () => {
  const missing = structuredClone(groups)
  for (const group of missing) for (const market of group.markets) for (const row of market.rows) {
    row.price = null; row.marketValue = null; row.unrealized = null; row.returnPct = null; row.priceSource = 'none'
  }
  const html = renderToStaticMarkup(<HoldingsTable householdId="test-household" fx={null} groups={missing} />)
  expect(html).toContain('시세 없음')
  expect(html).toContain('삼성전자 보유 상세')
  expect(html).toContain('aria-expanded="false"')
})

it('keeps the known domestic total when unpriced overseas assets lack FX', () => {
  const missing = structuredClone(groups)
  const overseas = missing[0].markets[1].rows[0]
  overseas.marketValue = null; overseas.price = null; overseas.unrealized = null; overseas.returnPct = null
  const html = renderToStaticMarkup(<HoldingsTable householdId="test-household" fx={null} groups={missing} />)
  expect(html).toContain('10,528,000')
  expect(html).toContain('환율 없음 · 해외 미포함')
})

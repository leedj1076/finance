import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/investment/actions', () => ({ saveHoldingMemo: vi.fn(), saveInvestmentAccount: vi.fn() }))

import { AccountForm } from '@/features/investment/account-form'
import { AllocationBars } from '@/features/investment/allocation-bars'
import { HoldingMemoForm } from '@/features/investment/holding-memo-form'

vi.mock('@/components/app-header', () => ({ AppHeader: () => <header>우리집 투자</header> }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: 'test-household', email: 'dev@example.com' }) }))
vi.mock('@/features/investment/queries', () => ({ getSecurityDetail: vi.fn(), loadPortfolioInputs: vi.fn(), getHoldingsData: vi.fn(), getTrendData: vi.fn() }))
import SecurityPage from '@/app/investment/[securityId]/page'
import TrendPage from '@/app/investment/trend/page'
import AdvisorPage from '@/app/investment/advisor/page'
import { getSecurityDetail, loadPortfolioInputs, getHoldingsData, getTrendData } from '@/features/investment/queries'
import { aggregateByMarket, foldPositions, valuePositions } from '@/features/investment/calculations'
import type { TransactionRow } from '@/features/investment/types'

describe('HoldingMemoForm', () => {
  const html = renderToStaticMarkup(<HoldingMemoForm security={{ id: 1, thesis: 'HBM 수요', horizonYears: 5, fundsNeededAt: null, lossLimitPct: null, weightBasis: 'stock_accounts' }} />)
  it('renders every v3 input with the stored values and an explicit "no limit" placeholder', () => {
    for (const label of ['매수 논지', '투자 기간', '자금 사용 시점', '손실 한도', '비중 분모']) expect(html).toContain(label)
    expect(html).toContain('value="HBM 수요"')
    expect(html).toContain('value="5"')
    expect(html).toContain('없음 (리포트가 임의로 만들지 않음)')
    expect(html).toContain('name="securityId"')
  })
})

it('uses 34px primary controls and never draws invalid or negative bar widths', () => {
  expect(renderToStaticMarkup(<AccountForm />)).toContain('h-[34px]')
  const html = renderToStaticMarkup(<AllocationBars items={[{ label: '미상', pct: NaN }, { label: '음수', pct: -20 }]} />)
  expect(html).not.toMatch(/NaN|Infinity|width:-/)
  expect(html).toContain('–')
})

it('does not invent an average cost or profit for an unknown-cost position', async () => {
  const security = { id: 1, name: '예시', symbol: 'EXAMPLE', market: 'KR' as const, currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: true, thesis: null, horizonYears: null, fundsNeededAt: null, lossLimitPct: null, weightBasis: 'stock_accounts' as const, businessType: null, nextCheckDate: null }
  const row = { accountId: 1, securityId: 1, quantity: 2, avgCost: null, costBasis: 0, market: 'KR' as const, currency: 'KRW' as const, price: 100, priceSource: 'quote' as const, marketValue: 200, unrealized: null, returnPct: null, security, weightPct: 100, discrepancy: null }
  vi.mocked(loadPortfolioInputs).mockResolvedValue({ accounts: [], securities: [security], transactions: [], quotes: [], closes: new Map(), fx: null, broker: [], quotedAt: null, lastSyncedAt: null })
  vi.mocked(getSecurityDetail).mockResolvedValue({ security, positions: [row], price: 100, changeRate: null, transactions: [], priceHistory: [], neighbors: { prev: null, next: null } })
  const html = renderToStaticMarkup(await SecurityPage({ params: Promise.resolve({ securityId: '1' }) }))
  expect(html).toContain('단가 없음')
  expect(html).not.toContain('+200')
  const average = html.slice(html.indexOf('평균단가'), html.indexOf('평가손익'))
  expect(average).toMatch(/>–</)
})

it.each([
  { price: null, profit: '–', returnText: '시세 없음' },
  { price: 163.42, profit: '0', returnText: '0.0%' },
  { price: 200, profit: '+$0.07', returnText: '+21.4%' },
])('shows a consistent fractional average and profit at price $price on the detail page', async ({ price, profit, returnText }) => {
  const security = { id: 1, name: '예시', symbol: 'EXAMPLE', market: 'US' as const, currency: 'USD' as const, exposureCurrency: 'USD' as const, sector: null, watching: true, thesis: null, horizonYears: null, fundsNeededAt: null, lossLimitPct: null, weightBasis: 'stock_accounts' as const, businessType: null, nextCheckDate: null }
  const transactions: TransactionRow[] = [1, 2].map(id => ({ id, accountId: 1, securityId: 1, kind: 'buy', tradeDate: '2026-09-01', quantity: 0.001, price: 163.42, fee: 0, amount: -0.16, currency: 'USD', source: 'manual' }))
  const positions = valuePositions(foldPositions(transactions), [security], [], price === null ? new Map() : new Map([[1, price]])).map(row => ({ ...row, security, weightPct: null, discrepancy: null }))
  vi.mocked(loadPortfolioInputs).mockResolvedValue({ accounts: [], securities: [security], transactions, quotes: [], closes: new Map(), fx: null, broker: [], quotedAt: null, lastSyncedAt: null })
  vi.mocked(getSecurityDetail).mockResolvedValue({ security, positions, price, changeRate: null, transactions: [], priceHistory: [], neighbors: { prev: null, next: null } })
  const html = renderToStaticMarkup(await SecurityPage({ params: Promise.resolve({ securityId: '1' }) }))
  const average = html.slice(html.indexOf('평균단가'), html.indexOf('평가손익'))
  expect(average).toContain('$163.42')
  expect(positions[0].avgCost).toBe(163.42)
  const pnl = html.slice(html.indexOf('평가손익'), html.indexOf('다음 점검'))
  expect(pnl).toContain(`>${profit}</p>`)
  expect(pnl).toContain(returnText)
})

it('trend and advisor do not call missing quote values zero or cash 100 percent', async () => {
  const security = { id: 1, name: '예시', symbol: 'EXAMPLE', market: 'KR' as const, currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: true }
  const row = { accountId: 1, securityId: 1, quantity: 2, avgCost: 100, costBasis: 200, market: 'KR' as const, currency: 'KRW' as const, price: null, priceSource: 'none' as const, marketValue: null, unrealized: null, returnPct: null, security, weightPct: null, discrepancy: null }
  const account = { id: 1, owner: 'DJ', name: '예시 계좌', active: true, brokerAccountNo: '1234', lastSyncedAt: null }
  vi.mocked(getHoldingsData).mockResolvedValue({ status: { quotedAt: null, fx: null, lastSyncedAt: null, workerConnected: false }, summary: aggregateByMarket([row], [{ accountId: 1, currency: 'KRW', amount: 100 }], null), attention: [], securitiesCount: { KR: 1, US: 0 }, groups: [{ account, cashKRW: 100, cashUSD: 0, markets: [{ market: 'KR', rows: [row], count: 1, value: 0, unrealized: 0, returnPct: null, valueKRW: 0 }] }] })
  vi.mocked(getTrendData).mockResolvedValue({ points: [], empty: true, allocation: [{ label: '원화 예수금', pct: 100 }] })
  const trend = renderToStaticMarkup(await TrendPage({ searchParams: Promise.resolve({}) }))
  const advisor = renderToStaticMarkup(await AdvisorPage())
  expect(trend).toContain('시세 없음')
  expect(advisor).toContain('시세 없음')
  expect(trend).not.toContain('100.0%')
  expect(advisor).not.toContain('100.0%')
})

describe('AccountForm', () => {
  it('masks nothing in the editor but never renders the secret itself', () => {
    const html = renderToStaticMarkup(<AccountForm account={{ id: 3, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', active: true, lastSyncedAt: null, credentialRef: 'dj-kiwoom' }} />)
    expect(html).toContain('value="12345678"')
    expect(html).toContain('value="dj-kiwoom"')
    expect(html).toContain('키체인 항목 이름')
    expect(html).not.toMatch(/secret|appkey/i)
  })
})

describe('AllocationBars', () => {
  it('draws a bar per item with the percentage and flags the largest over 30% as amber', () => {
    const html = renderToStaticMarkup(<AllocationBars items={[{ label: '국내 주식', pct: 75.8 }, { label: '해외 주식', pct: 18.9 }, { label: '원화 예수금', pct: 3 }, { label: '달러 예수금', pct: 2.3 }]} warnAbove={30} />)
    expect((html.match(/role="progressbar"/g) ?? []).length).toBe(4)
    expect(html).toContain('75.8%')
    expect(html).toContain('bg-finance-amber')
  })
})

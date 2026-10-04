import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/investment/actions', () => ({
  saveManualTransaction: vi.fn(), addWatchSecurity: vi.fn(), updateTransactionMemo: vi.fn(), deleteManualTransaction: vi.fn(),
}))

import { ManualTransactionForm } from '@/features/investment/transaction-form'
import { TransactionsTable } from '@/features/investment/transactions-table'
import type { TransactionListRow } from '@/features/investment/queries'
import { WatchForm } from '@/features/investment/watch-form'

vi.mock('@/components/app-header', () => ({ AppHeader: () => <header>우리집 투자</header> }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: 'test-household', email: 'dev@example.com' }) }))
vi.mock('@/features/investment/queries', () => ({ getHoldingsData: vi.fn(), loadPortfolioInputs: vi.fn() }))

import HoldingsPage from '@/app/investment/page'
import { getHoldingsData, loadPortfolioInputs } from '@/features/investment/queries'
import { aggregateByMarket } from '@/features/investment/calculations'

const accounts = [{ id: 1, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '1234', active: true, lastSyncedAt: null }]
const securities = [{ id: 10, market: 'KR' as const, symbol: '005930', name: '삼성전자', currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: false }]

describe('ManualTransactionForm', () => {
  const html = renderToStaticMarkup(<ManualTransactionForm accounts={accounts} securities={securities} today="2026-09-29" />)
  it('offers every kind, both currencies for cash rows and caps the date at today', () => {
    for (const label of ['매수', '매도', '배당', '입금', '출금', '수수료', '정정']) expect(html).toContain(`>${label}<`)
    expect(html).toContain('name="tradeDate"')
    expect(html).toContain('max="2026-09-29"')
    expect(html).toContain('name="currency"')
  })
  it('uses t-* classes on controls instead of raw pixel sizes', () => {
    expect(html).not.toMatch(/text-\[\d+px\]/)
    expect(html).toContain('t-body-normal')
  })
})

it('uses primary control heights and disables submission without an active account', () => {
  const html = renderToStaticMarkup(<ManualTransactionForm accounts={[]} securities={securities} today="2026-09-29" />)
  expect(html).toContain('h-[34px]')
  expect(html).toMatch(/<button[^>]*disabled/)
  expect(renderToStaticMarkup(<WatchForm />)).toContain('h-[34px]')
})

it('keeps missing prices unknown in KPIs and preserves owner and market links', async () => {
  const security = securities[0]
  const row = { accountId: 1, securityId: 10, quantity: 2, avgCost: 50000, costBasis: 100000, market: 'KR' as const, currency: 'KRW' as const, price: null, priceSource: 'none' as const, marketValue: null, unrealized: null, returnPct: null, security, weightPct: null, discrepancy: null }
  vi.mocked(loadPortfolioInputs).mockResolvedValue({ accounts: [...accounts, { ...accounts[0], id: 2, owner: 'YJ' }], securities, transactions: [], quotes: [], closes: new Map(), fx: null, broker: [], quotedAt: null, lastSyncedAt: null })
  vi.mocked(getHoldingsData).mockResolvedValue({ status: { quotedAt: null, fx: null, lastSyncedAt: null, workerConnected: false }, summary: aggregateByMarket([row], [], null), attention: [], securitiesCount: { KR: 1, US: 0 }, groups: [{ account: accounts[0], cashKRW: 0, cashUSD: 0, markets: [{ market: 'KR', rows: [row], count: 1, value: 0, unrealized: 0, returnPct: null, valueKRW: 0 }] }] })
  const html = renderToStaticMarkup(await HoldingsPage({ searchParams: Promise.resolve({ owner: 'DJ', market: 'kr' }) }))
  const kpi = html.slice(html.indexOf('aria-label="요약"'), html.indexOf('</section>'))
  expect(kpi).toContain('시세 없음')
  expect(kpi).toMatch(/>–</)
  expect(html).toContain('market=kr&amp;owner=YJ')
  expect(html).toContain('market=us&amp;owner=DJ')
  expect(getHoldingsData).toHaveBeenCalledWith('test-household', 'DJ')
})

describe('TransactionsTable', () => {
  const rows: TransactionListRow[] = [
    { id: 1, accountId: 1, securityId: 10, kind: 'sell', tradeDate: '2026-09-04', quantity: 30, price: 80700, fee: 500, amount: 2420500, currency: 'KRW', source: 'kiwoom', accountName: 'DJ 키움', brokerRef: 'F-1', memo: null, security: { market: 'KR', symbol: '005930', name: '삼성전자' }, realized: 284500, editable: false },
    { id: 2, accountId: 1, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', quantity: null, price: null, fee: 0, amount: 3000000, currency: 'KRW', source: 'manual', accountName: 'DJ 키움', brokerRef: null, memo: '월급', security: null, realized: null, editable: true },
  ]
  const html = renderToStaticMarkup(<TransactionsTable rows={rows} />)
  it('shows market chip, signed amounts, realized on sells and the source', () => {
    expect(html).toContain('국내')
    expect(html).toContain('+2,420,500')
    expect(html).toContain('+284,500')
    expect(html).toContain('키움')
    expect(html).toContain('수동')
  })
  it('only manual rows get a delete control; kiwoom rows get memo only', () => {
    expect((html.match(/삭제/g) ?? []).length).toBe(1)
    expect((html.match(/메모/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

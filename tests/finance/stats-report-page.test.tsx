import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import type { StatsMonthState } from '@/features/analytics/category-detail'
import { buildAnnualReport, type ReportTransactionRow } from '@/features/analytics/report'

const loaders = vi.hoisted(() => ({ stats: vi.fn() }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: 'test', email: 'test@example.com' }) }))
vi.mock('@/features/analytics/stats-report', () => ({ getStatsReportData: loaders.stats }))
// AppHeader is an async database boundary independent of annual statistics.
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null }))

import ReportPage from '@/app/report/page'

function fixture({ closed = [1], records = [1, 2, 4], previous = true }: { closed?: number[]; records?: number[]; previous?: boolean } = {}) {
  const states: StatsMonthState[] = ['open', 'needs_review', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future']
  closed.forEach(month => { states[month - 1] = 'closed' })
  const transactions: ReportTransactionRow[] = [
    { id: 1, date: '2026-01-01', flow: 'income', amount: 1000, major: '급여', memo: '' },
    { id: 2, date: '2026-01-02', flow: 'expense', amount: 100, major: '식비', memo: '식당' },
    { id: 3, date: '2026-02-01', flow: 'income', amount: 2000, major: '급여', memo: '' },
    { id: 4, date: '2026-02-02', flow: 'expense', amount: 500, major: '식비', memo: '식당' },
    { id: 5, date: '2026-04-01', flow: 'income', amount: 99999, major: '급여', memo: '' },
    { id: 6, date: '2025-01-01', flow: 'income', amount: 800, major: '급여', memo: '' },
    { id: 7, date: '2025-01-02', flow: 'expense', amount: 50, major: '식비', memo: '식당' },
    { id: 8, date: '2025-02-01', flow: 'income', amount: 1000, major: '급여', memo: '' },
    { id: 9, date: '2025-02-02', flow: 'expense', amount: 150, major: '식비', memo: '식당' },
  ].filter(row => row.date.startsWith('2025') ? previous : records.includes(Number(row.date.slice(5, 7)))) as ReportTransactionRow[]
  const provisionalMonths = [1, 2, 3].filter(month => records.includes(month) || closed.includes(month))
  const reportInput = { year: 2026, currentMonthKey: '2026-04', transactions, assetBalances: [{ accountId: 1, kind: 'asset', major: '현금', month: '2026-03', amount: 10000 }] }
  const detail = { groups: [], months: Array.from({ length: 12 }, (_, i) => i + 1), currentMonth: 4,
    divisor: closed.length, closedMonths: closed, endedMonths: [1, 2, 3], recordedMonths: records,
    provisionalMonths, provisionalDivisor: provisionalMonths.length, states, monthRevisions: { 1: 7 } }
  return {
    report: { official: buildAnnualReport({ ...reportInput, eligibleMonths: closed, previousComparable: false }), provisional: buildAnnualReport({ ...reportInput, eligibleMonths: provisionalMonths, previousComparable: previous }) },
    monthly: states.map((state, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, state, active: state !== 'future', hasTransactions: records.includes(i + 1), income: i === 3 ? 99999 : i < 2 ? (i + 1) * 1000 : 0, expense: i === 0 ? 100 : i === 1 ? 500 : 0, saving: 0, savingsRate: i === 0 ? 90 : i === 1 ? 75 : 0 })),
    months: states.map((state, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, state: state === 'current' || state === 'future' ? 'open' as const : state, revision: 7, closedAt: null, closedBy: null })),
    monthStates: states, closedMonths: closed, endedMonths: [1, 2, 3], recordedMonths: records, provisionalMonths, hasTransactions: records.length > 0,
    accountMonthly: { expense: { accounts: [], series: {} }, income: { accounts: [], series: {} } },
    details: { expense: detail, income: detail, saving: detail }, savingsTarget: 30,
    targetHitMonths: closed.length, provisionalTargetHitMonths: provisionalMonths.length, assetBasisMonth: '2026-03',
  }
}

async function render(stats = fixture()) {
  loaders.stats.mockResolvedValue(stats)
  return renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ year: '2026' }) }))
}
afterEach(() => vi.clearAllMocks())

test('no closed months shows provisional KPI bodies and forecast, excluding current month and empty ended slots', async () => {
  const html = await render(fixture({ closed: [] }))
  expect(html).toContain('잠정 2개월 (1·2월)')
  expect(html).not.toContain('마감한 월이 없습니다')
  expect(html).toMatch(/t-kpi tabular-nums text-finance-faint">3,000/)
  expect(html).toMatch(/t-kpi-sm text-finance-faint">\+1,200원/)
  expect(html).toContain('달성 2/2개월 (잠정)')
  expect(html).toContain('잠정 · 마감 0개월')
  expect(html).toMatch(/t-caption font-semibold tabular-nums text-finance-faint">11,200/)
})

test('official KPI stays official while fallback comparison takes both years from provisional and maps category and merchant by key', async () => {
  const stats = fixture()
  // Rank is intentionally different; comparison maps must remain the source.
  stats.report.provisional.topExpenses = []
  stats.report.provisional.topMerchants = []
  const html = await render(stats)
  expect(html).toMatch(/t-kpi tabular-nums text-finance-blue">1,000/)
  expect(html).toContain('잠정 · 2025년 미마감')
  const comparison = html.split('전년 같은 기간과 비교')[1].split('앞으로 6개월')[0]
  expect(comparison).toMatch(/text-finance-faint">3,000/)
  expect(comparison).toMatch(/text-finance-faint">1,800/)
  expect(comparison).toContain('67.0%')
  expect(html.split('어디에 썼나')[1].split('가맹점 TOP')[0]).toContain('▲ 200.0%')
  expect(html.split('가맹점 TOP')[1].split('전년 같은 기간과 비교')[0]).toContain('▲ 400')
})

test.each([
  { path: 'official', previousComparable: true, delta: '▲ 50', tone: 'text-finance-red' },
  { path: 'provisional', previousComparable: false, delta: '▲ 400', tone: 'text-finance-faint' },
])('$path merchant comparison normalizes display-name whitespace, digits and uppercase before lookup', async ({ previousComparable, delta, tone }) => {
  const stats = fixture()
  const input = {
    year: 2026, currentMonthKey: '2026-04', assetBalances: [],
    transactions: [
      { id: 1, date: '2026-01-01', flow: 'expense', amount: 100, major: '식비', memo: 'Starbucks 123' },
      { id: 2, date: '2026-02-01', flow: 'expense', amount: 500, major: '식비', memo: 'STAR BUCKS 456' },
      { id: 3, date: '2025-01-01', flow: 'expense', amount: 50, major: '식비', memo: 'starbucks789' },
      { id: 4, date: '2025-02-01', flow: 'expense', amount: 150, major: '식비', memo: 'star bucks 0' },
    ] as ReportTransactionRow[],
  }
  stats.report = {
    official: buildAnnualReport({ ...input, eligibleMonths: [1], previousComparable }),
    provisional: buildAnnualReport({ ...input, eligibleMonths: [1, 2], previousComparable: true }),
  }
  const merchants = (await render(stats)).split('가맹점 TOP')[1].split('전년 같은 기간과 비교')[0]
  expect(merchants).toContain('Starbucks 123')
  expect(merchants).toContain(`class="text-right tabular-nums ${tone}">${delta}</span>`)
  expect(merchants.includes('잠정 · 2025년 미마감')).toBe(!previousComparable)
})

test.each(['income', 'refund', 'offset'] as const)('current-only %s records stay visible with no annual contribution', async kind => {
  const stats = fixture({ closed: [], records: [4], previous: false })
  Object.assign(stats.monthly[3], { income: kind === 'income' ? 99999 : 0, expense: kind === 'refund' ? -200 : 0 })
  const html = await render(stats)
  expect(html).toContain('달마다 어떻게 달랐나')
  expect(html).not.toContain('이 연도에는 거래가 없습니다')
  expect(html).toMatch(/t-kpi tabular-nums text-finance-faint">0</)
  expect(html).toContain('잠정 0개월')
})

test('only a truly empty year uses the empty view, but an explicit closed zero keeps statistics', async () => {
  const empty = await render(fixture({ closed: [], records: [], previous: false }))
  expect(empty).toContain('이 연도에는 거래가 없습니다')
  expect(empty).not.toContain('내역에서 월 마감')
  const closedZero = await render(fixture({ closed: [1], records: [], previous: false }))
  expect(closedZero).toContain('달마다 어떻게 달랐나')
  expect(closedZero).not.toContain('이 연도에는 거래가 없습니다')
  expect(closedZero).not.toContain('전년 대비 ▲')
})

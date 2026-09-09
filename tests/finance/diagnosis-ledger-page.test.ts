import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  diagnosis: vi.fn(async () => ({ month: '2026-07' })),
  analysis: vi.fn(async () => ({})),
  categories: vi.fn(async () => ({})),
  list: vi.fn(async () => ({ rows: [], truncated: false })),
  recurring: vi.fn(async () => ({ activeCount: 0, generatedCount: 0 })),
  options: vi.fn(async () => ({ accounts: [], categories: [] })),
  shell: vi.fn(async () => ({ month: '2026-07', latestMonth: '2026-09', previousMonth: '2026-06', nextMonth: '2026-08', availableMonths: [{ month: '2026-07', count: 166 }], totals: { count: 166, income: 7681047, expense: 5603949, saving: 850000 }, filteredTotals: { count: 2, income: 0, expense: 8888, saving: 0 } })),
}))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ householdId: 'household-a', email: 'test@example.com' }) }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/submit-button', () => ({ SubmitButton: () => null }))
vi.mock('@/features/diagnosis/diagnosis-panel', () => ({ DiagnosisPanel: () => 'DIAGNOSIS_PANEL' }))
vi.mock('@/features/diagnosis/queries', () => ({ getDiagnosisPageData: loaders.diagnosis }))
vi.mock('@/features/analytics/category-page', () => ({ getCategoryPageData: loaders.categories, parseCategoryPageParams: (value: unknown) => value }))
vi.mock('@/features/analytics/queries', () => ({ getAnalysisData: loaders.analysis }))
vi.mock('@/features/ledger/queries', () => ({ LEDGER_ROW_LIMIT: 1000, getLedgerShellData: loaders.shell, getLedgerFormOptions: loaders.options, getLedgerTransactions: loaders.list }))
vi.mock('@/features/ledger/ledger-analysis-panels', () => ({ LedgerSummaryPanel: () => 'SUMMARY_PANEL', LedgerCategoriesPanel: () => 'CATEGORIES_PANEL', LedgerMerchantsPanel: () => 'MERCHANTS_PANEL' }))
vi.mock('@/features/ledger/ledger-filter-form', () => ({ LedgerFilterForm: () => 'LEDGER_FILTERS' }))
vi.mock('@/features/ledger/ledger-sort-select', () => ({ LedgerSortSelect: () => null }))
vi.mock('@/features/ledger/ledger-transactions-table', () => ({ LedgerTransactionsTable: () => 'LEDGER_LIST' }))
vi.mock('@/features/ledger/transaction-form', () => ({ TransactionForm: () => null }))
vi.mock('@/features/recurring/queries', () => ({ getRecurringData: loaders.recurring }))
vi.mock('@/features/recurring/actions', () => ({ applyRecurringMonth: vi.fn() }))
vi.mock('@/features/month-close/queries', () => ({ getMonthCloseSummary: async () => ({ month: '2026-07', revision: 1, closedRevision: null, closedAt: null, state: 'open', count: 166, income: 7681047, expense: 5603949, saving: 850000, pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0, closable: true, requiresAcknowledgment: false }) }))

import LedgerPage from '@/app/ledger/page'

beforeEach(() => { vi.clearAllMocks() })

describe('diagnosis ledger integration', () => {
  test('loads diagnosis for the whole selected month and skips filtered analysis, forms, and recurring loading', async () => {
    const html = renderToStaticMarkup(await LedgerPage({ searchParams: Promise.resolve({ month: '2026-07', tab: 'ai', account: '32', major: '자녀', q: '수업', flow: 'saving' }) }))
    expect(loaders.diagnosis).toHaveBeenCalledWith('household-a', '2026-07')
    expect(loaders.analysis).not.toHaveBeenCalled()
    expect(loaders.categories).not.toHaveBeenCalled()
    expect(loaders.list).not.toHaveBeenCalled()
    expect(loaders.recurring).not.toHaveBeenCalled()
    expect(loaders.options).not.toHaveBeenCalled()
    expect((loaders.shell.mock.calls as unknown[][])[0]?.[2]).toEqual({ account: '', flow: '', major: '', q: '' })
    expect(html).toContain('DIAGNOSIS_PANEL')
    expect(html).not.toContain('LEDGER_FILTERS')
    expect(html).not.toContain('8,888')
    expect(html).not.toContain('정기거래')
    expect(html).toContain('month=2026-06&amp;tab=ai')
  })

  test('orders tabs summary, list, diagnosis, categories, merchants and keeps default tab as list', async () => {
    const html = renderToStaticMarkup(await LedgerPage({ searchParams: Promise.resolve({ month: '2026-07' }) }))
    const nav = html.match(/<nav aria-label="거래 보기"[^>]*>(.*?)<\/nav>/)?.[1] ?? ''
    expect([...nav.matchAll(/>(요약|목록|AI 진단|카테고리|가맹점)<\/a>/g)].map((match) => match[1])).toEqual(['요약', '목록', 'AI 진단', '카테고리', '가맹점'])
    expect(html).toContain('LEDGER_LIST')
    expect(html).toContain('LEDGER_FILTERS')
    expect(loaders.diagnosis).not.toHaveBeenCalled()
    expect(loaders.list).toHaveBeenCalledOnce()
  })
})

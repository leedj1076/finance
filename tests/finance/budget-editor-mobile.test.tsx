import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import type { BudgetRecommendationController } from '@/features/budget-recommendations/use-recommendation'
import { AiEvidencePopover, AiSummaryPopover } from '@/features/budgets/ai-evidence'
import { AiRequestDialog } from '@/features/budgets/ai-request-dialog'
import { PlanItem } from '@/features/budgets/plan-item'
import { PlanToolbar } from '@/features/budgets/plan-toolbar'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const snapshot = makeBudgetSnapshot()
const report = makeBudgetReport()
const completed = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  completedAt: '2026-09-27T05:02:00.000Z',
  snapshot,
  promptInput: null,
  report,
  evaluation: { allocated: 650_000, unallocatedReserve: 0, total: 650_000, overage: 0, savingsRate: 30, rows: [] },
}

describe('390px budget editor markup', () => {
  test('keeps the item name and 150px amount control on one top line before the full-width caption and four references', () => {
    const html = renderToStaticMarkup(createElement(PlanItem, {
      row: {
        major: '식비', group: 'variable', actual: 0, previousBudget: 600_000,
        saved: { amount: 600_000, recommendationJobId: null, version: 'v1' },
        previousActual: { amount: 612_400, month: '2026-09', partial: null },
        average3: { amount: 656_262, months: ['2026-06', '2026-07', '2026-08'], monthsWithSpend: 3, provisional: false },
      },
      draft: { major: '식비', amount: '600000', source: null, recommendationJobId: 'current-job' },
      month: '2026-10', period: 'future',
      currentRecommendation: { jobId: 'current-job', amount: 650_000, completedAt: completed.completedAt, reason: '최근 지출과 예정 장보기를 반영했습니다.' },
      savedRecommendation: null,
      onChoose: vi.fn(), onChooseAi: vi.fn(), onEdit: vi.fn(), onOpenEvidence: vi.fn(),
    }))

    expect(html).toMatch(/<div class="plan-item__topline">[\s\S]*class="plan-item__major"[\s\S]*class="plan-item__input-row t-caption"[\s\S]*<\/div><p class="plan-item__caption/)
    expect(html.match(/class="plan-reference__option/g)).toHaveLength(4)
    expect(html).not.toContain('type="radio"')
  })

  test('reuses an accessible native mobile fill menu', () => {
    const html = renderToStaticMarkup(createElement(PlanToolbar, {
      aiFillDisabled: false,
      aiStatus: { text: 'AI 추천 · 9월 27일 14:02 · 합계 650,000 · 상한 안', tone: 'default' },
      aiActions: [],
      onFillRequest: vi.fn(),
    }))

    expect(html).toContain('<details class="plan-toolbar__mobile-fill">')
    expect(html).toContain('<summary class="plan-toolbar__mobile-summary t-caption">')
    expect(html).toContain('전체 채우기')
    expect(html).not.toContain('type="radio"')
  })

  test('marks request, evidence, and summary surfaces with their bounded responsive sizes', () => {
    const controller = {
      month: '2026-10', majors: ['식비'], basis: snapshot.basis, data: null,
      recovering: false, submitting: false, active: false, networkError: null,
      hasAmbiguousRequest: false, notes: '', setNotes: vi.fn(), planned: [],
      composer: { major: '식비', amount: '', note: '' }, setComposer: vi.fn(),
      plannedError: null, inputError: null, addPlannedExpense: vi.fn(),
      updatePlannedExpense: vi.fn(), removePlannedExpense: vi.fn(),
      generate: vi.fn().mockResolvedValue(true), recover: vi.fn(), promptJobId: null,
      promptView: null, promptLoading: false, promptError: null, loadPrompt: vi.fn(), clearPrompt: vi.fn(),
    } satisfies BudgetRecommendationController
    const request = renderToStaticMarkup(createElement(AiRequestDialog, { controller, open: true, onClose: vi.fn() }))
    const context = { jobId: completed.id, completedAt: completed.completedAt, recommendation: report.rows[0], snapshot, promptInput: null }
    const evidence = renderToStaticMarkup(createElement(AiEvidencePopover, { context, open: true, onClose: vi.fn(), onApplyChecked: vi.fn() }))
    const summary = renderToStaticMarkup(createElement(AiSummaryPopover, { completed, open: true, onClose: vi.fn(), onShowPrompt: vi.fn() }))

    expect(request).toMatch(/<dialog[^>]+class="ai-request-dialog"/)
    expect(evidence).toContain('class="ai-anchored-popover ai-anchored-popover--evidence"')
    expect(summary).toContain('class="ai-anchored-popover ai-anchored-popover--summary"')
  })
})

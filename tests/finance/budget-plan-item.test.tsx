import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import { PlanItem } from '@/features/budgets/plan-item'
import type { BudgetDraftRow } from '@/features/budgets/draft'
import type { BudgetPlanRow } from '@/features/budgets/plan-sources'

const plan: BudgetPlanRow = {
  major: '식비',
  group: 'variable',
  saved: { amount: 600_000, recommendationJobId: null, version: 'v1' },
  actual: 301_500,
  previousBudget: 600_000,
  previousActual: { amount: 612_400, month: '2026-09', partial: { asOf: '2026-09-27' } },
  average3: {
    amount: 656_262,
    months: ['2026-09', '2026-08', '2026-07'],
    monthsWithSpend: 2,
    spendMonths: ['2026-09', '2026-07'],
    provisional: true,
  },
}

const draft: BudgetDraftRow = {
  major: '식비',
  amount: '600000',
  source: 'previousBudget',
  recommendationJobId: null,
}

function render(overrides: Partial<Parameters<typeof PlanItem>[0]> = {}) {
  return renderToStaticMarkup(createElement(PlanItem, {
    row: plan,
    draft,
    month: '2026-10',
    period: 'future',
    currentRecommendation: {
      jobId: 'current-job',
      amount: 650_000,
      reason: '최근 지출과 예정 장보기를 반영했습니다.',
      completedAt: '2026-09-27T05:02:00.000Z',
      stale: false,
    },
    savedRecommendation: null,
    onChoose: vi.fn(),
    onChooseAi: vi.fn(),
    onEdit: vi.fn(),
    onOpenEvidence: vi.fn(),
    ...overrides,
  }))
}

describe('PlanItem', () => {
  test('renders four source buttons and selects only the draft source with an SVG check', () => {
    const html = render()

    expect(html).toMatch(/<button[^>]+aria-pressed="true"[^>]*>[\s\S]*지난달 예산[\s\S]*<svg/)
    expect(html).toMatch(/<button[^>]+aria-pressed="false"[^>]*>[\s\S]*지난달 실적/)
    expect(html).toMatch(/<button[^>]+aria-pressed="false"[^>]*>[\s\S]*3개월 평균/)
    expect(html).toMatch(/<button[^>]+aria-pressed="false"[^>]*>[\s\S]*AI 추천/)
  })

  test('renders partial and provisional captions with months ordered oldest first', () => {
    const html = render()

    expect(html).toContain('9월 27일까지 · 진행 중 · +12,400 초과')
    expect(html).toContain('7·8·9월 · 잠정')
  })

  test('adds exact irregular spend months without guessing months from the count', () => {
    const html = render({ row: { ...plan, group: 'irregular' } })

    expect(html).toContain('7·8·9월 · 7·9월 2회 · 잠정')
  })

  test('disables and strikes unavailable zero sources with their reasons', () => {
    const html = render({
      row: {
        ...plan,
        previousActual: { ...plan.previousActual, amount: 0 },
        average3: { ...plan.average3, amount: 0 },
      },
      currentRecommendation: null,
    })

    expect(html).toMatch(/<button[^>]+plan-reference__option--unavailable[^>]+disabled=""[^>]*>[\s\S]*지난달 실적[\s\S]*지출 없음/)
    expect(html).toMatch(/<button[^>]+plan-reference__option--unavailable[^>]+disabled=""[^>]*>[\s\S]*3개월 평균[\s\S]*지출 없음/)
    expect(html).toMatch(/<button[^>]+plan-reference__option--unavailable[^>]+disabled=""[^>]*>[\s\S]*AI 추천[\s\S]*추천 없음/)
  })

  test('shows usage only for the current month', () => {
    expect(render({ month: '2026-09', period: 'current' })).toContain('사용 301,500 · 남은 298,500')
    expect(render({ month: '2026-10', period: 'future' })).not.toContain('사용 301,500')
  })

  test('shows manual and current AI adjustment captions', () => {
    expect(render({ draft: { ...draft, source: null } })).toContain('직접 입력')
    expect(render({
      draft: { ...draft, amount: '600000', source: null, recommendationJobId: 'current-job' },
    })).toContain('AI 추천 650,000에서 조정')
  })

  test('suppresses the input caption for an exact current AI selection', () => {
    const html = render({
      draft: { ...draft, amount: '650000', source: 'ai', recommendationJobId: 'current-job' },
    })

    expect(html).not.toContain('plan-item__caption--violet')
  })

  test('dates an older saved AI origin and preserves factual evidence at its original amount', () => {
    const origin = {
      jobId: 'saved-job',
      amount: 650_000,
      completedAt: '2026-09-03T03:00:00.000Z',
    }

    expect(render({
      draft: { ...draft, amount: '600000', source: null, recommendationJobId: 'saved-job' },
      savedRecommendation: origin,
    })).toContain('AI 추천 (9월 3일) 650,000에서 조정')
    const exactOriginHtml = render({
      draft: { ...draft, amount: '650000', source: null, recommendationJobId: 'saved-job' },
      savedRecommendation: origin,
    })
    expect(exactOriginHtml).toContain('AI 추천 (9월 3일) 650,000')
    expect(exactOriginHtml).toContain('근거')
  })

  test('does not infer selection from equal amounts and keeps an older origin visible beside a historical selection', () => {
    const noSource = render({ draft: { ...draft, source: null } })
    expect(noSource).not.toContain('plan-reference__option--selected')

    const historical = render({
      draft: { ...draft, source: 'previousBudget', recommendationJobId: 'saved-job' },
      savedRecommendation: {
        jobId: 'saved-job',
        amount: 600_000,
        completedAt: '2026-09-03T03:00:00.000Z',
      },
    })
    expect(historical).toContain('AI 추천 (9월 3일) 600,000')
    expect(historical).toContain('근거')
  })

  test('shows the exact missing-origin warning and keeps current AI evidence injectable', () => {
    const html = render({
      draft: { ...draft, source: 'previousBudget', recommendationJobId: 'missing-job' },
      currentEvidence: createElement('span', null, '주입한 현재 근거'),
      savedRecommendation: null,
    })

    expect(html).toContain('이 추천의 근거를 확인할 수 없습니다')
    expect(html).toContain('주입한 현재 근거')
  })
})

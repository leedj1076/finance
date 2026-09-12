import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import { PlanList } from '@/features/budgets/plan-list'
import { PlanToolbar } from '@/features/budgets/plan-toolbar'
import type { BudgetDraft } from '@/features/budgets/draft'
import type { BudgetPlanRow } from '@/features/budgets/plan-sources'

const rows: BudgetPlanRow[] = [
  ['주거', 'fixed'],
  ['식비', 'variable'],
  ['여행', 'irregular'],
].map(([major, group]) => ({
  major,
  group: group as BudgetPlanRow['group'],
  saved: { amount: major === '식비' ? 600_000 : 100_000, recommendationJobId: null, version: 'v1' },
  actual: 0,
  previousBudget: 100_000,
  previousActual: { amount: 90_000, month: '2026-09', partial: null },
  average3: { amount: 95_000, months: ['2026-08', '2026-07', '2026-06'], monthsWithSpend: 3, provisional: false },
}))

const draft: BudgetDraft = {
  rows: rows.map(row => ({
    major: row.major,
    amount: String(row.saved.amount),
    source: 'previousBudget',
    recommendationJobId: null,
  })),
  baseline: rows.map(row => ({ major: row.major, ...row.saved })),
  undoRows: null,
}

describe('PlanToolbar', () => {
  test('exposes four fill requests and AI state actions', () => {
    const html = renderToStaticMarkup(createElement(PlanToolbar, {
      aiFillDisabled: false,
      aiStatus: { text: 'AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 안', tone: 'default' },
      aiActions: [
        { label: '요약', onClick: vi.fn() },
        { label: '다시 추천', onClick: vi.fn() },
      ],
      onFillRequest: vi.fn(),
    }))

    expect(html).toContain('전체 채우기')
    for (const label of ['지난달 예산', '지난달 실적', '3개월 평균', 'AI 추천']) {
      expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`))
    }
    expect(html).toContain('AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 안')
    expect(html).toContain('요약')
    expect(html).toContain('다시 추천')
    expect(html).toContain('<details class="plan-toolbar__mobile-fill">')
    expect(html).toContain('<summary class="plan-toolbar__mobile-summary t-caption">')
    for (const label of ['지난달 예산', '지난달 실적', '3개월 평균', 'AI 추천']) {
      expect(html.match(new RegExp(`>${label}</button>`, 'g'))).toHaveLength(2)
    }
  })
})

function textFrom(html: string) {
  return html.replace(/<[^>]+>/g, '')
}

describe('PlanList', () => {
  test('renders the three groups, table contract, and four references per item', () => {
    const html = renderToStaticMarkup(createElement(PlanList, {
      rows,
      draft,
      month: '2026-10',
      period: 'future',
      recommendations: {},
      savedRecommendations: {},
      onChoose: vi.fn(),
      onChooseAi: vi.fn(),
      onEdit: vi.fn(),
      onOpenEvidence: vi.fn(),
      onConfirmFillAll: vi.fn(),
      onKeepEdited: vi.fn(),
      onCancelFill: vi.fn(),
      onUndo: vi.fn(),
    }))

    expect(html).toContain('항목')
    expect(html).toContain('예산 (원)')
    expect(html).toContain('참고')
    expect(html).toContain('줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다')
    expect(html).toContain('고정비')
    expect(html).toContain('조절이 어려운 비용')
    expect(html).toContain('변동비')
    expect(html).toContain('생활하면서 조절할 비용')
    expect(html).toContain('비정기')
    expect(html).toContain('여행·경조사 등 월 적립 예산')
    expect((html.match(/지난달 예산/g) ?? [])).toHaveLength(3)
  })

  test('shows only overwritten rows in a native dismissible modal with all actions', () => {
    const html = renderToStaticMarkup(createElement(PlanList, {
      rows,
      draft,
      month: '2026-10',
      period: 'future',
      recommendations: {},
      savedRecommendations: {},
      fillConfirmation: {
        source: 'previousActual',
        overwritten: [
          { ...draft.rows[1], amount: '600000' },
          { ...draft.rows[2], amount: '130000' },
        ],
        choices: [
          { major: '식비', amount: 612_400, source: 'previousActual', recommendationJobId: null },
          { major: '여행', amount: 84_900, source: 'previousActual', recommendationJobId: null },
          { major: '주거', amount: 90_000, source: 'previousActual', recommendationJobId: null },
        ],
      },
      onChoose: vi.fn(),
      onChooseAi: vi.fn(),
      onEdit: vi.fn(),
      onOpenEvidence: vi.fn(),
      onConfirmFillAll: vi.fn(),
      onKeepEdited: vi.fn(),
      onCancelFill: vi.fn(),
      onUndo: vi.fn(),
    }))

    expect(html).toContain('이미 고친 2개 항목이 바뀝니다')
    expect(html).toMatch(/<dialog[^>]+aria-label="전체 채우기 확인"[^>]+closedby="any"[^>]*>/)
    expect(html).toContain('식비 600,000 → 612,400')
    expect(html).toContain('여행 130,000 → 84,900')
    expect(html).not.toContain('주거 100,000 → 90,000')
    expect(html).toContain('모두 채우기')
    expect(html).toContain('고친 항목은 두기')
    expect(html).toContain('취소')
  })

  test('renders the last fill notice and undo action', () => {
    const html = renderToStaticMarkup(createElement(PlanList, {
      rows,
      draft: { ...draft, undoRows: draft.rows },
      month: '2026-10',
      period: 'future',
      recommendations: {},
      savedRecommendations: {},
      fillNotice: { source: 'previousActual', count: 8 },
      onChoose: vi.fn(),
      onChooseAi: vi.fn(),
      onEdit: vi.fn(),
      onOpenEvidence: vi.fn(),
      onConfirmFillAll: vi.fn(),
      onKeepEdited: vi.fn(),
      onCancelFill: vi.fn(),
      onUndo: vi.fn(),
    }))

    expect(textFrom(html)).toContain('지난달 실적으로 8개 항목을 채웠습니다')
    expect(html).toContain('실행 취소')
    expect(html).toContain('저장 전에는 바뀌지 않습니다.')
    expect(html).toContain('최근 변경 실행 취소')
  })
})

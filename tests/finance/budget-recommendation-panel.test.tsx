import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import type { AiPromptInput } from '@/features/ai-settings/types'
import type { BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'
import {
  BudgetRow,
  type RecommendationRowContext,
} from '@/features/budgets/budget-row'
import type { BudgetDraftRow } from '@/features/budgets/draft'
import type { BudgetBaseline } from '@/features/budgets/save-contract'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const latestJobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const savedJobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const baseline: BudgetBaseline = {
  major: '식비', amount: 350_000, recommendationJobId: savedJobId, version: 'food-v1',
}
const source = makeBudgetSnapshot().rows[0]
function frozenPrompt(marker: string): AiPromptInput {
  return {
    version: 1,
    kind: 'budget',
    instructions: {
      kind: 'budget', settingsRevision: 3, defaultsVersion: 'test-v1',
      common: `${marker} 가족 식사를 우선해 주세요.`, task: '외식은 줄여 주세요.',
      commonSource: 'custom', taskSource: 'custom',
    },
    policyVersion: 'test-v1',
    instructionsHash: 'a'.repeat(64),
    prefix: 'fixed input',
    suffix: 'fixed output',
    promptHash: 'b'.repeat(64),
  }
}

function frozenSnapshot(marker: string, evidenceDate = '2026-09-01'): Pick<BudgetRecommendationSnapshot, 'month' | 'input' | 'evidence' | 'recurring'> {
  return {
    month: '2026-09',
    input: {
      month: '2026-09',
      notes: `${marker} 명절 식사는 가족과 함께합니다.`,
      plannedExpenses: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', major: '식비', amount: 50_000, note: `${marker} 생일 식사`,
      }],
      draftAmounts: [{ major: '식비', amount: 350_000 }],
    },
    evidence: [{
      id: 11, date: evidenceDate, flow: 'expense', amount: 120_000,
      major: '식비', sub: '장보기', merchant: `${marker} 마트`,
    }],
    recurring: [{ id: 7, major: '식비', amount: 30_000, date: '2026-09-25', posted: false, memo: `${marker} 정기 식재료` }],
  }
}

function context(jobId: string, amount: number, reason: string, marker: string, evidenceDate?: string): RecommendationRowContext {
  const reportRow = makeBudgetReport().rows[0]
  return {
    jobId,
    recommendation: {
      ...reportRow,
      amount,
      reason,
      references: [
        { kind: 'transaction', id: 11 },
        { kind: 'recurring', id: 7 },
        { kind: 'planned', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        { kind: 'notes', quote: `${marker} 명절 식사` },
        { kind: 'instructions', scope: 'common', quote: `${marker} 가족 식사` },
      ],
      exceptional: [{ text: `${marker} 외식은 일회성일 수 있습니다.`, certainty: 'hypothesis', references: [] }],
      reducible: [{ text: `${marker} 배달비를 확인해 주세요.`, certainty: 'recorded', references: [{ kind: 'transaction', id: 11 }] }],
    },
    snapshot: frozenSnapshot(marker, evidenceDate),
    promptInput: frozenPrompt(marker),
  }
}

function render(row: BudgetDraftRow, overrides: Partial<Parameters<typeof BudgetRow>[0]> = {}) {
  return renderToStaticMarkup(createElement(BudgetRow, {
    row,
    baseline,
    source,
    actual: 100_000,
    month: '2026-09',
    period: 'current',
    recommendation: context(latestJobId, 300_000, '<script>현재 추천</script>', '현재'),
    origin: context(savedJobId, 320_000, '저장된 추천 이유', '저장'),
    selected: false,
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onManual: vi.fn(),
    ...overrides,
  }))
}

describe('budget recommendation row', () => {
  test('renders one accessible current-month editor with latest and saved reasons kept in their frozen contexts', () => {
    const html = render(
      { major: '식비', amount: '310000', source: null, recommendationJobId: savedJobId },
      { source: null },
    )

    expect(html).toContain('식비')
    expect(html).toContain('aria-label="식비 예산"')
    expect(html).toContain('aria-label="식비 추천 선택"')
    expect(html).toContain('aria-label="식비 추천 이유"')
    expect(html).toContain('aria-label="식비 저장된 추천 이유"')
    expect(html).toContain('저장된 예산')
    expect(html).toContain('350,000원')
    expect(html).toContain('실제 지출 −100,000원')
    expect(html).toContain('앞으로 배정한 금액 210,000원')
    expect(html).toContain('현재 AI 추천 300,000원')
    expect(html).toContain('원래 AI 추천 320,000원')
    expect(html).toContain('사용자 조정 310,000원')
    expect(html).toContain('&lt;script&gt;현재 추천&lt;/script&gt;')
    expect(html).not.toContain('<script>현재 추천</script>')
    expect(html).toContain('저장된 추천 이유')
    expect(html).toContain('/ledger?month=2026-09&amp;tab=list&amp;flow=expense&amp;major=%EC%8B%9D%EB%B9%84')
    expect(html).toContain('현재 마트')
    expect(html).toContain('저장 마트')
    expect(html).toContain('2026-09-25 · 현재 정기 식재료')
    expect(html).toContain('사용자 제공 · 현재 생일 식사 · 50,000원')
    expect(html).toContain('사용자 제공 · 현재 명절 식사')
    expect(html).toContain('설정에서 제공한 정보 · 현재 가족 식사')
    expect(html).toContain('일회성 후보')
    expect(html).toContain('추정 · 확인 필요')
    expect(html).toContain('조정 후보')
  })

  test('renders a future month as a whole-month budget without current-month allocation language', () => {
    const html = render(
      { major: '식비', amount: '310000', source: null, recommendationJobId: null },
      { period: 'future', origin: null, source: null, actual: 0 },
    )

    expect(html).toContain('월 전체 예산 310,000원')
    expect(html).not.toContain('앞으로 배정한 금액')
    expect(html).not.toContain('실제 지출')
  })

  test('links current and saved-origin transaction evidence to each frozen evidence month', () => {
    const html = render(
      { major: '식비', amount: '310000', source: null, recommendationJobId: savedJobId },
      {
        recommendation: context(latestJobId, 300_000, '현재 추천 이유', '현재', '2026-09-05'),
        origin: context(savedJobId, 320_000, '저장된 추천 이유', '저장', '2026-08-31'),
      },
    )

    expect(html).toContain('href="/ledger?month=2026-09&amp;tab=list&amp;flow=expense&amp;major=%EC%8B%9D%EB%B9%84">2026-09-05 · 현재 마트')
    expect(html).toContain('href="/ledger?month=2026-08&amp;tab=list&amp;flow=expense&amp;major=%EC%8B%9D%EB%B9%84">2026-08-31 · 저장 마트')
  })

  test('shows a net expense refund with a positive sign and adds it back to remaining allocation', () => {
    const html = render(
      { major: '식비', amount: '310000', source: null, recommendationJobId: null },
      { source: null, actual: -25_000, origin: null },
    )

    expect(html).toContain('실제 지출 +25,000원')
    expect(html).toContain('앞으로 배정한 금액 335,000원')
  })

  test('keeps manual editing available when a saved origin cannot be validated', () => {
    const html = render(
      { major: '식비', amount: '350000', source: null, recommendationJobId: savedJobId },
      { recommendation: null, origin: null },
    )

    expect(html).toContain('이 추천의 근거를 확인할 수 없습니다.')
    expect(html).toContain('aria-label="식비 수동 초안으로 전환"')
    expect(html).toContain('aria-label="식비 예산"')
  })

  test('marks an invalid in-progress amount without coercing it to zero', () => {
    const html = render({ major: '식비', amount: '', source: null, recommendationJobId: null }, { origin: null })

    expect(html).toContain('value=""')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('원 단위의 0 이상 정수를 입력해 주세요.')
    expect(html).not.toContain('월 전체 예산 0원')
  })
})

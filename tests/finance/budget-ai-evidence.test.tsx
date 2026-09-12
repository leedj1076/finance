import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import type { AiPromptInput } from '@/features/ai-settings/types'
import type { CompletedBudgetRecommendation } from '@/features/budget-recommendations/types'
import {
  AiEvidencePopover,
  AiSummaryPopover,
  type AiEvidenceContext,
} from '@/features/budgets/ai-evidence'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const savedJobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function prompt(): AiPromptInput {
  return {
    version: 1,
    kind: 'budget',
    instructions: {
      kind: 'budget', settingsRevision: 3, defaultsVersion: 'test-v1',
      common: '가족 식사를 우선해 주세요.', task: '외식은 줄여 주세요.',
      commonSource: 'custom', taskSource: 'custom',
    },
    policyVersion: 'test-v1', instructionsHash: 'a'.repeat(64),
    prefix: 'fixed input', suffix: 'fixed output', promptHash: 'b'.repeat(64),
  }
}

function evidenceContext(): AiEvidenceContext {
  const snapshot = makeBudgetSnapshot()
  snapshot.input.notes = '<script>명절 식사</script> 계획'
  snapshot.input.plannedExpenses = [{ id: 'planned-1', major: '식비', amount: 50_000, note: '생일 식사' }]
  snapshot.recurring = [{ id: 7, major: '식비', amount: 30_000, date: '2026-09-25', posted: false, memo: '정기 식재료' }]
  const recommendation = {
    ...makeBudgetReport().rows[0],
    amount: 650_000,
    reason: '<script>최근 장보기와 계획을 반영했습니다.</script>',
    references: [
      { kind: 'transaction' as const, id: 11 },
      { kind: 'recurring' as const, id: 7 },
      { kind: 'planned' as const, id: 'planned-1' },
      { kind: 'notes' as const, quote: '<script>명절 식사</script>' },
      { kind: 'instructions' as const, scope: 'common' as const, quote: '가족 식사' },
    ],
    exceptional: [{ text: '외식은 일회성일 수 있습니다.', certainty: 'hypothesis' as const, references: [] }],
    reducible: [{
      text: '배달비를 확인해 주세요.', certainty: 'recorded' as const,
      references: [{ kind: 'transaction' as const, id: 11 }],
    }],
  }
  return {
    jobId: savedJobId,
    completedAt: '2026-09-03T03:00:00.000Z',
    recommendation,
    snapshot,
    promptInput: prompt(),
  }
}

function completed(): CompletedBudgetRecommendation {
  const snapshot = makeBudgetSnapshot()
  snapshot.current.unallocatedActual = 20_000
  snapshot.current.unallocatedRecurring = 30_000
  snapshot.evidenceCount = { provided: 8, total: 10 }
  snapshot.pendingCount = 2
  snapshot.unclassifiedCount = 3
  return {
    id: savedJobId,
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    completedAt: '2026-09-03T03:00:00.000Z',
    snapshot,
    promptInput: prompt(),
    report: {
      ...makeBudgetReport(),
      summary: '<script>요약</script>',
      limitations: ['현금 지출은 확인이 필요합니다.'],
      overCeilingReason: '예정된 병원비를 우선 반영했습니다.',
      adjustments: [{ text: '배달 예산을 줄일 수 있습니다.', certainty: 'user_provided', references: [] }],
    },
    evaluation: {
      allocated: 700_000, unallocatedReserve: 50_000, total: 750_000,
      overage: 50_000, savingsRate: 25, rows: [],
    },
  }
}

describe('AI recommendation evidence', () => {
  test('keeps prior-job evidence in its frozen context and safely renders reason, findings, and references', () => {
    const html = renderToStaticMarkup(createElement(AiEvidencePopover, {
      context: evidenceContext(),
      open: true,
      onClose: vi.fn(),
      onApplyChecked: vi.fn(),
    }))

    expect(html).toContain('식비 · AI 추천 650,000원')
    expect(html).toContain('9월 3일 12:00')
    expect(html).toContain('&lt;script&gt;최근 장보기와 계획을 반영했습니다.&lt;/script&gt;')
    expect(html).not.toContain('<script>최근 장보기와 계획을 반영했습니다.</script>')
    expect(html).toContain('일회성 후보')
    expect(html).toContain('추정 · 확인 필요')
    expect(html).toContain('조정 후보')
    expect(html).toContain('기록 확인')
    expect(html).toContain('사용자 제공')
    expect(html).toContain('/ledger?month=2026-09&amp;tab=list&amp;flow=expense&amp;major=%EC%8B%9D%EB%B9%84')
    expect(html).toContain('2026-09-01 · 동네마트 · 100,000원')
    expect(html).toContain('2026-09-25 · 정기 식재료 · 30,000원')
    expect(html).toContain('사용자 제공 · 생일 식사 · 50,000원')
    expect(html).toContain('사용자 제공 · &lt;script&gt;명절 식사&lt;/script&gt;')
    expect(html).toContain('설정에서 제공한 정보 · 가족 식사')
    expect(html).toMatch(/<button[^>]+type="button"[^>]*>650,000원 넣기<\/button>/)
  })

  test('renders the approved summary counts, limitations, adjustment labels, and prompt action', () => {
    const html = renderToStaticMarkup(createElement(AiSummaryPopover, {
      completed: completed(),
      open: true,
      onClose: vi.fn(),
      onShowPrompt: vi.fn(),
    }))

    expect(html).toContain('&lt;script&gt;요약&lt;/script&gt;')
    expect(html).not.toContain('<script>요약</script>')
    expect(html).toContain('미분류 실제 지출')
    expect(html).toContain('20,000원')
    expect(html).toContain('미배정 정기 지출')
    expect(html).toContain('30,000원')
    expect(html).toContain('근거 제공')
    expect(html).toContain('8 / 10')
    expect(html).toContain('처리 대기·미분류')
    expect(html).toContain('2건 · 3건')
    expect(html).toContain('현금 지출은 확인이 필요합니다.')
    expect(html).toContain('예정된 병원비를 우선 반영했습니다.')
    expect(html).toContain('상한 조정 후보')
    expect(html).toContain('사용자 제공')
    expect(html).toContain('배달 예산을 줄일 수 있습니다.')
    expect(html).toMatch(/<button[^>]+type="button"[^>]*>사용한 프롬프트<\/button>/)
  })
})

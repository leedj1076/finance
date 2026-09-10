import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import {
  BudgetRecommendationPanel,
  classifyBudgetRecommendationRequestError,
} from '@/features/budget-recommendations/panel'
import type { BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'

const basis: BudgetRecommendationSnapshot['basis'] = {
  averageIncome: 4_000_000,
  savingsTarget: 25,
  spendCeiling: 3_000_000,
  incomeStart: '2026-06',
  incomeEnd: '2026-08',
  incomeMonthCount: 3,
}

function render(overrides: Partial<Parameters<typeof BudgetRecommendationPanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(BudgetRecommendationPanel, {
    month: '2026-09',
    majors: ['식비', '<script>위험</script>'],
    basis,
    targetDirty: false,
    getDraftAmounts: () => [{ major: '식비', amount: 350_000 }],
    onData: vi.fn(),
    ...overrides,
  }))
}

describe('budget recommendation panel controls', () => {
  test('renders the saved basis and bounded optional inputs without owning editor actions', () => {
    const html = render()

    expect(html).toContain('2026년 9월 AI 예산 추천')
    expect(html).toContain('저장된 추천 기준')
    expect(html).toContain('월평균 수입')
    expect(html).toContain('4,000,000원')
    expect(html).toContain('목표 저축률 25%')
    expect(html).toContain('지출 상한 3,000,000원')
    expect(html).toContain('href="/settings?section=ai"')
    expect(html).toContain('AI 진단 설정')
    expect(html).toMatch(/<textarea[^>]+aria-label="추천에 전달할 참고 메모"[^>]+maxlength="4000"/i)
    expect(html).toContain('aria-label="예정 지출 카테고리"')
    expect(html).toContain('&lt;script&gt;위험&lt;/script&gt;')
    expect(html).not.toContain('<script>위험</script>')
    expect(html).toMatch(/aria-label="예정 지출 금액"[^>]+inputMode="numeric"/i)
    expect(html).toMatch(/aria-label="예정 지출 메모"[^>]+maxlength="200"/i)
    expect(html).toContain('예정 지출은 이미 기록된 지출이나 반복 지출에 포함되지 않은 추가 금액입니다.')
    expect(html).not.toContain('선택한 추천 가져오기')
    expect(html).not.toContain('추천 전체 선택')
    expect(html).not.toContain('예산 저장')
  })

  test('keeps recommendation start disabled while the savings target has unsaved changes', () => {
    const html = render({ targetDirty: true })

    expect(html).toContain('저축 목표를 먼저 저장해 주세요.')
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>AI 예산 추천<\/button>/)
  })

  test('explains absent income and never enables AI from a zero-income basis', () => {
    const html = render({ basis: { ...basis, averageIncome: 0, spendCeiling: 0, incomeMonthCount: 0 } })

    expect(html).toContain('기준 수입이 있어야 AI 예산 추천을 시작할 수 있어요.')
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>AI 예산 추천<\/button>/)
  })

  test('disables planned-cost creation when there is no canonical active major', () => {
    const html = render({ majors: [] })

    expect(html).toContain('사용할 수 있는 카테고리가 없어 예정 지출을 추가할 수 없어요.')
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>예정 지출 추가<\/button>/)
  })

  test.each([
    ['invalid_input', '입력한 예정 지출과 예산 금액을 확인해 주세요.'],
    ['unauthorized', '로그인이 필요합니다. 다시 로그인해 주세요.'],
    ['forbidden', '이 가계부의 AI 예산 추천을 사용할 권한이 없습니다.'],
    ['body_too_large', '입력 내용이 너무 큽니다. 참고 메모나 예정 지출을 줄여 주세요.'],
    ['active_job_exists', '이미 진행 중인 추천 요청이 있어요. 상태를 다시 확인해 주세요.'],
    ['request_conflict', '같은 요청 ID의 입력이 달라 다시 보낼 수 없어요. 상태를 확인한 뒤 새로 추천해 주세요.'],
    ['past_or_distant_month', 'AI 예산 추천은 이번 달과 다음 달에서만 사용할 수 있어요.'],
    ['missing_income', '기준 수입이 있어야 AI 예산 추천을 시작할 수 있어요.'],
    ['setup_required', 'AI 작업기 설정을 확인한 뒤 다시 시도해 주세요.'],
    ['source_changed', '기록이 변경되어 재추천이 필요합니다.'],
    ['budgets_changed', '예산이 변경되어 재추천이 필요합니다.'],
    ['invalid_result', '추천 결과를 안전하게 확인하지 못했어요.'],
  ])('treats the client-safe %s response as a terminal request error', (code, message) => {
    expect(classifyBudgetRecommendationRequestError(new Error(code))).toEqual({
      code, message, ambiguous: false,
    })
  })

  test.each([
    ['request_failed', '요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'],
    ['request_timeout', '요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'],
  ])('preserves the frozen retry intent only for ambiguous %s', (code, message) => {
    expect(classifyBudgetRecommendationRequestError(new Error(code))).toEqual({
      code, message, ambiguous: true,
    })
  })

  test('maps arbitrary error text to the generic safe retry state', () => {
    const result = classifyBudgetRecommendationRequestError(new Error('private database detail'))

    expect(result).toEqual({
      code: 'request_failed',
      message: '요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      ambiguous: true,
    })
    expect(result.message).not.toContain('private database detail')
  })
})

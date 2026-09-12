import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import {
  createFrozenBudgetRecommendationRequest,
  classifyBudgetRecommendationRequestError,
  ownsBudgetRecommendationRequest,
  reconcileBudgetRecommendationData,
  retryRequestAfterError,
  type BudgetRecommendationController,
} from '@/features/budget-recommendations/use-recommendation'
import type {
  BudgetRecommendationData,
  BudgetRecommendationSnapshot,
  BudgetRequest,
  CompletedBudgetRecommendation,
} from '@/features/budget-recommendations/types'
import { AiRequestDialog } from '@/features/budgets/ai-request-dialog'
import { budgetRecommendationToolbarModel, PlanToolbar } from '@/features/budgets/plan-toolbar'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const basis: BudgetRecommendationSnapshot['basis'] = {
  averageIncome: 6_115_000,
  savingsTarget: 30,
  spendCeiling: 4_280_500,
  incomeStart: '2026-01',
  incomeEnd: '2026-08',
  incomeMonthCount: 8,
}

function completed(id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'): CompletedBudgetRecommendation {
  return {
    id,
    requestId,
    completedAt: '2026-09-27T05:02:00.000Z',
    snapshot: makeBudgetSnapshot(),
    promptInput: null,
    report: makeBudgetReport(),
    evaluation: {
      allocated: 1_835_000,
      unallocatedReserve: 20_000,
      total: 1_855_000,
      overage: 0,
      savingsRate: 69.6,
      rows: [],
    },
  }
}

function data(overrides: Partial<BudgetRecommendationData> = {}): BudgetRecommendationData {
  return {
    month: '2026-10',
    latestJob: null,
    completed: null,
    worker: 'ready',
    availability: 'available',
    freshness: 'current',
    instructionsChanged: false,
    ...overrides,
  }
}

function request(): BudgetRequest {
  return createFrozenBudgetRecommendationRequest({
    month: '2026-10',
    notes: '가족 여행',
    plannedExpenses: [{ id: 'row-1', major: '식비', amount: 50_000, note: '생일 식사' }],
    draftAmounts: [{ major: '식비', amount: 600_000 }],
  }, requestId)
}

function controller(overrides: Partial<BudgetRecommendationController> = {}): BudgetRecommendationController {
  return {
    month: '2026-10',
    majors: ['식비', '<script>위험</script>'],
    basis,
    data: data(),
    recovering: false,
    submitting: false,
    active: false,
    networkError: null,
    hasAmbiguousRequest: false,
    notes: '',
    setNotes: vi.fn(),
    planned: [],
    composer: { major: '식비', amount: '', note: '' },
    setComposer: vi.fn(),
    plannedError: null,
    inputError: null,
    addPlannedExpense: vi.fn(),
    updatePlannedExpense: vi.fn(),
    removePlannedExpense: vi.fn(),
    generate: vi.fn().mockResolvedValue(true),
    recover: vi.fn().mockResolvedValue(undefined),
    promptJobId: null,
    promptView: null,
    promptLoading: false,
    promptError: null,
    loadPrompt: vi.fn().mockResolvedValue(undefined),
    clearPrompt: vi.fn(),
    ...overrides,
  }
}

describe('budget recommendation request ownership', () => {
  test.each([
    ['request_failed', '요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'],
    ['request_timeout', '요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.'],
  ])('keeps the exact frozen request for ambiguous %s failures', (code, message) => {
    const original = request()
    const classified = classifyBudgetRecommendationRequestError(new Error(code))

    expect(classified).toEqual({ code, message, ambiguous: true })
    expect(retryRequestAfterError(original, classified)).toBe(original)
    expect(Object.isFrozen(original)).toBe(true)
    expect(Object.isFrozen(original.plannedExpenses)).toBe(true)
    expect(Object.isFrozen(original.plannedExpenses[0])).toBe(true)
    expect(original.requestId).toBe(requestId)
  })

  test('drops the retry payload after a terminal safe error', () => {
    const classified = classifyBudgetRecommendationRequestError(new Error('invalid_input'))

    expect(classified).toEqual({
      code: 'invalid_input',
      message: '입력한 예정 지출과 예산 금액을 확인해 주세요.',
      ambiguous: false,
    })
    expect(retryRequestAfterError(request(), classified)).toBeNull()
  })

  test('maps arbitrary error text to the generic safe retry state', () => {
    expect(classifyBudgetRecommendationRequestError(new Error('private database detail'))).toEqual({
      code: 'request_failed',
      message: '요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      ambiguous: true,
    })
  })

  test('retains the previous result while a newer job is active and only acknowledges the exact request id', () => {
    const previous = data({ completed: { ...completed(), requestId: otherRequestId } })
    const unrelated = data({
      latestJob: { id: 'job-new', requestId: otherRequestId, status: 'queued', errorCode: null },
      completed: null,
    })
    const first = reconcileBudgetRecommendationData(previous, unrelated, requestId)

    expect(first.data.completed).toBe(previous.completed)
    expect(first.pendingRequestId).toBe(requestId)

    const exact = reconcileBudgetRecommendationData(first.data, data({
      latestJob: { id: 'job-new', requestId, status: 'queued', errorCode: null },
      completed: null,
    }), requestId)
    expect(exact.data.completed).toBe(previous.completed)
    expect(exact.pendingRequestId).toBeNull()
  })

  test('rejects stale request completions after abort, replacement, or month ownership changes', () => {
    const owner = new AbortController()
    const replacement = new AbortController()

    expect(ownsBudgetRecommendationRequest(owner, owner, '2026-10', '2026-10')).toBe(true)
    expect(ownsBudgetRecommendationRequest(replacement, owner, '2026-10', '2026-10')).toBe(false)
    expect(ownsBudgetRecommendationRequest(owner, owner, '2026-10', '2026-11')).toBe(false)
    owner.abort()
    expect(ownsBudgetRecommendationRequest(owner, owner, '2026-10', '2026-10')).toBe(false)
  })
})

describe('AI request dialog and toolbar states', () => {
  test('renders a separate bounded request form with canonical basis and escaped majors', () => {
    const html = renderToStaticMarkup(createElement(AiRequestDialog, {
      controller: controller({ promptJobId: 'failed-job' }),
      open: true,
      onClose: vi.fn(),
    }))

    expect(html).toMatch(/<dialog[^>]+aria-label="AI 예산 추천 요청"/)
    expect(html).toMatch(/<form[^>]*>/)
    expect(html).toContain('AI 예산 추천 요청 · 2026년 10월')
    expect(html).toContain('월평균 수입 6,115,000 · 목표 저축률 30% · 상한 4,280,500 · 지금 편집안을 참고합니다')
    expect(html).toMatch(/<textarea[^>]+aria-label="참고 메모"[^>]+maxlength="4000"/i)
    expect(html).toMatch(/aria-label="예정 지출 메모"[^>]+maxlength="200"/i)
    expect(html).toContain('&lt;script&gt;위험&lt;/script&gt;')
    expect(html).not.toContain('<script>위험</script>')
    expect(html).toContain('선택 · 최대 30개')
    expect(html).toContain('지난 요청의 프롬프트 보기')
    expect(html).toContain('Mac에서 1~2분 걸립니다. 완료되면 참고의 AI 줄이 채워지고, 기다리는 동안 편집은 계속할 수 있습니다.')
    expect(html).toMatch(/<button[^>]+type="submit"[^>]*>추천 요청<\/button>/)
    expect(html).not.toContain('변경사항 저장')
  })

  test('maps every toolbar lifecycle to the approved text and actions', () => {
    expect(budgetRecommendationToolbarModel({
      data: data(), basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    })).toMatchObject({
      status: { text: 'AI 추천 · 아직 없음 · 이번 달·다음 달에서만', tone: 'default' },
      requestLabel: 'AI 추천 받기', requestDisabled: false, showSummary: false,
    })

    expect(budgetRecommendationToolbarModel({
      data: data({ latestJob: { id: 'job', status: 'running', errorCode: null } }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    })).toMatchObject({
      status: { text: 'Mac에서 분석 중 · 보통 1~2분', tone: 'default' },
      requestLabel: '분석 중…', requestDisabled: true,
    })

    expect(budgetRecommendationToolbarModel({
      data: data({ latestJob: { id: 'job', status: 'queued', errorCode: null }, worker: 'offline' }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    }).status.text).toBe('Mac 연결 대기 · 연결되면 자동 시작')

    expect(budgetRecommendationToolbarModel({
      data: data({ completed: completed(), instructionsChanged: true }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    })).toMatchObject({
      status: { text: 'AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 안', tone: 'default' },
      requestLabel: '다시 추천', showSummary: true, instructionsChanged: true,
    })

    expect(budgetRecommendationToolbarModel({
      data: data({ completed: { ...completed(), evaluation: { ...completed().evaluation, overage: 120_000 } } }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    }).status).toEqual({ text: 'AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 초과 +120,000', tone: 'red' })
  })

  test.each([
    [{ targetDirty: true }, '저축 목표를 먼저 저장해 주세요'],
    [{ basis: { ...basis, averageIncome: 0 } }, '기준 수입이 있어야 시작할 수 있어요'],
    [{ data: data({ worker: 'not_registered', availability: 'setup_required' }) }, 'Mac AI 작업기가 연결되지 않았습니다'],
    [{ data: data({ worker: 'upgrade_required', availability: 'setup_required' }) }, 'Mac의 AI 작업기 업데이트가 필요합니다'],
  ])('renders the disabled toolbar reason %#', (override, text) => {
    const model = budgetRecommendationToolbarModel({
      data: data(), basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
      ...override,
    })
    expect(model.status.text).toBe(text)
    expect(model.requestDisabled).toBe(true)
  })

  test('renders stale, failed, network recovery, and old-instruction treatments', () => {
    const stale = budgetRecommendationToolbarModel({
      data: data({ completed: completed(), freshness: 'source_changed' }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    })
    expect(stale).toMatchObject({
      status: { text: '기록이 바뀌어 다시 추천이 필요합니다', tone: 'amber' },
      requestLabel: '다시 추천', aiFillDisabled: true,
    })

    const failed = budgetRecommendationToolbarModel({
      data: data({ latestJob: { id: 'failed-job', status: 'failed', errorCode: 'lease_expired' } }),
      basis, targetDirty: false, recovering: false, submitting: false,
      networkError: null, hasAmbiguousRequest: false,
    })
    expect(failed).toMatchObject({
      status: { text: 'Mac 연결이 끊겨 추천 작업이 중단됐어요.', tone: 'red' },
      requestLabel: '다시 시도', requestDisabled: false,
    })

    const network = budgetRecommendationToolbarModel({
      data: data(), basis, targetDirty: false, recovering: false, submitting: false,
      networkError: '요청 상태를 확인하지 못했어요.', hasAmbiguousRequest: true,
    })
    expect(network).toMatchObject({
      status: { text: '요청 상태를 확인하지 못했어요.', tone: 'red' },
      requestLabel: '같은 요청 다시 보내기', showRecover: true,
    })

    const html = renderToStaticMarkup(createElement(PlanToolbar, {
      aiFillDisabled: false,
      aiStatus: { text: '완료', tone: 'default' },
      aiActions: [],
      aiInstructionsChanged: true,
      onFillRequest: vi.fn(),
    }))
    expect(html).toContain('이전 지침으로 만든 추천')
    expect(html).toContain('plan-toolbar__instruction-marker')
  })

  test('keeps a historical completed summary visible while disabling new past-month requests', () => {
    const model = budgetRecommendationToolbarModel({
      data: data({ completed: completed(), availability: 'past_or_distant_month' }),
      basis,
      targetDirty: false,
      recovering: false,
      submitting: false,
      networkError: null,
      hasAmbiguousRequest: false,
    })

    expect(model.status).toEqual({
      text: 'AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 안',
      tone: 'default',
    })
    expect(model.showSummary).toBe(true)
    expect(model.requestDisabled).toBe(true)
  })
})

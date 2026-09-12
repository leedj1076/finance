'use client'

import type { ReactNode } from 'react'

import type { BudgetRecommendationData, BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'
import { BUDGET_RECOMMENDATION_JOB_ERROR_MESSAGES } from '@/features/budget-recommendations/use-recommendation'
import { formatWon } from '@/lib/finance'

import type { BudgetSource } from './plan-sources'

const FILL_LABELS: Record<BudgetSource, string> = {
  previousBudget: '지난달 예산',
  previousActual: '지난달 실적',
  average3: '3개월 평균',
  ai: 'AI 추천',
}

export type PlanToolbarAiStatus = {
  text: string
  tone: 'default' | 'amber' | 'red'
}

export type PlanToolbarAiAction = {
  label: string
  disabled?: boolean
  onClick: () => void
}

export type PlanToolbarProps = {
  aiFillDisabled: boolean
  aiStatus: PlanToolbarAiStatus
  aiActions: PlanToolbarAiAction[]
  aiInstructionsChanged?: boolean
  aiMobileStatusText?: string
  /** An anchored summary popover can place its own trigger in the toolbar. */
  aiPopover?: ReactNode
  fillDisabled?: Partial<Record<BudgetSource, boolean>>
  /**
   * Reports intent only. The form owns choice creation and must call
   * checkRecommendationForApply before it creates or applies AI choices.
   */
  onFillRequest: (source: BudgetSource) => void
}

export type BudgetRecommendationToolbarModel = {
  status: PlanToolbarAiStatus
  requestLabel: 'AI 추천 받기' | '다시 추천' | '다시 시도' | '같은 요청 다시 보내기' | '분석 중…'
  requestDisabled: boolean
  showSummary: boolean
  showRecover: boolean
  instructionsChanged: boolean
  aiFillDisabled: boolean
}

function completedAt(value: string) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('month')}월 ${part('day')}일 ${part('hour')}:${part('minute')}`
}

export function budgetRecommendationToolbarModel({
  data,
  basis,
  targetDirty,
  recovering,
  submitting,
  networkError,
  hasAmbiguousRequest,
}: {
  data: BudgetRecommendationData | null
  basis: BudgetRecommendationSnapshot['basis']
  targetDirty: boolean
  recovering: boolean
  submitting: boolean
  networkError: string | null
  hasAmbiguousRequest: boolean
}): BudgetRecommendationToolbarModel {
  const active = data?.latestJob?.status === 'queued' || data?.latestJob?.status === 'running'
  const stale = data?.freshness === 'source_changed' || data?.freshness === 'budgets_changed'
  const completed = data?.completed ?? null
  const requestLabel = active || submitting ? '분석 중…'
    : hasAmbiguousRequest ? '같은 요청 다시 보내기'
      : data?.latestJob?.status === 'failed' ? '다시 시도'
        : completed ? '다시 추천' : 'AI 추천 받기'
  const unavailable = targetDirty || basis.averageIncome <= 0 || recovering && !data
    || data?.availability !== 'available'
    || data?.worker === 'not_registered' || data?.worker === 'upgrade_required'
  const base = {
    requestLabel,
    requestDisabled: unavailable || active || submitting,
    showSummary: Boolean(completed),
    showRecover: Boolean(networkError),
    instructionsChanged: Boolean(completed && data?.instructionsChanged),
    aiFillDisabled: !completed || stale,
  } satisfies Omit<BudgetRecommendationToolbarModel, 'status'>

  if (networkError) return { ...base, status: { text: networkError, tone: 'red' } }
  if (targetDirty) return { ...base, status: { text: '저축 목표를 먼저 저장해 주세요', tone: 'amber' } }
  if (basis.averageIncome <= 0 || data?.availability === 'missing_income') {
    return { ...base, status: { text: '기준 수입이 있어야 시작할 수 있어요', tone: 'amber' } }
  }
  if (data?.worker === 'not_registered') {
    return { ...base, status: { text: 'Mac AI 작업기가 연결되지 않았습니다', tone: 'amber' } }
  }
  if (data?.worker === 'upgrade_required') {
    return { ...base, status: { text: 'Mac의 AI 작업기 업데이트가 필요합니다', tone: 'amber' } }
  }
  if (data?.availability === 'past_or_distant_month') {
    return { ...base, status: { text: 'AI 추천 · 아직 없음 · 이번 달·다음 달에서만', tone: 'default' } }
  }
  if (data?.availability === 'setup_required') {
    return { ...base, status: { text: 'Mac AI 작업기가 연결되지 않았습니다', tone: 'amber' } }
  }
  if (active) {
    if (data?.worker === 'offline') {
      return { ...base, status: { text: 'Mac 연결 대기 · 연결되면 자동 시작', tone: 'default' } }
    }
    return {
      ...base,
      status: {
        text: data?.latestJob?.status === 'running' ? 'Mac에서 분석 중 · 보통 1~2분' : '추천 대기 중',
        tone: 'default',
      },
    }
  }
  if (data?.latestJob?.status === 'failed') {
    return {
      ...base,
      status: {
        text: BUDGET_RECOMMENDATION_JOB_ERROR_MESSAGES[data.latestJob.errorCode ?? 'cli_failed']
          ?? BUDGET_RECOMMENDATION_JOB_ERROR_MESSAGES.cli_failed,
        tone: 'red',
      },
    }
  }
  if (completed && stale) {
    return {
      ...base,
      status: {
        text: data?.freshness === 'source_changed'
          ? '기록이 바뀌어 다시 추천이 필요합니다'
          : '예산이 바뀌어 다시 추천이 필요합니다',
        tone: 'amber',
      },
    }
  }
  if (completed) {
    const ceiling = completed.evaluation.overage > 0
      ? `상한 초과 +${formatWon(completed.evaluation.overage)}`
      : '상한 안'
    return {
      ...base,
      status: {
        text: `AI 추천 · ${completedAt(completed.completedAt)} · 합계 ${formatWon(completed.evaluation.total)} · ${ceiling}`,
        tone: completed.evaluation.overage > 0 ? 'red' : 'default',
      },
    }
  }
  return {
    ...base,
    status: {
      text: recovering && !data ? 'AI 추천 · 연결 상태 확인 중' : 'AI 추천 · 아직 없음 · 이번 달·다음 달에서만',
      tone: 'default',
    },
  }
}

export function PlanToolbar({
  aiFillDisabled,
  aiStatus,
  aiActions,
  aiInstructionsChanged = false,
  aiMobileStatusText,
  aiPopover,
  fillDisabled = {},
  onFillRequest,
}: PlanToolbarProps) {
  const fillEntries = Object.entries(FILL_LABELS) as [BudgetSource, string][]
  const fillButton = ([source, label]: [BudgetSource, string], mobile = false) => (
    <button
      className={`plan-toolbar__button t-caption ${mobile ? 'plan-toolbar__mobile-button' : ''}`}
      disabled={fillDisabled[source] || (source === 'ai' && aiFillDisabled)}
      key={source}
      onClick={() => onFillRequest(source)}
      type="button"
    >{label}</button>
  )

  return (
    <div className="plan-toolbar">
      <span className="plan-toolbar__label t-caption">전체 채우기</span>
      <div className="plan-toolbar__fills">
        {fillEntries.map(entry => fillButton(entry))}
      </div>
      <div className="plan-toolbar__ai t-caption">
        <span className={`plan-toolbar__status plan-toolbar__status--${aiStatus.tone}`}>
          {aiMobileStatusText ? <><span className="hidden sm:inline">{aiStatus.text}</span><span className="sm:hidden">{aiMobileStatusText}</span></> : aiStatus.text}
        </span>
        {aiInstructionsChanged && (
          <span className="plan-toolbar__instruction-marker inline-flex items-center gap-1 text-finance-violet">
            <svg aria-hidden="true" className="h-2 w-2" viewBox="0 0 8 8"><circle cx="4" cy="4" fill="currentColor" r="3" /></svg>
            이전 지침으로 만든 추천
          </span>
        )}
        {aiPopover}
        {aiActions.map(action => (
          <button
            className="plan-toolbar__action"
            disabled={action.disabled}
            key={action.label}
            onClick={action.onClick}
            type="button"
          >{action.label}</button>
        ))}
      </div>
      <details className="plan-toolbar__mobile-fill">
        <summary className="plan-toolbar__mobile-summary t-caption">
          <span>전체 채우기</span>
          <svg aria-hidden="true" viewBox="0 0 12 12">
            <path d="m2.5 4.5 3.5 3 3.5-3" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.4" />
          </svg>
        </summary>
        <div className="plan-toolbar__mobile-menu">
          {fillEntries.map(entry => fillButton(entry, true))}
        </div>
      </details>
    </div>
  )
}

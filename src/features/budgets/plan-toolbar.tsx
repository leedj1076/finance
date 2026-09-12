'use client'

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
  fillDisabled?: Partial<Record<BudgetSource, boolean>>
  /**
   * Reports intent only. The form owns choice creation and must call
   * checkRecommendationForApply before it creates or applies AI choices.
   */
  onFillRequest: (source: BudgetSource) => void
}

export function PlanToolbar({
  aiFillDisabled,
  aiStatus,
  aiActions,
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
        <span className={`plan-toolbar__status plan-toolbar__status--${aiStatus.tone}`}>{aiStatus.text}</span>
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

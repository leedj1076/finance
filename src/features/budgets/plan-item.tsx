'use client'

import type { ReactNode } from 'react'

import { formatWon } from '@/lib/finance'

import type { BudgetDraftRow } from './draft'
import { differenceCaption } from './plan-calculations'
import type { BudgetPlanRow, BudgetSource } from './plan-sources'

export type PlanRecommendation = {
  jobId: string
  amount: number
  completedAt: string
  reason?: string
  stale?: boolean
}

export type PlanItemProps = {
  row: BudgetPlanRow
  draft: BudgetDraftRow
  month: string
  period: 'past' | 'current' | 'future'
  currentRecommendation: PlanRecommendation | null
  savedRecommendation: Omit<PlanRecommendation, 'reason' | 'stale'> | null
  /** Task 5 can inject the complete evidence presentation here. */
  currentEvidence?: ReactNode
  /** Task 5 can inject evidence for a saved recommendation from an older job. */
  savedEvidence?: ReactNode
  onChoose: (choice: {
    major: string
    amount: number
    source: Exclude<BudgetSource, 'ai'>
    recommendationJobId: null
  }) => void
  /** Reports AI intent only; the form must verify the job before applying its amount. */
  onChooseAi: (request: { major: string; jobId: string }) => void
  onEdit: (major: string, amount: string) => void
  onOpenEvidence: (request: { major: string; jobId: string }) => void
}

type ReferenceOption = {
  source: BudgetSource
  label: string
  amount: number
  caption: string
  disabled: boolean
  stale?: boolean
}

function parsedAmount(value: string) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isSafeInteger(amount) ? amount : null
}

function monthName(month: string) {
  return `${Number(month.slice(5, 7))}월`
}

function joinedMonths(months: string[]) {
  return [...months].sort().map(month => Number(month.slice(5, 7))).join('·') + '월'
}

function completedDate(value: string) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(value))
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  return `${month}월 ${day}일`
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="plan-reference__check" viewBox="0 0 14 14">
      <path d="M2.5 7.5 5.5 10.5 11.5 4" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.6" />
    </svg>
  )
}

function averageCaption(row: BudgetPlanRow) {
  if (row.average3.amount <= 0 || row.average3.months.length === 0) return '지출 없음'
  const parts = [joinedMonths(row.average3.months)]
  if (row.group === 'irregular' && row.average3.spendMonths?.length) {
    parts.push(`${joinedMonths(row.average3.spendMonths)} ${row.average3.monthsWithSpend}회`)
  }
  if (row.average3.provisional) parts.push('잠정')
  return parts.join(' · ')
}

function inputCaption(
  draft: BudgetDraftRow,
  currentRecommendation: PlanRecommendation | null,
  savedRecommendation: PlanItemProps['savedRecommendation'],
) {
  const origin = draft.recommendationJobId === currentRecommendation?.jobId
    ? currentRecommendation
    : draft.recommendationJobId === savedRecommendation?.jobId
      ? savedRecommendation
      : null
  if (draft.recommendationJobId !== null && !origin) {
    return { text: '이 추천의 근거를 확인할 수 없습니다', tone: 'amber' as const }
  }
  if (draft.recommendationJobId !== null && origin) {
    const amount = parsedAmount(draft.amount)
    const older = origin.jobId !== currentRecommendation?.jobId
    const exactCurrentSelection = draft.source === 'ai'
      && !older
      && amount === origin.amount
    if (exactCurrentSelection) return null
    const date = older ? ` (${completedDate(origin.completedAt)})` : ''
    const adjusted = amount !== origin.amount ? '에서 조정' : ''
    return {
      text: `AI 추천${date} ${formatWon(origin.amount)}${adjusted}`,
      tone: 'violet' as const,
      evidenceJobId: older ? origin.jobId : null,
    }
  }
  if (draft.source !== null) return null
  return { text: '직접 입력', tone: 'muted' as const }
}

export function PlanItem({
  row,
  draft,
  period,
  currentRecommendation,
  savedRecommendation,
  currentEvidence,
  savedEvidence,
  onChoose,
  onChooseAi,
  onEdit,
  onOpenEvidence,
}: PlanItemProps) {
  const amount = parsedAmount(draft.amount)
  const remaining = amount === null ? null : amount - row.actual
  const previousActualCaption = differenceCaption(row.previousActual.amount, row.previousBudget)
  const partialPrefix = row.previousActual.partial
    ? `${monthName(row.previousActual.month)} ${Number(row.previousActual.partial.asOf.slice(8, 10))}일까지 · 진행 중 · `
    : ''
  const recommendationAvailable = Boolean(currentRecommendation && currentRecommendation.amount > 0)
  const options: ReferenceOption[] = [
    {
      source: 'previousBudget',
      label: '지난달 예산',
      amount: row.previousBudget,
      caption: row.previousBudget > 0 ? monthName(row.previousActual.month) : '자료 없음',
      disabled: row.previousBudget <= 0,
    },
    {
      source: 'previousActual',
      label: '지난달 실적',
      amount: row.previousActual.amount,
      caption: row.previousActual.amount > 0 ? `${partialPrefix}${previousActualCaption}` : '지출 없음',
      disabled: row.previousActual.amount <= 0,
    },
    {
      source: 'average3',
      label: '3개월 평균',
      amount: row.average3.amount,
      caption: averageCaption(row),
      disabled: row.average3.amount <= 0,
    },
    {
      source: 'ai',
      label: 'AI 추천',
      amount: currentRecommendation?.amount ?? 0,
      caption: currentRecommendation?.stale ? '다시 추천 필요' : recommendationAvailable ? '' : '추천 없음',
      disabled: !recommendationAvailable || Boolean(currentRecommendation?.stale),
      stale: currentRecommendation?.stale,
    },
  ]
  const caption = inputCaption(draft, currentRecommendation, savedRecommendation)
  const invalidId = `budget-plan-amount-error:${row.major}`

  return (
    <article className="plan-item">
      <div className="plan-item__topline">
        <div className="plan-item__major">
          <h3 className="t-body-strong">{row.major}</h3>
          {period === 'current' && amount !== null && (
            <p className={`plan-item__usage t-caption ${remaining !== null && remaining < 0 ? 'text-finance-red' : ''}`}>
              사용 {formatWon(row.actual)} · {remaining !== null && remaining < 0 ? '초과' : '남은'} {formatWon(Math.abs(remaining ?? 0))}
            </p>
          )}
        </div>
        <label className="plan-item__input-row t-caption">
          <span className="sr-only">{row.major} 예산</span>
          <input
            aria-describedby={amount === null ? invalidId : undefined}
            aria-invalid={amount === null || undefined}
            aria-label={`${row.major} 예산`}
            min={0}
            onChange={event => onEdit(row.major, event.target.value)}
            step={1}
            type="number"
            value={draft.amount}
          />
          <span>원</span>
        </label>
      </div>
      {amount === null && <p className="plan-item__caption t-caption text-finance-red" id={invalidId}>원 단위의 0 이상 정수를 입력해 주세요.</p>}
      {amount !== null && caption && (
        <p className={`plan-item__caption t-caption plan-item__caption--${caption.tone}`}>
          {caption.text}
          {'evidenceJobId' in caption && caption.evidenceJobId && (
            <> · {savedEvidence ?? <button onClick={() => onOpenEvidence({ major: row.major, jobId: caption.evidenceJobId! })} type="button">근거</button>}</>
          )}
        </p>
      )}

      <div className="plan-item__references">
        {options.map(option => {
          const selected = draft.source === option.source
            && (option.source !== 'ai' || draft.recommendationJobId === currentRecommendation?.jobId)
          const className = [
            'plan-reference__option',
            option.source === 'ai' ? 'plan-reference__option--ai' : '',
            selected ? 'plan-reference__option--selected' : '',
            option.disabled ? 'plan-reference__option--unavailable' : '',
            option.stale ? 'plan-reference__option--stale' : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              aria-pressed={selected}
              className={className}
              disabled={option.disabled}
              key={option.source}
              onClick={() => option.source === 'ai'
                ? currentRecommendation && onChooseAi({ major: row.major, jobId: currentRecommendation.jobId })
                : onChoose({
                  major: row.major,
                  amount: option.amount,
                  source: option.source,
                  recommendationJobId: null,
                })}
              type="button"
            >
              <span className="plan-reference__label t-caption">{option.label}</span>
              <span className="plan-reference__amount t-body">{formatWon(option.amount)}</span>
              <span className={`plan-reference__caption t-label ${option.source === 'previousActual' && row.previousActual.amount > row.previousBudget ? 'text-finance-red' : ''}`}>{option.caption}</span>
              <span>{selected && <CheckIcon />}</span>
            </button>
          )
        })}
        {currentRecommendation && currentRecommendation.amount > 0 && (
          <div className="plan-item__evidence t-label">
            <strong>AI 근거</strong>
            {currentRecommendation.reason && <span className="plan-item__reason">{currentRecommendation.reason}</span>}
            {currentEvidence ?? <button onClick={() => onOpenEvidence({ major: row.major, jobId: currentRecommendation.jobId })} type="button">더 보기</button>}
          </div>
        )}
      </div>
    </article>
  )
}

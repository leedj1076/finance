'use client'

import { useEffect, useRef } from 'react'

import { formatWon } from '@/lib/finance'

import type { BudgetDraft, BudgetDraftChoice, BudgetDraftRow } from './draft'
import { PlanItem, type PlanItemProps, type PlanRecommendation } from './plan-item'
import type { BudgetPlanRow, BudgetSource } from './plan-sources'

const GROUPS: { key: BudgetPlanRow['group']; label: string; note: string }[] = [
  { key: 'fixed', label: '고정비', note: '조절이 어려운 비용' },
  { key: 'variable', label: '변동비', note: '생활하면서 조절할 비용' },
  { key: 'irregular', label: '비정기', note: '여행·경조사 등 월 적립 예산' },
]

const SOURCE_LABELS: Record<BudgetSource, string> = {
  previousBudget: '지난달 예산',
  previousActual: '지난달 실적',
  average3: '3개월 평균',
  ai: 'AI 추천',
}

export type PlanFillConfirmation = {
  source: BudgetSource
  choices: BudgetDraftChoice[]
  overwritten: BudgetDraftRow[]
}

export type PlanFillNotice = {
  source: BudgetSource
  count: number
}

export type PlanListProps = {
  rows: BudgetPlanRow[]
  draft: BudgetDraft
  month: string
  period: PlanItemProps['period']
  recommendations: Record<string, PlanRecommendation | null | undefined>
  savedRecommendations: Record<string, PlanItemProps['savedRecommendation'] | undefined>
  evidence?: Record<string, PlanItemProps['currentEvidence']>
  savedEvidence?: Record<string, PlanItemProps['savedEvidence']>
  fillConfirmation?: PlanFillConfirmation | null
  fillNotice?: PlanFillNotice | null
  onChoose: PlanItemProps['onChoose']
  onChooseAi: PlanItemProps['onChooseAi']
  onEdit: PlanItemProps['onEdit']
  onOpenEvidence: PlanItemProps['onOpenEvidence']
  /** The form applies these already prepared choices; AI choices must be verified before reaching this callback. */
  onConfirmFillAll: (choices: BudgetDraftChoice[]) => void
  /** The form applies prepared choices after excluding the listed edited rows. */
  onKeepEdited: (choices: BudgetDraftChoice[], overwritten: BudgetDraftRow[]) => void
  onCancelFill: () => void
  onUndo: () => void
}

function displayDraftAmount(value: string) {
  const normalized = value.trim()
  return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized))
    ? formatWon(Number(normalized))
    : value
}

export function PlanList({
  rows,
  draft,
  month,
  period,
  recommendations,
  savedRecommendations,
  evidence = {},
  savedEvidence = {},
  fillConfirmation = null,
  fillNotice = null,
  onChoose,
  onChooseAi,
  onEdit,
  onOpenEvidence,
  onConfirmFillAll,
  onKeepEdited,
  onCancelFill,
  onUndo,
}: PlanListProps) {
  const confirmationRef = useRef<HTMLDialogElement>(null)
  const draftByMajor = new Map(draft.rows.map(row => [row.major, row]))
  const choiceByMajor = new Map(fillConfirmation?.choices.map(choice => [choice.major, choice]) ?? [])

  useEffect(() => {
    const confirmation = confirmationRef.current
    if (!confirmation) return
    if (fillConfirmation) {
      if (!confirmation.open) confirmation.showModal()
    } else if (confirmation.open) {
      confirmation.close()
    }
  }, [fillConfirmation])

  return (
    <section className="plan-list" aria-label="예산 편집 목록">
      <header className="plan-list__header">
        <span className="t-label">항목</span>
        <span className="t-label">예산 (원)</span>
        <span className="t-label">참고 <small>줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다</small></span>
      </header>

      {GROUPS.map(group => (
        <section className="plan-list__group" key={group.key}>
          <header className="plan-list__group-heading">
            <h2 className="t-body-strong">{group.label}</h2>
            <p className="t-caption">{group.note}</p>
          </header>
          {rows.filter(row => row.group === group.key).map(row => {
            const draftRow = draftByMajor.get(row.major)
            if (!draftRow) return null
            return (
              <PlanItem
                currentEvidence={evidence[row.major]}
                currentRecommendation={recommendations[row.major] ?? null}
                draft={draftRow}
                key={row.major}
                month={month}
                onChoose={onChoose}
                onChooseAi={onChooseAi}
                onEdit={onEdit}
                onOpenEvidence={onOpenEvidence}
                period={period}
                row={row}
                savedEvidence={savedEvidence[row.major]}
                savedRecommendation={savedRecommendations[row.major] ?? null}
              />
            )
          })}
        </section>
      ))}

      <dialog
        aria-label="전체 채우기 확인"
        className="plan-fill-confirmation"
        closedby="any"
        onCancel={event => {
          event.preventDefault()
          onCancelFill()
        }}
        onClick={event => {
          if (event.target === event.currentTarget) onCancelFill()
        }}
        onClose={() => {
          if (fillConfirmation) onCancelFill()
        }}
        ref={confirmationRef}
      >
        {fillConfirmation && <>
          <h2 className="t-body-strong">이미 고친 {fillConfirmation.overwritten.length}개 항목이 바뀝니다</h2>
          <ul className="plan-fill-confirmation__rows t-caption">
            {fillConfirmation.overwritten.map(row => {
              const choice = choiceByMajor.get(row.major)
              return choice ? <li key={row.major}>{row.major} {displayDraftAmount(row.amount)} → {formatWon(choice.amount)}</li> : null
            })}
          </ul>
          <div className="plan-fill-confirmation__actions">
            <button className="plan-fill-confirmation__primary t-caption" onClick={() => onConfirmFillAll(fillConfirmation.choices)} type="button">모두 채우기</button>
            <button className="plan-fill-confirmation__secondary t-caption" onClick={() => onKeepEdited(fillConfirmation.choices, fillConfirmation.overwritten)} type="button">고친 항목은 두기</button>
            <button className="plan-fill-confirmation__cancel t-caption" onClick={onCancelFill} type="button">취소</button>
          </div>
        </>}
      </dialog>

      {fillNotice && (
        <div className="plan-list__fill-notice t-body">
          <span><strong>{SOURCE_LABELS[fillNotice.source]}</strong>으로 {fillNotice.count}개 항목을 채웠습니다.</span>
          <button onClick={onUndo} type="button">실행 취소</button>
        </div>
      )}

      <footer className="plan-list__footer t-caption">
        <span>저장 전에는 바뀌지 않습니다.</span>
        {draft.undoRows && <button onClick={onUndo} type="button">최근 변경 실행 취소</button>}
      </footer>
    </section>
  )
}

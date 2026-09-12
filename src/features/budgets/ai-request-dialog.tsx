'use client'

import { useEffect, useRef } from 'react'

import { AiPromptViewer } from '@/features/ai-settings/prompt-viewer'
import {
  MAX_PLANNED_EXPENSE_NOTE,
  MAX_PLANNED_EXPENSES,
  MAX_RECOMMENDATION_NOTES,
  type BudgetRecommendationController,
} from '@/features/budget-recommendations/use-recommendation'
import { formatWon } from '@/lib/finance'

function monthTitle(month: string) {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`
}

export function AiRequestDialog({
  controller,
  open,
  onClose,
}: {
  controller: BudgetRecommendationController
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const currentComposerMajor = controller.majors.includes(controller.composer.major)
    ? controller.composer.major
    : controller.majors[0] ?? ''
  const plannedFull = controller.planned.length >= MAX_PLANNED_EXPENSES

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      aria-label="AI 예산 추천 요청"
      className="fixed inset-0 m-auto w-full max-w-4xl border border-finance-ink bg-background p-0 text-finance-ink shadow-xl backdrop:bg-finance-ink/20"
      closedby="any"
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <form
        className="max-h-[90vh] overflow-y-auto p-6"
        onSubmit={event => {
          event.preventDefault()
          void controller.generate().then(started => {
            if (started) onClose()
          })
        }}
      >
        <header className="border-b border-finance-ink pb-4">
          <h2 className="t-section">AI 예산 추천 요청 · {monthTitle(controller.month)}</h2>
          <p className="mt-2 t-caption text-finance-muted">
            월평균 수입 {formatWon(controller.basis.averageIncome)} · 목표 저축률 {controller.basis.savingsTarget}% · 상한 {formatWon(controller.basis.spendCeiling)} · 지금 편집안을 참고합니다
          </p>
        </header>

        <label className="mt-5 block t-body-strong">
          참고 메모 <span className="font-normal text-finance-muted">(선택)</span>
          <textarea
            aria-label="참고 메모"
            className="mt-2 min-h-28 w-full resize-y border border-finance-hairline bg-background p-3 t-body text-finance-ink outline-none focus:border-finance-violet"
            maxLength={MAX_RECOMMENDATION_NOTES}
            onChange={event => controller.setNotes(event.target.value)}
            placeholder="이번 달에 중요한 계획이나 우선순위를 적어 주세요."
            value={controller.notes}
          />
          <span className="mt-1 block text-right t-caption font-normal text-finance-muted">{controller.notes.length.toLocaleString('ko-KR')} / 4,000자</span>
        </label>

        <section className="mt-5" aria-labelledby={`ai-planned-expenses-${controller.month}`}>
          <h3 className="t-body-strong" id={`ai-planned-expenses-${controller.month}`}>예정 지출 <span className="font-normal text-finance-muted">(선택 · 최대 30개)</span></h3>
          <p className="mt-1 t-caption text-finance-muted">예정 지출은 이미 기록된 지출이나 반복 지출에 포함되지 않은 추가 금액입니다.</p>
          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(7rem,0.8fr)_minmax(8rem,0.8fr)_minmax(10rem,1.4fr)_auto]">
            <select
              aria-label="예정 지출 카테고리"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
              disabled={controller.majors.length === 0 || plannedFull}
              onChange={event => controller.setComposer({ ...controller.composer, major: event.target.value })}
              value={currentComposerMajor}
            >
              {controller.majors.length === 0 && <option value="">카테고리 없음</option>}
              {controller.majors.map(major => <option key={major} value={major}>{major}</option>)}
            </select>
            <input
              aria-label="예정 지출 금액"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 text-right t-body tabular-nums"
              inputMode="numeric"
              onChange={event => controller.setComposer({ ...controller.composer, amount: event.target.value })}
              placeholder="원"
              type="text"
              value={controller.composer.amount}
            />
            <input
              aria-label="예정 지출 메모"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
              maxLength={MAX_PLANNED_EXPENSE_NOTE}
              onChange={event => controller.setComposer({ ...controller.composer, note: event.target.value })}
              placeholder="예: 가족 생일 식사"
              type="text"
              value={controller.composer.note}
            />
            <button
              className="min-h-10 border border-finance-ink px-3 t-body-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={controller.majors.length === 0 || plannedFull}
              onClick={controller.addPlannedExpense}
              type="button"
            >추가</button>
          </div>
          {controller.majors.length === 0 && <p className="mt-2 t-caption text-finance-amber">사용할 수 있는 카테고리가 없어 예정 지출을 추가할 수 없어요.</p>}
          {controller.plannedError && <p className="mt-2 t-caption text-finance-red" role="alert">{controller.plannedError}</p>}

          {controller.planned.length > 0 && (
            <ul className="mt-3 space-y-2">
              {controller.planned.map((row, index) => (
                <li className="grid min-w-0 gap-2 border-t border-finance-hairline pt-2 sm:grid-cols-[minmax(7rem,0.8fr)_minmax(8rem,0.8fr)_minmax(10rem,1.4fr)_auto]" key={row.id}>
                  <select
                    aria-label={`예정 지출 ${index + 1} 카테고리`}
                    className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
                    onChange={event => controller.updatePlannedExpense(row.id, { major: event.target.value })}
                    value={row.major}
                  >
                    {controller.majors.map(major => <option key={major} value={major}>{major}</option>)}
                  </select>
                  <input
                    aria-label={`예정 지출 ${index + 1} 금액`}
                    className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 text-right t-body tabular-nums"
                    inputMode="numeric"
                    onChange={event => controller.updatePlannedExpense(row.id, { amount: event.target.value })}
                    type="text"
                    value={row.amount}
                  />
                  <input
                    aria-label={`예정 지출 ${index + 1} 메모`}
                    className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
                    maxLength={MAX_PLANNED_EXPENSE_NOTE}
                    onChange={event => controller.updatePlannedExpense(row.id, { note: event.target.value })}
                    type="text"
                    value={row.note}
                  />
                  <button className="min-h-10 border border-finance-hairline px-3 t-body-strong text-finance-red" onClick={() => controller.removePlannedExpense(row.id)} type="button">삭제</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-5 space-y-2" aria-live="polite">
          {controller.inputError && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert">{controller.inputError}</p>}
          {controller.networkError && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert">{controller.networkError}</p>}
          {controller.promptError && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert">{controller.promptError}</p>}
        </div>

        {controller.promptView && <div className="mt-5 min-w-0"><AiPromptViewer view={controller.promptView} /></div>}

        <footer className="mt-6 border-t border-finance-hairline pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {controller.promptJobId && (
              <button
                className="t-caption font-semibold text-finance-blue disabled:text-finance-faint"
                disabled={controller.promptLoading}
                onClick={() => void controller.loadPrompt()}
                type="button"
              >{controller.promptLoading ? '프롬프트 확인 중…' : '지난 요청의 프롬프트 보기'}</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button className="min-h-9 px-3 t-body-strong text-finance-muted" onClick={onClose} type="button">취소</button>
              <button className="min-h-9 border border-finance-ink bg-finance-ink px-4 t-body-strong text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={controller.submitting || controller.active} type="submit">
                {controller.hasAmbiguousRequest ? '같은 요청 다시 보내기' : controller.submitting ? '추천 요청 중…' : '추천 요청'}
              </button>
            </div>
          </div>
          <p className="mt-3 t-caption text-finance-muted">Mac에서 1~2분 걸립니다. 완료되면 참고의 AI 줄이 채워지고, 기다리는 동안 편집은 계속할 수 있습니다.</p>
        </footer>
      </form>
    </dialog>
  )
}

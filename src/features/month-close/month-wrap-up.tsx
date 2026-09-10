import Link from 'next/link'
import type { ReactNode } from 'react'

import type { MonthCloseSummary } from './state'
import { wrapUpSteps } from './wrap-up'

/**
 * Stacked above the close control: the clean-up list only. Closing itself
 * stays in MonthCloseControl, so the two never show the same button twice.
 */
export function MonthWrapUp({ summary, recurringForm }: { summary: MonthCloseSummary; recurringForm: ReactNode }) {
  const model = wrapUpSteps(summary)
  if (!model.visible) return null
  const monthLabel = `${Number(summary.month.slice(5, 7))}월`
  const nextMonth = `${Number(summary.month.slice(5, 7)) % 12 + 1}월`
  const reviewMonth = summary.month.slice(5, 7) === '12'
    ? `${Number(summary.month.slice(0, 4)) + 1}-01`
    : `${summary.month.slice(0, 4)}-${String(Number(summary.month.slice(5, 7)) + 1).padStart(2, '0')}`

  return (
    <section aria-label={`${monthLabel} 마무리`} className="mt-4 border-t border-finance-ink border-b border-finance-hairline py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="t-body-strong text-finance-ink">{monthLabel} 마무리</h2>
        <span className="t-caption text-finance-muted">{model.allClear ? '정리 완료' : `정리 ${model.doneCount} / ${model.steps.length}`}</span>
        <span className="ml-auto t-caption text-finance-muted">{model.allClear ? '아래에서 마감합니다' : '정리가 끝나면 아래에서 마감합니다'}</span>
      </div>
      <ul className="mt-2">
        {model.allClear ? (
          <li className="flex items-center gap-3 py-2 t-body text-finance-muted"><span aria-hidden className="h-2 w-2 bg-finance-green" />정리 완료 · 아래에서 마감</li>
        ) : model.steps.map((step) => (
          <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 border-t border-finance-track py-2 first:border-t-0" key={step.key}>
            <span aria-hidden className={`h-2 w-2 justify-self-center ${step.done ? 'bg-finance-green' : 'bg-finance-amber'}`} />
            <div className="t-body">
              <span className={step.done ? 'text-finance-muted line-through decoration-finance-faint' : 'font-semibold text-finance-ink'}>{step.done && step.key === 'recurring' ? '정기거래 반영 완료' : step.label}</span>
              <span className="ml-2 t-caption text-finance-muted">{step.done ? '0건' : `${step.count}건`}</span>
              {!step.done && step.note && <span className="ml-2 t-caption text-finance-muted">· {step.note}</span>}
            </div>
            {step.done ? <span className="t-caption text-finance-faint">완료</span>
              : step.href ? <Link className="t-caption font-semibold text-finance-blue" href={step.href}>{step.key === 'inbox' ? '검토하기 →' : '분류하기 →'}</Link>
              : recurringForm}
          </li>
        ))}
        <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 border-t border-finance-track py-2">
          <span aria-hidden className="h-2 w-2 justify-self-center bg-finance-faint" />
          <div className="t-body text-finance-faint">AI 진단 · {nextMonth} 예산 만들기<span className="ml-2 t-caption">선택 · 마감 뒤에</span></div>
          <span className="flex gap-3 t-caption font-medium text-finance-faint">
            <Link className="hover:text-finance-blue" href={`/ledger?month=${summary.month}&tab=ai`}>진단 →</Link>
            <Link className="hover:text-finance-blue" href={`/budgets?month=${reviewMonth}`}>예산 →</Link>
          </span>
        </li>
      </ul>
    </section>
  )
}

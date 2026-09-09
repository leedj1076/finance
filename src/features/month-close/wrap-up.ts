import type { MonthCloseSummary } from './state'

export type WrapUpStepKey = 'inbox' | 'recurring' | 'unclassified'

export type WrapUpStep = {
  key: WrapUpStepKey
  label: string
  count: number
  done: boolean
  /** null: the action lives on the same page (recurring apply form). */
  href: string | null
  note?: string
}

export type WrapUpModel = {
  visible: boolean
  steps: WrapUpStep[]
  doneCount: number
  allClear: boolean
}

/**
 * The checklist only exists for a month that has ended and was never closed.
 * A closed month has nothing to clean up here, and a month needing review
 * goes straight back to the close control below the list.
 */
export function wrapUpSteps(summary: MonthCloseSummary): WrapUpModel {
  const steps: WrapUpStep[] = [
    { key: 'inbox', label: '가져오기 대기', count: summary.pendingCount, done: summary.pendingCount === 0, href: '/inbox' },
    { key: 'recurring', label: '정기거래 미반영', count: summary.unpostedRecurringCount, done: summary.unpostedRecurringCount === 0, href: null },
    {
      key: 'unclassified', label: '미분류 거래', count: summary.unclassifiedCount, done: summary.unclassifiedCount === 0,
      href: '/inbox?tab=unclassified', note: '분류하면 통계의 카테고리 표에 들어갑니다',
    },
  ]
  const doneCount = steps.filter((step) => step.done).length
  return {
    visible: summary.state === 'open' && summary.closable,
    steps,
    doneCount,
    allClear: doneCount === steps.length,
  }
}

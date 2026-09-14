import Link from 'next/link'
import type { ReactNode } from 'react'

import { SubmitButton } from '@/components/submit-button'

type MonthNavProps = {
  action: string
  label: string
  month: string
  previousHref: string
  nextHref: string
  max?: string
  hiddenFields?: ReactNode
}

/**
 * Three pages hand-rolled this control and drifted apart: the ledger's sat at
 * 32px in a single ink-bordered block, assets and budgets at 34px as separate
 * hairline boxes. One segmented control at the 34px token height now.
 */
export function MonthNav({ action, label, month, previousHref, nextHref, max, hiddenFields }: MonthNavProps) {
  return (
    <div className="flex items-center border border-finance-ink">
      <Link
        aria-label="이전 달"
        className="grid h-[34px] w-[34px] place-items-center border-r border-finance-ink t-body hover:bg-finance-track"
        href={previousHref}
      >
        ←
      </Link>
      <form action={action} className="flex h-[34px] items-center">
        {hiddenFields}
        <input
          aria-label={label}
          className="h-[34px] w-[124px] border-0 bg-white px-2 text-center t-body-strong text-finance-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-finance-blue"
          defaultValue={month}
          key={month}
          max={max}
          name="month"
          type="month"
        />
        <SubmitButton
          className="h-[34px] border-l border-finance-ink bg-finance-ink px-3 t-body-strong text-white hover:bg-finance-blue disabled:opacity-40"
          pendingLabel="불러오는 중…"
          type="submit"
        >
          보기
        </SubmitButton>
      </form>
      <Link
        aria-label="다음 달"
        className="grid h-[34px] w-[34px] place-items-center border-l border-finance-ink t-body hover:bg-finance-track"
        href={nextHref}
      >
        →
      </Link>
    </div>
  )
}

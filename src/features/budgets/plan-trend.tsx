'use client'

import { Fragment, useRef } from 'react'

import { CellPopoverPortal, useSharedCellPopover } from '@/features/analytics/cell-transaction-popover'
import { CellTransactionTooltip } from '@/features/analytics/cell-transaction-tooltip'
import { cellCacheKey, type CellRequest } from '@/features/analytics/cell-transactions'
import { formatWon } from '@/lib/finance'

import type { BudgetPlanRow } from './plan-sources'

const HOVER_DELAY = 180

function monthNumber(month: string) {
  return Number(month.slice(5, 7))
}

export function PlanTrend({
  major,
  trend,
  previousActualMonth,
}: {
  major: string
  trend: BudgetPlanRow['trend']
  previousActualMonth: string
}) {
  const { cells, popover } = useSharedCellPopover()
  const { data, key, open: load } = cells
  // A cell closed by click must not reopen while the pointer is still on it.
  const suppressed = useRef<string | null>(null)

  function cellRequest(entry: BudgetPlanRow['trend'][number]): CellRequest {
    return {
      flow: 'expense',
      year: Number(entry.month.slice(0, 4)),
      month: monthNumber(entry.month),
      major,
      sub: null,
      closed: entry.closed,
      revision: entry.revision,
    }
  }

  if (trend.length === 0) {
    return (
      <div className="plan-trend">
        <span className="plan-trend__label t-label">추이</span>
        <span className="plan-trend__empty t-caption">기록 없음</span>
      </div>
    )
  }

  // Every row shares one request instance, so only the row holding the open cell draws the popover.
  const keys = trend.map(entry => cellCacheKey(cellRequest(entry)))
  const active = key !== null && keys.includes(key) ? key : null

  return (
    <div className="plan-trend">
      <span className="plan-trend__label t-label">추이</span>
      {trend.map((entry, index) => {
        const number = monthNumber(entry.month)
        const cellKey = keys[index]
        const label = entry.month === previousActualMonth ? `${number}월 · 지난달` : `${number}월`
        const text = entry.amount === 0 ? (entry.closed ? '0' : '–') : formatWon(entry.amount)
        return (
          <Fragment key={entry.month}>
            {index > 0 && <span aria-hidden="true" className="plan-trend__separator t-caption">·</span>}
            <button
              aria-describedby={active === cellKey ? popover.id : undefined}
              aria-label={`${major} ${number}월 ${formatWon(entry.amount)}원, 거래 목록 보기`}
              className={`plan-trend__cell ${entry.closed ? '' : 'plan-trend__cell--provisional'}`}
              onBlur={popover.scheduleHide}
              onClick={event => {
                if (key === cellKey) { suppressed.current = cellKey; popover.close(); return }
                suppressed.current = null
                popover.open(cellKey, { x: event.clientX, y: event.clientY }, event.currentTarget)
                load(cellRequest(entry), 0)
              }}
              onFocus={event => {
                // Escape inside the popover hands focus back here. That is housekeeping, not a
                // request to reopen what was just closed.
                if (popover.isRestoringFocus()) return
                // A pointer click focuses the button before it clicks it, and the click would then
                // read the popover as already open and toggle it shut. Spec section 4 opens on
                // keyboard focus only, which is what :focus-visible selects.
                if (!event.currentTarget.matches(':focus-visible')) return
                const bounds = event.currentTarget.getBoundingClientRect()
                popover.open(cellKey, { x: bounds.left + bounds.width / 2, y: bounds.bottom }, event.currentTarget)
                load(cellRequest(entry), 0)
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') { popover.close(); return }
                // The popover is portaled to the end of the document, so Tab would otherwise walk
                // past its ledger link to the next cell.
                if (event.key === 'Tab' && !event.shiftKey && active === cellKey && popover.focusContent()) {
                  event.preventDefault()
                }
              }}
              onMouseEnter={event => {
                popover.cancelHide()
                if (suppressed.current === cellKey) return
                popover.open(cellKey, { x: event.clientX, y: event.clientY }, event.currentTarget)
                load(cellRequest(entry), HOVER_DELAY)
              }}
              onMouseLeave={() => { suppressed.current = null; popover.scheduleHide() }}
              onMouseMove={event => popover.move(cellKey, { x: event.clientX, y: event.clientY })}
              type="button"
            >
              <span className="plan-trend__month t-label">{label}</span>
              <span className="plan-trend__amount t-body">{text}</span>
            </button>
          </Fragment>
        )
      })}
      {active && data && popover.anchor && (
        <CellPopoverPortal popover={popover}>
          <CellTransactionTooltip
            data={data}
            ledgerHref={`/ledger?month=${data.ym}&tab=list&flow=expense&major=${encodeURIComponent(major)}`}
            major={major}
            month={Number(data.ym.slice(5, 7))}
            sub={null}
          />
        </CellPopoverPortal>
      )}
    </div>
  )
}

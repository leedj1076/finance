'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CellTransactionTooltip } from '@/features/analytics/cell-transaction-tooltip'
import { useCellTransactions, cellCacheKey } from '@/features/analytics/cell-transactions'
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
  const { data, key, stale, open, close } = useCellTransactions()
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  // A cell closed by click must not reopen while the pointer is still on it.
  const suppressed = useRef<string | null>(null)

  if (trend.length === 0) {
    return <div className="plan-trend"><span className="plan-trend__empty t-caption">기록 없음</span></div>
  }

  function cellRequest(entry: BudgetPlanRow['trend'][number]) {
    return {
      flow: 'expense' as const,
      year: Number(entry.month.slice(0, 4)),
      month: monthNumber(entry.month),
      major,
      sub: null,
    }
  }

  function request(entry: BudgetPlanRow['trend'][number], delay: number) {
    open({ ...cellRequest(entry), closed: entry.closed, revision: entry.revision }, delay)
  }

  return (
    <div className="plan-trend">
      {stale && <p className="plan-trend__stale t-caption">마감 내역이 바뀌었습니다. 새로고침해 주세요.</p>}
      {trend.map(entry => {
        const number = monthNumber(entry.month)
        const cellKey = cellCacheKey(cellRequest(entry))
        const label = entry.month === previousActualMonth ? `${number}월 · 지난달` : `${number}월`
        const text = entry.amount === 0 ? (entry.closed ? '0' : '–') : formatWon(entry.amount)
        return (
          <button
            aria-label={`${major} ${number}월 ${formatWon(entry.amount)}원, 거래 목록 보기`}
            className={`plan-trend__cell ${entry.closed ? '' : 'plan-trend__cell--provisional'}`}
            key={entry.month}
            onBlur={close}
            onClick={event => {
              if (key === cellKey) { suppressed.current = cellKey; close(); return }
              suppressed.current = null
              setAnchor({ x: event.clientX, y: event.clientY })
              request(entry, 0)
            }}
            onFocus={event => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setAnchor({ x: bounds.left + bounds.width / 2, y: bounds.bottom })
              request(entry, 0)
            }}
            onKeyDown={event => { if (event.key === 'Escape') close() }}
            onMouseEnter={event => {
              if (suppressed.current === cellKey) return
              setAnchor({ x: event.clientX, y: event.clientY })
              request(entry, HOVER_DELAY)
            }}
            onMouseLeave={() => { suppressed.current = null; close() }}
            onMouseMove={event => { if (key === cellKey) setAnchor({ x: event.clientX, y: event.clientY }) }}
            type="button"
          >
            <span className="plan-trend__month t-label">{label}</span>
            <span className="plan-trend__amount t-body">{text}</span>
          </button>
        )
      })}
      {data && anchor && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto bg-finance-ink p-3 text-white shadow-xl"
          role="tooltip"
          style={{
            left: Math.min(anchor.x + 12, window.innerWidth - 368),
            top: Math.min(anchor.y + 12, window.innerHeight - 16),
          }}
        >
          <CellTransactionTooltip
            data={data}
            ledgerHref={`/ledger?month=${data.ym}&tab=list&flow=expense&major=${encodeURIComponent(major)}`}
            major={major}
            month={Number(data.ym.slice(5, 7))}
            sub={null}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}

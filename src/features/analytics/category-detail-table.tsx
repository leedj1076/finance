'use client'

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { formatWon } from '@/lib/finance'

import {
  categoryDetailMonthlyAverage,
  toggleCategoryDetailCell,
} from './category-detail-calculations'
import {
  type CategoryDetailFlow,
  type CategoryDetails,
  type CellTransactionResult,
} from './category-detail'

const FLOW_LABELS: Record<CategoryDetailFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

type TooltipState = {
  key: string
  major: string
  sub: string
  month: number
  anchor: DOMRect
  data: CellTransactionResult
}

function cellKey(flow: CategoryDetailFlow, major: string, sub: string, month: number) {
  return `${flow}\u0000${major}\u0000${sub}\u0000${month}`
}

export function CategoryDetailTable({
  year,
  details,
}: {
  year: number
  details: CategoryDetails
}) {
  const [flow, setFlow] = useState<CategoryDetailFlow>('expense')
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const cache = useRef(new Map<string, CellTransactionResult>())
  const activeHover = useRef<string | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const focusedCell = useRef<string | null>(null)
  const generatedId = useId()
  const tooltipId = `category-cell-tooltip-${generatedId.replace(/:/g, '')}`
  const detail = details[flow]

  const computed = useMemo(() => {
    const grandMonths = Array<number>(12).fill(0)
    let grandTotal = 0
    let grandCurrent = 0
    const groups = detail.groups.map((group) => {
      const groupMonths = Array<number>(12).fill(0)
      let groupTotal = 0
      let groupCurrent = 0
      const subs = group.subs.map((sub) => {
        let total = 0
        let current = 0
        const cells = detail.months.map((month) => {
          const amount = sub.months[month - 1] ?? 0
          const key = cellKey(flow, group.major, sub.sub, month)
          const isExcluded = excluded.has(key)
          if (!isExcluded) {
            total += amount
            groupMonths[month - 1] += amount
            if (month === detail.currentMonth) current += amount
          }
          return { month, amount, key, excluded: isExcluded }
        })
        groupTotal += total
        groupCurrent += current
        return { ...sub, cells, total, current }
      })
      grandTotal += groupTotal
      grandCurrent += groupCurrent
      detail.months.forEach((month) => { grandMonths[month - 1] += groupMonths[month - 1] })
      return { ...group, subs, months: groupMonths, total: groupTotal, current: groupCurrent }
    })
    return { groups, months: grandMonths, total: grandTotal, current: grandCurrent }
  }, [detail, excluded, flow])

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element || !tooltip) return
    const margin = 8
    const gap = 6
    const bounds = element.getBoundingClientRect()
    let left = Math.min(tooltip.anchor.left, window.innerWidth - bounds.width - margin)
    left = Math.max(margin, left)
    let top = tooltip.anchor.bottom + gap
    if (top + bounds.height > window.innerHeight - margin) {
      top = Math.max(margin, tooltip.anchor.top - bounds.height - gap)
    }
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  }, [tooltip])

  function clearTimer(timer: typeof showTimer) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function closeTooltip() {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    activeHover.current = null
    setTooltip(null)
  }

  function scheduleHide(force = false) {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    if (!force && focusedCell.current === activeHover.current) return
    hideTimer.current = setTimeout(() => {
      activeHover.current = null
      setTooltip(null)
    }, 150)
  }

  function selectFlow(nextFlow: CategoryDetailFlow) {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    activeHover.current = null
    focusedCell.current = null
    setTooltip(null)
    setExcluded(new Set())
    setFlow(nextFlow)
  }

  function toggleCell(key: string) {
    setExcluded((current) => toggleCategoryDetailCell(current, key))
  }

  function requestCellTransactions(
    target: HTMLButtonElement,
    major: string,
    sub: string,
    month: number,
    delay: number,
  ) {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    const key = cellKey(flow, major, sub, month)
    activeHover.current = key
    showTimer.current = setTimeout(async () => {
      const cached = cache.current.get(key)
      if (cached) {
        if (activeHover.current === key) {
          setTooltip({ key, major, sub, month, anchor: target.getBoundingClientRect(), data: cached })
        }
        return
      }

      const params = new URLSearchParams({
        flow,
        year: String(year),
        month: String(month),
        major,
        sub,
      })
      try {
        const response = await fetch(`/api/cell-tx?${params}`)
        if (!response.ok) return
        const data = await response.json() as CellTransactionResult
        cache.current.set(key, data)
        if (activeHover.current === key) {
          setTooltip({ key, major, sub, month, anchor: target.getBoundingClientRect(), data })
        }
      } catch {
        // The detail table remains usable when a tooltip request is interrupted.
      }
    }, delay)
  }

  function focusCell(
    target: HTMLButtonElement,
    major: string,
    sub: string,
    month: number,
  ) {
    const key = cellKey(flow, major, sub, month)
    focusedCell.current = key
    requestCellTransactions(target, major, sub, month, 0)
  }

  function blurCell() {
    focusedCell.current = null
    scheduleHide(true)
  }

  function toggleCellDetails(
    target: HTMLButtonElement,
    major: string,
    sub: string,
    month: number,
  ) {
    const key = cellKey(flow, major, sub, month)
    if (tooltip?.key === key) {
      closeTooltip()
      return
    }
    requestCellTransactions(target, major, sub, month, 0)
  }

  if (detail.months.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <CategoryDetailHeader flow={flow} onSelectFlow={selectFlow} />
        <p className="py-12 text-center text-sm text-zinc-500">표시할 거래가 없습니다.</p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-4">
        <CategoryDetailHeader flow={flow} onSelectFlow={selectFlow} />
        <p className="mt-2 text-xs text-zinc-500">
          금액 셀에 마우스를 올리거나 키보드로 이동하면 내역을 볼 수 있습니다. 터치에서는 내역 버튼을 누르세요. 금액을 클릭하면 합계와 월평균에서 제외됩니다.
        </p>
      </div>
      <div className="overflow-x-auto border-t border-zinc-200">
        <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="sticky left-0 z-20 min-w-28 border-r border-zinc-200 bg-zinc-50 px-4 py-3 font-medium">대분류</th>
              <th className="sticky left-28 z-20 min-w-28 border-r border-zinc-200 bg-zinc-50 px-3 py-3 font-medium">소분류</th>
              <th className="px-3 py-3 text-right font-medium">합계</th>
              <th className="px-3 py-3 text-right font-medium">월평균</th>
              {detail.months.map((month) => (
                <th
                  className={`min-w-20 px-3 py-3 text-right font-medium ${month === detail.currentMonth ? 'bg-amber-50 text-amber-800' : ''}`}
                  key={month}
                >
                  {month}월
                  {month === detail.currentMonth && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px]">진행</span>}
                </th>
              ))}
            </tr>
          </thead>
          {computed.groups.map((group) => (
            <tbody className="divide-y divide-zinc-100" key={group.major}>
                {group.subs.map((sub, subIndex) => (
                  <tr className="hover:bg-zinc-50/60" key={`${group.major}-${sub.sub}`}>
                    {subIndex === 0 && (
                      <th
                        className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-4 py-3 align-top font-semibold text-zinc-900"
                        rowSpan={group.subs.length + 1}
                        scope="rowgroup"
                      >
                        {group.major}
                      </th>
                    )}
                    <th className="sticky left-28 z-10 border-r border-zinc-200 bg-white px-3 py-3 font-normal text-zinc-700" scope="row">{sub.sub}</th>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-zinc-900">{formatWon(sub.total)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">{formatWon(categoryDetailMonthlyAverage(sub.total, sub.current, detail.divisor))}</td>
                    {sub.cells.map((cell) => (
                      <td
                        className={`p-0 text-right tabular-nums ${cell.month === detail.currentMonth ? 'bg-amber-50/60' : ''}`}
                        key={cell.month}
                      >
                        {cell.amount > 0 ? (
                          <div className="flex min-h-14 flex-col items-end justify-center">
                            <button
                              aria-describedby={tooltip?.key === cell.key ? tooltipId : undefined}
                              aria-label={`${group.major} ${sub.sub} ${cell.month}월 ${formatWon(cell.amount)}원, ${cell.excluded ? '합계에 다시 포함' : '합계에서 제외'}`}
                              aria-pressed={cell.excluded}
                              className={`w-full px-3 pt-2 text-right hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600 ${cell.excluded ? 'bg-zinc-100 text-zinc-400 line-through' : 'text-zinc-700'}`}
                              onBlur={blurCell}
                              onClick={() => toggleCell(cell.key)}
                              onFocus={(event) => focusCell(event.currentTarget, group.major, sub.sub, cell.month)}
                              onKeyDown={(event) => { if (event.key === 'Escape') closeTooltip() }}
                              onMouseEnter={(event) => {
                                if (!focusedCell.current) requestCellTransactions(event.currentTarget, group.major, sub.sub, cell.month, 180)
                              }}
                              onMouseLeave={() => scheduleHide()}
                              title={cell.excluded ? '합계에 다시 포함' : '합계에서 제외'}
                              type="button"
                            >
                              {formatWon(cell.amount)}
                            </button>
                            <button
                              aria-controls={tooltipId}
                              aria-describedby={tooltip?.key === cell.key ? tooltipId : undefined}
                              aria-expanded={tooltip?.key === cell.key}
                              aria-label={`${group.major} ${sub.sub} ${cell.month}월 거래 내역 ${tooltip?.key === cell.key ? '닫기' : '보기'}`}
                              className="px-3 pb-1.5 pt-0.5 text-[10px] font-medium text-zinc-400 underline decoration-zinc-300 underline-offset-2 hover:text-emerald-700 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-emerald-600"
                              onBlur={() => { if (tooltip?.key === cell.key) scheduleHide(true) }}
                              onClick={(event) => toggleCellDetails(event.currentTarget, group.major, sub.sub, cell.month)}
                              onKeyDown={(event) => { if (event.key === 'Escape') closeTooltip() }}
                              type="button"
                            >
                              {tooltip?.key === cell.key ? '닫기' : '내역'}
                            </button>
                          </div>
                        ) : (
                          <span className="block px-3 py-3 text-zinc-300">0</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-zinc-50/80 font-medium text-zinc-700">
                  <th className="sticky left-28 z-10 border-r border-zinc-200 bg-zinc-50/95 px-3 py-2" scope="row">소계</th>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatWon(group.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatWon(categoryDetailMonthlyAverage(group.total, group.current, detail.divisor))}</td>
                  {detail.months.map((month) => (
                    <td className={`px-3 py-2 text-right tabular-nums ${month === detail.currentMonth ? 'bg-amber-50/60' : ''}`} key={month}>
                      {formatWon(group.months[month - 1])}
                    </td>
                  ))}
                </tr>
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-zinc-300 bg-zinc-100 font-semibold text-zinc-950">
              <td className="sticky left-0 z-10 border-r border-zinc-200 bg-zinc-100 px-4 py-3" />
              <th className="sticky left-28 z-10 border-r border-zinc-200 bg-zinc-100 px-3 py-3" scope="row">합계</th>
              <td className="px-3 py-3 text-right tabular-nums">{formatWon(computed.total)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatWon(categoryDetailMonthlyAverage(computed.total, computed.current, detail.divisor))}</td>
              {detail.months.map((month) => (
                <td className={`px-3 py-3 text-right tabular-nums ${month === detail.currentMonth ? 'bg-amber-100/70' : ''}`} key={month}>
                  {formatWon(computed.months[month - 1])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-xl"
          key={tooltip.key}
          id={tooltipId}
          onMouseEnter={() => clearTimer(hideTimer)}
          onMouseLeave={() => scheduleHide()}
          ref={tooltipRef}
          role="tooltip"
          style={{ left: 8, top: 8, visibility: 'hidden' }}
        >
          <div className="border-b border-zinc-100 pb-2">
            <p className="font-semibold text-zinc-900">{tooltip.major} › {tooltip.sub} · {tooltip.month}월</p>
            <p className="mt-0.5 text-xs text-zinc-500">{tooltip.data.items.length}건 · {formatWon(tooltip.data.total)}원</p>
          </div>
          {tooltip.data.items.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">내역 없음</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {tooltip.data.items.slice(0, 15).map((item, index) => (
                <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 py-2 text-xs" key={`${item.date}-${item.name}-${item.amount}-${index}`}>
                  <span className="text-zinc-400">{item.date.slice(5).replace('-', '/')}</span>
                  <span className="min-w-0 truncate text-zinc-700">
                    {item.name}
                    {item.acct && <span className="ml-1 text-[10px] text-zinc-400">{item.acct}</span>}
                  </span>
                  <span className="font-medium tabular-nums text-zinc-900">{formatWon(item.amount)}</span>
                </div>
              ))}
              {tooltip.data.items.length > 15 && (
                <p className="pt-2 text-center text-xs text-zinc-500">외 {tooltip.data.items.length - 15}건…</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function CategoryDetailHeader({
  flow,
  onSelectFlow,
}: {
  flow: CategoryDetailFlow
  onSelectFlow: (flow: CategoryDetailFlow) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold text-zinc-950">항목별 월별</h2>
        <p className="mt-1 text-xs text-zinc-500">대분류·소분류별 월간 {FLOW_LABELS[flow]} 상세</p>
      </div>
      <div aria-label="거래 유형" className="inline-flex rounded-lg bg-zinc-100 p-1">
        {(Object.keys(FLOW_LABELS) as CategoryDetailFlow[]).map((option) => (
          <button
            aria-pressed={flow === option}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${flow === option ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
            key={option}
            onClick={() => onSelectFlow(option)}
            type="button"
          >
            {FLOW_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  )
}

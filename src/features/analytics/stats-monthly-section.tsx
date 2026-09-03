'use client'

import Link from 'next/link'
import {
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { formatWon } from '@/lib/finance'

import type { AccountMonthlyData } from './account-monthly'
import { toggleCategoryDetailCell } from './category-detail-calculations'
import type { CategoryDetails, CellTransactionResult } from './category-detail'
import { compactWon } from './chart-theme'
import { buildSeriesChartGeometry } from './series-chart-geometry'
import { SeriesChart, type SeriesChartKind } from './series-chart'
import {
  buildStatsMonthlyModel,
  STATS_VIEW_EVENT,
  statsCellKey,
  statsSparkline,
  statsViewSearch,
  type StatsMonthlyAxis,
  type StatsMonthlyFlow,
} from './stats-monthly'

const FLOW_LABELS: Record<StatsMonthlyFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

const CHART_LABELS: Record<SeriesChartKind, string> = {
  stacked: '누적 막대',
  line: '선',
  area: '100% 누적 영역',
}

const GRID_COLUMNS = '150px repeat(12, minmax(0, 1fr)) 110px 95px 90px'

type CellTooltipState = {
  key: string
  major: string
  sub: string
  month: number
  anchor: DOMRect
  data: CellTransactionResult
}

function segmentedButton(active: boolean, disabled = false) {
  if (disabled) return 'cursor-not-allowed text-finance-faint'
  return active
    ? 'bg-finance-ink font-semibold text-white'
    : 'text-finance-muted hover:bg-finance-track hover:text-finance-ink'
}

function trendDeltaColor(delta: number | null, flow: StatsMonthlyFlow) {
  if (delta === null || delta === 0) return 'text-finance-faint'
  const good = flow === 'expense' ? delta < 0 : delta > 0
  return good ? 'text-finance-green' : 'text-finance-red'
}

function Sparkline({
  values,
  flow,
  activeMonths,
  label,
}: {
  values: number[]
  flow: StatsMonthlyFlow
  activeMonths: number
  label: string
}) {
  const spark = statsSparkline(values, flow, activeMonths)
  if (!spark) return <span className="text-finance-faint">–</span>
  return (
    <svg aria-label={`${label} 최근 추세`} className="h-5 w-20" role="img" viewBox="0 0 80 20">
      <polyline fill="none" points={spark.points} stroke={spark.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx="78" cy={spark.lastY} fill={spark.color} r="2.5" />
    </svg>
  )
}

export function StatsMonthlySection({
  year,
  details,
  accountMonthly,
  highlightedMajor,
  initialFlow = 'expense',
  initialAxis = 'category',
  initialChart = 'stacked',
}: {
  year: number
  details: CategoryDetails
  accountMonthly: Record<'expense' | 'income', AccountMonthlyData>
  highlightedMajor?: string
  initialFlow?: StatsMonthlyFlow
  initialAxis?: StatsMonthlyAxis
  initialChart?: SeriesChartKind
}) {
  const [flow, setFlow] = useState<StatsMonthlyFlow>(initialFlow)
  const [axis, setAxis] = useState<StatsMonthlyAxis>(initialFlow === 'expense' ? initialAxis : 'category')
  const [chart, setChart] = useState<SeriesChartKind>(initialChart)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => (
    new Set(highlightedMajor ? [highlightedMajor] : [details.expense.groups[0]?.major].filter(Boolean))
  ))
  const [hoverSeries, setHoverSeries] = useState<string | null>(null)
  const [hoverMonth, setHoverMonth] = useState<number | null>(null)
  const [cellTooltip, setCellTooltip] = useState<CellTooltipState | null>(null)
  const cache = useRef(new Map<string, CellTransactionResult>())
  const activeCell = useRef<string | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const tooltipId = `stats-cell-tooltip-${generatedId.replace(/:/g, '')}`
  const effectiveAxis = flow === 'expense' ? axis : 'category'
  const model = useMemo(() => buildStatsMonthlyModel({
    flow,
    axis: effectiveAxis,
    details,
    accountMonthly,
    excluded,
  }), [accountMonthly, details, effectiveAxis, excluded, flow])
  const geometry = useMemo(
    () => buildSeriesChartGeometry(model.series, chart, model.activeMonths),
    [chart, model.activeMonths, model.series],
  )
  const hoveredSeries = model.series.find((item) => item.id === hoverSeries) ?? null
  const hoveredValue = hoveredSeries && hoverMonth !== null ? hoveredSeries.values[hoverMonth] ?? 0 : 0
  const hoveredTotal = hoverMonth !== null ? model.monthTotals[hoverMonth] : 0
  const hoveredPrevious = hoveredSeries && hoverMonth !== null && hoverMonth > 0
    ? hoveredSeries.values[hoverMonth - 1] ?? 0
    : null
  const hoveredDelta = hoveredPrevious === null ? null : hoveredValue - hoveredPrevious

  useEffect(() => {
    const view = { chart, flow, axis: effectiveAxis }
    const search = statsViewSearch(window.location.search, view)
    const nextUrl = `${window.location.pathname}?${search}${window.location.hash}`
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, '', nextUrl)
    window.dispatchEvent(new CustomEvent(STATS_VIEW_EVENT, { detail: view }))
  }, [chart, effectiveAxis, flow])

  useLayoutEffect(() => {
    const element = tooltipRef.current
    if (!element || !cellTooltip) return
    const margin = 8
    const gap = 6
    const bounds = element.getBoundingClientRect()
    let left = Math.min(cellTooltip.anchor.left, window.innerWidth - bounds.width - margin)
    left = Math.max(margin, left)
    let top = cellTooltip.anchor.bottom + gap
    if (top + bounds.height > window.innerHeight - margin) {
      top = Math.max(margin, cellTooltip.anchor.top - bounds.height - gap)
    }
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  }, [cellTooltip])

  function clearTimer(timer: typeof showTimer) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function closeCellTooltip() {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    activeCell.current = null
    setCellTooltip(null)
  }

  function scheduleHide() {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    hideTimer.current = setTimeout(() => {
      activeCell.current = null
      setCellTooltip(null)
    }, 150)
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
    const key = `${flow}\u0000${major}\u0000${sub}\u0000${month}`
    activeCell.current = key
    showTimer.current = setTimeout(async () => {
      const cached = cache.current.get(key)
      if (cached) {
        if (activeCell.current === key) {
          setCellTooltip({ key, major, sub, month, anchor: target.getBoundingClientRect(), data: cached })
        }
        return
      }
      const params = new URLSearchParams({ flow, year: String(year), month: String(month), major, sub })
      try {
        const response = await fetch(`/api/cell-tx?${params}`)
        if (!response.ok) return
        const data = await response.json() as CellTransactionResult
        cache.current.set(key, data)
        if (activeCell.current === key) {
          setCellTooltip({ key, major, sub, month, anchor: target.getBoundingClientRect(), data })
        }
      } catch {
        // The table remains usable when a tooltip request is interrupted.
      }
    }, delay)
  }

  function selectFlow(nextFlow: StatsMonthlyFlow) {
    closeCellTooltip()
    setFlow(nextFlow)
    if (nextFlow !== 'expense') setAxis('category')
    setExcluded(new Set())
    setHoverSeries(null)
    setHoverMonth(null)
  }

  function selectAxis(nextAxis: StatsMonthlyAxis) {
    if (flow !== 'expense') return
    closeCellTooltip()
    setAxis(nextAxis)
    setExcluded(new Set())
    setHoverSeries(null)
    setHoverMonth(null)
  }

  function toggleExpanded(label: string) {
    setExpanded((current) => toggleCategoryDetailCell(current, label))
  }

  function toggleCell(key: string) {
    setExcluded((current) => toggleCategoryDetailCell(current, key))
  }

  function updateHover(seriesId: string | null, month: number | null) {
    setHoverSeries(seriesId)
    setHoverMonth(month)
  }

  const axisLabels = chart === 'area'
    ? ['100%', '50%', '0']
    : [compactWon(geometry.maxValue), compactWon(Math.round(geometry.maxValue / 2)), '0']
  const chartHint = chart === 'stacked'
    ? '막대 높이 = 월 합계, 색 = 항목 비중'
    : chart === 'line'
      ? '항목별 월 금액, 같은 축'
      : '월 합계를 100%로 본 항목 비중'

  return (
    <section className="border-b border-finance-hairline py-6" id="category-detail">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="t-section text-finance-ink">달마다 어떻게 달랐나</h2>
          <p className="mt-1 t-caption text-finance-faint">그래프와 표가 같은 데이터·같은 색·같은 12개 열 · 행을 가리키면 시리즈 강조 · 셀 클릭은 합계와 그래프에서 제외</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div aria-label="그래프 종류" className="inline-flex border border-finance-ink" role="group">
            {(Object.keys(CHART_LABELS) as SeriesChartKind[]).map((option) => (
              <button className={`h-7 border-l border-finance-ink px-3 t-caption first:border-l-0 ${segmentedButton(chart === option)}`} key={option} onClick={() => setChart(option)} type="button">
                {CHART_LABELS[option]}
              </button>
            ))}
          </div>
          <div aria-label="거래 유형" className="inline-flex border border-finance-ink" role="group">
            {(Object.keys(FLOW_LABELS) as StatsMonthlyFlow[]).map((option) => (
              <button className={`h-7 border-l border-finance-ink px-3 t-caption first:border-l-0 ${segmentedButton(flow === option)}`} key={option} onClick={() => selectFlow(option)} type="button">
                {FLOW_LABELS[option]}
              </button>
            ))}
          </div>
          <div aria-label="분류 기준" className={`inline-flex border ${flow === 'expense' ? 'border-finance-ink' : 'border-finance-hairline opacity-50'}`} role="group">
            {(['category', 'account'] as StatsMonthlyAxis[]).map((option) => {
              const disabled = flow !== 'expense'
              return (
                <button aria-disabled={disabled} className={`h-7 border-l border-inherit px-3 t-caption first:border-l-0 ${segmentedButton(effectiveAxis === option, disabled)}`} key={option} onClick={() => selectAxis(option)} type="button">
                  {option === 'category' ? '카테고리' : '결제수단'}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {model.series.length === 0 ? (
        <div className="mt-4 border-y border-finance-hairline py-14 text-center">
          <p className="t-body-strong text-finance-ink">이 조건에 표시할 월별 데이터가 없습니다.</p>
          <p className="mt-1 t-caption text-finance-muted">다른 거래 유형이나 분류 기준을 선택해 보세요.</p>
        </div>
      ) : (
        <div aria-label="월별 그래프와 항목별 표" className="mt-4 overflow-x-auto overscroll-x-contain">
          <div className="min-w-[1200px]">
            <div className="grid items-stretch gap-x-1.5" style={{ gridTemplateColumns: GRID_COLUMNS }}>
              <div className="relative t-axis text-finance-faint">
                <span className="absolute right-2 top-[6px] -translate-y-1/2">{axisLabels[0]}</span>
                <span className="absolute right-2 top-[113px] -translate-y-1/2">{axisLabels[1]}</span>
                <span className="absolute bottom-0 right-2">{axisLabels[2]}</span>
              </div>
              <div className="relative col-span-12">
                <SeriesChart activeMonths={model.activeMonths} currentMonthIndex={model.currentMonthIndex} hoverMonth={hoverMonth} hoverSeries={hoverSeries} kind={chart} onHover={updateHover} series={model.series} />
                {hoveredSeries && hoverMonth !== null && hoverMonth < model.activeMonths && (
                  <div
                    className="pointer-events-none absolute top-2 z-20 flex w-[8.3333%] justify-center"
                    style={{
                      left: `${(hoverMonth / 12) * 100}%`,
                      transform: `translateX(${hoverMonth <= 1 ? 90 : hoverMonth >= model.activeMonths - 1 ? -90 : 0}px)`,
                    }}
                  >
                    <div className="whitespace-nowrap bg-finance-ink px-3 py-2.5 text-white shadow-xl">
                      <p className="flex items-center gap-1.5 t-body-strong">
                        <span className="inline-block h-[9px] w-[9px]" style={{ background: hoveredSeries.color }} />
                        {hoveredSeries.label}
                        <span className="font-normal text-finance-faint">· {hoverMonth + 1}월{hoverMonth === model.currentMonthIndex ? ' (진행)' : ''}</span>
                      </p>
                      <p className="mt-1.5 t-kpi-sm">{formatWon(hoveredValue)}<span className="ml-1 t-caption font-medium text-finance-faint">원</span></p>
                      <p className="mt-1 t-caption text-finance-faint">
                        월 합계 {formatWon(hoveredTotal)}원의 <strong className="text-white">{hoveredTotal > 0 ? ((hoveredValue / hoveredTotal) * 100).toFixed(1) : '0.0'}%</strong>
                        {' · '}전월 대비 <strong className={trendDeltaColor(hoveredDelta, flow)}>{hoveredDelta === null ? '–' : hoveredDelta === 0 ? '변동 없음' : `${hoveredDelta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(hoveredDelta))}`}</strong>
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="col-span-3 self-end pb-1 t-caption text-finance-muted">{chartHint}</div>
            </div>

            <div className="mt-4 border-t border-finance-ink">
              <div className="grid items-center gap-x-1.5 border-b border-finance-hairline py-[9px] t-label text-finance-muted" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div>{effectiveAxis === 'account' ? '결제수단' : '항목'}</div>
                {Array.from({ length: 12 }, (_, month) => (
                  <div className={`text-right ${month === hoverMonth ? 'font-bold text-finance-ink' : month === model.currentMonthIndex ? 'text-finance-blue' : month >= model.activeMonths ? 'text-finance-faint' : ''}`} key={month}>
                    {month + 1}월{month === model.currentMonthIndex ? '·진행' : ''}
                  </div>
                ))}
                <div className="text-right">합계</div>
                <div className="text-right">월평균</div>
                <div className="text-center">추세</div>
              </div>

              {model.rows.map((row) => {
                const canExpand = effectiveAxis === 'category' && row.subs.length > 0
                const isExpanded = canExpand && expanded.has(row.label)
                return (
                  <div key={row.id}>
                    <div
                      className={`grid items-center gap-x-1.5 border-b border-finance-track py-[9px] t-caption ${hoverSeries === row.id ? 'bg-finance-blue-tint' : 'bg-finance-panel'}`}
                      id={highlightedMajor === row.label ? 'highlighted-category' : undefined}
                      onMouseEnter={() => updateHover(row.id, null)}
                      onMouseLeave={() => updateHover(null, null)}
                      style={{ gridTemplateColumns: GRID_COLUMNS }}
                    >
                      <button className={`flex items-center gap-2 text-left ${canExpand ? 'hover:text-finance-blue' : 'cursor-default'}`} onClick={() => canExpand && toggleExpanded(row.label)} type="button">
                        <span className="inline-block h-[9px] w-[9px] shrink-0" style={{ background: row.color }} />
                        <span className="truncate font-bold text-finance-ink">{canExpand ? isExpanded ? '▾ ' : '▸ ' : ''}{row.label}</span>
                      </button>
                      {Array.from({ length: 12 }, (_, month) => {
                        const key = statsCellKey({ axis: effectiveAxis, label: effectiveAxis === 'account' ? row.label.replace(/^그 외 \d+개 결제수단$/, '그 외') : row.label.replace(/^그 외 \d+개 대분류$/, '그 외'), month })
                        const rawValue = row.displayValues[month]
                        const isExcluded = excluded.has(key)
                        return (
                          <button
                            aria-label={`${row.label} ${month + 1}월 ${formatWon(rawValue ?? 0)}원, ${isExcluded ? '합계에 다시 포함' : '합계에서 제외'}`}
                            aria-pressed={isExcluded}
                            className={`min-w-0 px-0.5 py-1 text-right tabular-nums ${isExcluded ? 'text-finance-faint line-through' : month === model.currentMonthIndex ? 'text-finance-muted' : rawValue === null ? 'cursor-default text-finance-faint' : 'text-finance-ink hover:bg-finance-blue-tint'}`}
                            disabled={rawValue === null}
                            key={month}
                            onClick={() => toggleCell(key)}
                            onMouseEnter={() => updateHover(row.id, month)}
                            title={rawValue === null ? undefined : isExcluded ? '합계에 다시 포함' : '합계와 그래프에서 제외'}
                            type="button"
                          >
                            {rawValue === null ? '' : rawValue === 0 ? '–' : formatWon(rawValue)}
                          </button>
                        )
                      })}
                      <div className="text-right font-bold tabular-nums text-finance-ink">{formatWon(row.total)}</div>
                      <div className="text-right tabular-nums text-finance-muted">{formatWon(row.average)}</div>
                      <div className="flex justify-center"><Sparkline activeMonths={model.activeMonths} flow={flow} label={row.label} values={row.values} /></div>
                    </div>

                    {isExpanded && row.subs.map((sub) => (
                      <div
                        className={`grid items-center gap-x-1.5 border-b border-finance-track py-2 t-caption ${hoverSeries === row.id ? 'bg-finance-blue-tint' : 'bg-white'}`}
                        key={sub.id}
                        onMouseEnter={() => updateHover(row.id, null)}
                        onMouseLeave={() => updateHover(null, null)}
                        style={{ gridTemplateColumns: GRID_COLUMNS }}
                      >
                        <div className="truncate pl-4 text-finance-muted">{sub.label}</div>
                        {Array.from({ length: 12 }, (_, month) => {
                          const key = statsCellKey({ axis: 'category', label: sub.major, sub: sub.sub, month })
                          const rawValue = details[flow].groups.find((group) => group.major === sub.major)?.subs.find((item) => item.sub === sub.sub)?.months[month] ?? 0
                          const isExcluded = excluded.has(key)
                          const tooltipKey = `${flow}\u0000${sub.major}\u0000${sub.sub}\u0000${month + 1}`
                          return (
                            <button
                              aria-describedby={cellTooltip?.key === tooltipKey ? tooltipId : undefined}
                              aria-label={`${sub.major} ${sub.sub} ${month + 1}월 ${formatWon(rawValue)}원, ${isExcluded ? '합계에 다시 포함' : '합계에서 제외'}`}
                              aria-pressed={isExcluded}
                              className={`min-w-0 px-0.5 py-1 text-right tabular-nums ${isExcluded ? 'text-finance-faint line-through' : month === model.currentMonthIndex ? 'text-finance-muted' : month >= model.activeMonths ? 'cursor-default text-finance-faint' : 'text-finance-ink hover:bg-finance-blue-tint'}`}
                              disabled={month >= model.activeMonths}
                              key={month}
                              onBlur={scheduleHide}
                              onClick={() => toggleCell(key)}
                              onFocus={(event) => rawValue > 0 && requestCellTransactions(event.currentTarget, sub.major, sub.sub, month + 1, 0)}
                              onKeyDown={(event) => { if (event.key === 'Escape') closeCellTooltip() }}
                              onMouseEnter={(event) => {
                                updateHover(row.id, month)
                                if (rawValue > 0) requestCellTransactions(event.currentTarget, sub.major, sub.sub, month + 1, 180)
                              }}
                              onMouseLeave={scheduleHide}
                              title={month >= model.activeMonths ? undefined : isExcluded ? '합계에 다시 포함' : '합계와 그래프에서 제외'}
                              type="button"
                            >
                              {month >= model.activeMonths ? '' : rawValue === 0 ? '–' : formatWon(rawValue)}
                            </button>
                          )
                        })}
                        <div className="text-right font-semibold tabular-nums text-finance-ink">{formatWon(sub.total)}</div>
                        <div className="text-right tabular-nums text-finance-muted">{formatWon(sub.average)}</div>
                        <div className="flex justify-center"><Sparkline activeMonths={model.activeMonths} flow={flow} label={`${sub.major} ${sub.label}`} values={sub.values} /></div>
                      </div>
                    ))}
                  </div>
                )
              })}

              <div className="grid items-center gap-x-1.5 border-b border-finance-ink py-[11px] t-caption" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div className="font-bold text-finance-ink">총계</div>
                {model.monthTotals.map((amount, month) => (
                  <div className={`text-right font-semibold tabular-nums ${month === model.currentMonthIndex ? 'text-finance-muted' : month >= model.activeMonths ? 'text-finance-faint' : 'text-finance-ink'}`} key={month}>
                    {month >= model.activeMonths ? '' : amount === 0 ? '–' : formatWon(amount)}
                  </div>
                ))}
                <div className="text-right font-bold tabular-nums text-finance-ink">{formatWon(model.total)}</div>
                <div className="text-right tabular-nums text-finance-muted">{formatWon(model.average)}</div>
                <div />
              </div>
            </div>
          </div>
        </div>
      )}

      {model.series.length > 0 && <p className="mt-2 t-caption text-finance-faint sm:hidden">그래프와 표를 함께 좌우로 밀어 12개월을 확인하세요.</p>}

      <p className="mt-2.5 t-caption text-finance-faint">
        {excluded.size > 0 && <>제외된 셀 {excluded.size}개 · 표와 그래프 모두에서 빠집니다. 취소선 셀을 다시 클릭하면 복원. </>}
        {model.currentMonthIndex !== null && `${model.currentMonthIndex + 1}월은 진행 중이라 합계에는 넣고 월평균에서 뺍니다 · `}
        추세는 최근 6개월 · {flow === 'expense' ? '결제수단 축은 같은 지출을 결제수단별로 나눈 값입니다.' : '수입·저축은 카테고리 축만 제공합니다.'}
      </p>

      {cellTooltip && (
        <div
          className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto bg-finance-ink p-3 text-white shadow-xl"
          id={tooltipId}
          onMouseEnter={() => clearTimer(hideTimer)}
          onMouseLeave={scheduleHide}
          ref={tooltipRef}
          role="tooltip"
          style={{ left: 8, top: 8, visibility: 'hidden' }}
        >
          <div className="border-b border-finance-border pb-2">
            <p className="font-semibold text-white">{cellTooltip.major} › {cellTooltip.sub} · {cellTooltip.month}월</p>
            <p className="mt-0.5 t-caption text-finance-faint">{cellTooltip.data.items.length}건 · {formatWon(cellTooltip.data.total)}원</p>
          </div>
          <div className="divide-y divide-finance-border">
            {cellTooltip.data.items.slice(0, 15).map((item, index) => (
              <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 py-2 t-caption" key={`${item.date}-${item.name}-${item.amount}-${index}`}>
                <span className="text-finance-faint">{item.date.slice(5).replace('-', '/')}</span>
                <span className="min-w-0 truncate text-finance-faint">{item.name}{item.acct && <span className="ml-1">{item.acct}</span>}</span>
                <span className="font-medium tabular-nums text-white">{formatWon(item.amount)}</span>
              </div>
            ))}
            {cellTooltip.data.items.length === 0 && <p className="py-4 text-center t-body text-finance-faint">내역 없음</p>}
          </div>
          <Link className="mt-3 block border-t border-finance-border pt-2 text-right t-caption font-semibold text-white hover:text-finance-blue" href={`/ledger?month=${year}-${String(cellTooltip.month).padStart(2, '0')}&tab=list&flow=${flow}&major=${encodeURIComponent(cellTooltip.major)}`}>
            이 달 거래 보기 →
          </Link>
        </div>
      )}
    </section>
  )
}

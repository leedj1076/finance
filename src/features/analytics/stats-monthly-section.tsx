'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { formatWon } from '@/lib/finance'

import type { AccountMonthlyData } from './account-monthly'
import { toggleCategoryDetailCell } from './category-detail-calculations'
import type { CategoryDetails, CellTransactionResult } from './category-detail'
import { compactWon } from './chart-theme'
import { PROVISIONAL_DASH } from './chart-js'
import { ChartHoverTooltip } from './chart-hover-tooltip'
import type { ChartHoverAnchor } from './chart-tooltip-position'
import { buildSeriesChartGeometry } from './series-chart-geometry'
import { SeriesChart, type SeriesChartKind } from './series-chart'
import {
  buildStatsMonthlyModel,
  selectedStatsMonthlyRows,
  STATS_VIEW_EVENT,
  statsCellKey,
  statsSparkline,
  statsViewSearch,
  toggleStatsSeriesSelection,
  type StatsMonthlyAxis,
  type StatsMonthlyFlow,
  type StatsSeriesSelection,
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

type TooltipAnchor = {
  x: number
  y: number
}

type FocusScrollState = {
  x: number
  y: number
  container: HTMLElement | null
  containerLeft: number
  containerTop: number
}

type CellTooltipState = {
  kind: 'detail'
  key: string
  major: string
  sub: string
  month: number
  anchor: TooltipAnchor
  data: CellTransactionResult
}

type SummaryTooltipState = {
  kind: 'summary'
  key: string
  major: string
  month: number
  value: number
  anchor: TooltipAnchor
}

type TableTooltipState = CellTooltipState | SummaryTooltipState

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
  preserveRecordedMonths,
  closedMonths,
  label,
}: {
  values: Array<number | null>
  flow: StatsMonthlyFlow
  activeMonths: number
  preserveRecordedMonths: boolean
  closedMonths: readonly boolean[]
  label: string
}) {
  const spark = statsSparkline(values, flow, activeMonths, preserveRecordedMonths, closedMonths)
  if (!spark) return <span className="text-finance-faint">–</span>
  return (
    <svg aria-label={`${label} 최근 추세`} className="h-5 w-20" role="img" viewBox="0 0 80 20">
      {spark.segments.map((points, index) => points.includes(' ')
        ? <polyline key={index} fill="none" points={points} stroke={spark.color} strokeWidth="2" strokeDasharray={spark.provisionalSegments[index] ? PROVISIONAL_DASH.join(' ') : undefined} opacity={spark.provisionalSegments[index] ? 0.45 : 1} vectorEffect="non-scaling-stroke" />
        : <circle key={index} cx={points.split(',')[0]} cy={points.split(',')[1]} fill={spark.provisionalSegments[index] ? 'none' : spark.color} stroke={spark.color} strokeWidth="1.5" opacity={spark.provisionalSegments[index] ? 0.45 : 1} r="2" />)}
      <circle cx={spark.lastX} cy={spark.lastY} fill={spark.lastProvisional ? 'none' : spark.color} stroke={spark.color} strokeWidth="1.5" opacity={spark.lastProvisional ? 0.45 : 1} r="2.5" />
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
  const router = useRouter()
  const [stale, setStale] = useState(false)
  const [flow, setFlow] = useState<StatsMonthlyFlow>(initialFlow)
  const [axis, setAxis] = useState<StatsMonthlyAxis>(initialFlow === 'expense' ? initialAxis : 'category')
  const [chart, setChart] = useState<SeriesChartKind>(initialChart)
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => (
    new Set(highlightedMajor ? [highlightedMajor] : [details.expense.groups[0]?.major].filter(Boolean))
  ))
  const [hoverSeries, setHoverSeries] = useState<string | null>(null)
  const [hoverMonth, setHoverMonth] = useState<number | null>(null)
  const [chartHovered, setChartHovered] = useState(false)
  const [chartAnchor, setChartAnchor] = useState<ChartHoverAnchor | null>(null)
  const [selection, setSelection] = useState<StatsSeriesSelection | null>(null)
  const [cellTooltip, setCellTooltip] = useState<TableTooltipState | null>(null)
  const cache = useRef(new Map<string, CellTransactionResult>())
  const activeCell = useRef<string | null>(null)
  const activeAnchor = useRef<TooltipAnchor | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const focusScroll = useRef<FocusScrollState | null>(null)
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
  const selectedSeries = model.series.find((item) => item.id === selection?.seriesId) ?? null
  const selectedRows = selectedStatsMonthlyRows(model.rows, selectedSeries?.id ?? null)
  const highlightedSeriesId = hoverSeries ?? selectedSeries?.id ?? null
  const highlightedMonth = hoverMonth ?? selection?.month ?? null
  const hoveredValue = hoveredSeries && hoverMonth !== null ? hoveredSeries.values[hoverMonth] ?? 0 : 0
  const hoveredTotal = hoverMonth !== null ? model.monthTotals[hoverMonth] : 0
  const hoveredPrevious = hoveredSeries && hoverMonth !== null && hoverMonth > 0
    ? hoveredSeries.values[hoverMonth - 1] ?? null
    : null
  const hoveredDelta = hoveredPrevious === null ? null : hoveredValue - hoveredPrevious
  const isProvisional = (month: number) => model.eligibleMonths[month] && !model.closedMonths[month]
  const comparisonIsProvisional = hoverMonth !== null && (!model.closedMonths[hoverMonth] || !model.closedMonths[hoverMonth - 1])

  useEffect(() => {
    cache.current.clear()
    activeCell.current = null
    activeRequest.current?.abort()
    activeRequest.current = null
    focusScroll.current = null
    setCellTooltip(null)
    setStale(false)
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      activeRequest.current?.abort()
    }
  }, [details])

  function cellCacheKey(major: string, sub: string, month: number) {
    const revision = details[flow].monthRevisions?.[month]
    return `${year}\u0000${model.closedMonths[month - 1] ? `closed:${revision}` : 'live'}\u0000${flow}\u0000${major}\u0000${sub}\u0000${month}`
  }

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
    let left = Math.min(cellTooltip.anchor.x + gap, window.innerWidth - bounds.width - margin)
    left = Math.max(margin, left)
    let top = cellTooltip.anchor.y + gap
    if (top + bounds.height > window.innerHeight - margin) {
      top = Math.max(margin, cellTooltip.anchor.y - bounds.height - gap)
    }
    element.style.left = `${left}px`
    element.style.top = `${top}px`
    element.style.visibility = 'visible'
  }, [cellTooltip])

  useEffect(() => {
    const hide = (event?: Event) => {
      if (event?.target instanceof Node && tooltipRef.current?.contains(event.target)) return
      const focus = focusScroll.current
      if (event?.type === 'scroll' && focus) {
        if (
          window.scrollX === focus.x
          && window.scrollY === focus.y
          && (!focus.container || (focus.container.scrollLeft === focus.containerLeft && focus.container.scrollTop === focus.containerTop))
        ) return
      }
      focusScroll.current = null
      if (showTimer.current) clearTimeout(showTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      activeRequest.current?.abort()
      activeRequest.current = null
      activeCell.current = null
      activeAnchor.current = null
      setCellTooltip(null)
    }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  function clearTimer(timer: typeof showTimer) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function abortCellRequest() {
    activeRequest.current?.abort()
    activeRequest.current = null
  }

  function closeCellTooltip() {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    abortCellRequest()
    focusScroll.current = null
    activeCell.current = null
    activeAnchor.current = null
    setCellTooltip(null)
  }

  function scheduleHide() {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    hideTimer.current = setTimeout(() => {
      closeCellTooltip()
    }, 150)
  }

  function requestCellTransactions(
    major: string,
    sub: string,
    month: number,
    delay: number,
    anchor: TooltipAnchor,
    focusState?: FocusScrollState,
  ) {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    abortCellRequest()
    focusScroll.current = focusState ?? null
    if (!model.availableMonths[month - 1]) return
    const key = cellCacheKey(major, sub, month)
    activeCell.current = key
    activeAnchor.current = anchor
    setCellTooltip(null)
    const load = async () => {
      const cached = cache.current.get(key)
      if (cached) {
        if (activeCell.current === key) {
          setCellTooltip({ kind: 'detail', key, major, sub, month, anchor: activeAnchor.current ?? anchor, data: cached })
        }
        return
      }
      const controller = new AbortController()
      activeRequest.current = controller
      const params = new URLSearchParams({ flow, year: String(year), month: String(month), major, sub })
      if (model.closedMonths[month - 1]) {
        params.set('scope', 'closed')
        params.set('revision', String(details[flow].monthRevisions?.[month]))
      } else {
        params.set('scope', 'live')
      }
      try {
        const response = await fetch(`/api/cell-tx?${params}`, { signal: controller.signal })
        if (response.status === 409) {
          cache.current.clear()
          closeCellTooltip()
          setStale(true)
          return
        }
        if (!response.ok) return
        const data = await response.json() as CellTransactionResult
        cache.current.set(key, data)
        if (activeCell.current === key) {
          setCellTooltip({ kind: 'detail', key, major, sub, month, anchor: activeAnchor.current ?? anchor, data })
        }
      } catch {
        // The table remains usable when a tooltip request is interrupted.
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null
      }
    }
    if (delay === 0) {
      void load()
      return
    }
    showTimer.current = setTimeout(() => { void load() }, delay)
  }

  function cellAnchor(target: HTMLButtonElement) {
    const bounds = target.getBoundingClientRect()
    return { x: bounds.left + (bounds.width / 2), y: bounds.bottom }
  }

  function focusScrollState(target: HTMLButtonElement): FocusScrollState {
    const container = target.closest<HTMLElement>('[aria-label="월별 그래프와 항목별 표"]')
    return {
      x: window.scrollX,
      y: window.scrollY,
      container,
      containerLeft: container?.scrollLeft ?? 0,
      containerTop: container?.scrollTop ?? 0,
    }
  }

  function updateDetailTooltipAnchor(key: string, anchor: TooltipAnchor) {
    if (activeCell.current !== key) return
    activeAnchor.current = anchor
    setCellTooltip((current) => current?.kind === 'detail' && current.key === key
      ? { ...current, anchor }
      : current)
  }

  function showSummaryTooltip(row: { id: string; label: string }, month: number, value: number, anchor: TooltipAnchor, focusState?: FocusScrollState) {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    abortCellRequest()
    focusScroll.current = focusState ?? null
    activeCell.current = null
    activeAnchor.current = null
    setCellTooltip({ kind: 'summary', key: `summary:${row.id}:${month}`, major: row.label, month: month + 1, value, anchor })
  }

  function selectFlow(nextFlow: StatsMonthlyFlow) {
    closeCellTooltip()
    setFlow(nextFlow)
    if (nextFlow !== 'expense') setAxis('category')
    setExcluded(new Set())
    setHoverSeries(null)
    setHoverMonth(null)
    setSelection(null)
  }

  function selectAxis(nextAxis: StatsMonthlyAxis) {
    if (flow !== 'expense') return
    closeCellTooltip()
    setAxis(nextAxis)
    setExcluded(new Set())
    setHoverSeries(null)
    setHoverMonth(null)
    setSelection(null)
  }

  function toggleExpanded(label: string) {
    setExpanded((current) => toggleCategoryDetailCell(current, label))
  }

  function toggleCell(key: string) {
    setExcluded((current) => toggleCategoryDetailCell(current, key))
  }

  const updateHover = useCallback((seriesId: string | null, month: number | null, fromChart = false) => {
    if (month !== null && !model.eligibleMonths[month]) {
      setChartHovered(false); setHoverSeries(null); setHoverMonth(null)
      return
    }
    setChartHovered(fromChart && seriesId !== null)
    setHoverSeries(seriesId)
    setHoverMonth(month)
  }, [model.eligibleMonths])

  const handleChartHover = useCallback((seriesId: string | null, month: number | null, anchor?: ChartHoverAnchor) => {
    updateHover(seriesId, month, true)
    if (anchor) setChartAnchor(previous => previous
      && previous.x === anchor.x && previous.y === anchor.y
      && previous.plot.left === anchor.plot.left && previous.plot.right === anchor.plot.right
      && previous.plot.top === anchor.plot.top && previous.plot.bottom === anchor.plot.bottom
      ? previous : anchor)
  }, [updateHover])

  const selectSeries = useCallback((seriesId: string, month: number) => {
    const next = toggleStatsSeriesSelection(selection, { seriesId, month })
    setSelection(next)
    if (!next || effectiveAxis !== 'category') return
    const row = model.rows.find((item) => item.id === next.seriesId)
    if (row) setExpanded((current) => new Set(current).add(row.label))
  }, [effectiveAxis, model.rows, selection])

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
          <p className="mt-1 t-caption text-finance-faint">그래프의 항목을 클릭하면 아래에서 그 항목만 상세 확인 · 셀 클릭은 합계와 그래프에서 제외</p>
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

      {stale && <p role="alert" className="mt-3 border-l-2 border-finance-amber px-3 py-2 t-caption text-finance-amber">마감 상태 또는 내역이 바뀌었습니다. <button type="button" className="font-semibold underline" onClick={() => router.refresh()}>최신 통계 확인</button></p>}
      {model.rows.length > 0 && <label className="mt-4 flex flex-wrap items-center gap-2 t-caption text-finance-muted">상세 항목
        <select aria-label="상세 항목 선택" className="max-w-full border border-finance-border bg-white px-2 py-1 text-finance-ink" value={encodeURIComponent(selectedSeries?.id ?? '')} onChange={event => {
          const id = decodeURIComponent(event.target.value)
          setSelection(id ? { seriesId: id, month: null } : null)
          const row = model.rows.find(item => item.id === id)
          if (row) setExpanded(current => new Set(current).add(row.label))
        }}>
          <option value="">전체 항목</option>
          {model.rows.map(row => <option key={row.id} value={encodeURIComponent(row.id)}>{row.label}</option>)}
        </select>
      </label>}

      {model.series.length === 0 ? (
        <div className="mt-4 border-y border-finance-hairline py-14 text-center">
          <p className="t-body-strong text-finance-ink">이 조건에 표시할 월별 데이터가 없습니다.</p>
          <p className="mt-1 t-caption text-finance-muted">다른 거래 유형이나 분류 기준을 선택해 보세요.</p>
        </div>
      ) : (
        <div aria-label="월별 그래프와 항목별 표" className="mt-4 overflow-x-auto overscroll-x-contain">
          <div className="min-w-[1200px]">
            <div className="mb-2 grid items-end gap-x-1.5 t-label" style={{ gridTemplateColumns: GRID_COLUMNS }}>
              <div />
              {model.monthStates.map((state, month) => (
                <div key={month} className={`text-center ${state === 'current' ? 'italic text-finance-faint' : state === 'future' ? 'text-finance-faint' : isProvisional(month) ? 'text-finance-amber' : 'text-finance-ink'}`}>
                  {month + 1}월{state === 'current' ? '·진행 중' : isProvisional(month) ? '·잠정' : ''}
                </div>
              ))}
              <div className="col-span-3" />
            </div>
            <div className="grid items-stretch gap-x-1.5" style={{ gridTemplateColumns: GRID_COLUMNS }}>
              <div className="relative t-axis text-finance-faint">
                <span className="absolute right-2 top-[6px] -translate-y-1/2">{axisLabels[0]}</span>
                <span className="absolute right-2 top-[113px] -translate-y-1/2">{axisLabels[1]}</span>
                <span className="absolute bottom-0 right-2">{axisLabels[2]}</span>
              </div>
              <div className="relative col-span-12">
                <SeriesChart
                  activeMonths={model.activeMonths}
                  currentMonthIndex={model.currentMonthIndex}
                  monthStates={model.monthStates}
                  hoverMonth={hoverMonth}
                  hoverSeries={hoverSeries}
                  kind={chart}
                  onHover={handleChartHover}
                  onSelect={selectSeries}
                  selectedMonth={selection?.month ?? null}
                  selectedSeries={selectedSeries?.id ?? null}
                  series={model.series}
                />
                {chartHovered && chartAnchor && hoveredSeries && hoverMonth !== null && model.eligibleMonths[hoverMonth] && (
                  <ChartHoverTooltip anchor={chartAnchor}>
                      <p className="flex items-center gap-1.5 t-body-strong">
                        <span className="inline-block h-[9px] w-[9px]" style={{ background: hoveredSeries.color }} />
                        {hoveredSeries.label}
                        <span className="font-normal text-finance-faint">· {hoverMonth + 1}월{hoverMonth === model.currentMonthIndex ? ' (진행 중)' : isProvisional(hoverMonth) ? ' (잠정)' : ''}</span>
                      </p>
                      <p className={`mt-1.5 t-kpi-sm ${isProvisional(hoverMonth) ? 'text-finance-faint' : ''}`}>{formatWon(hoveredValue)}<span className="ml-1 t-caption font-medium text-finance-faint">원</span></p>
                      <p className="mt-1 t-caption text-finance-faint">
                        월 합계 {formatWon(hoveredTotal)}원의 <strong className="text-[var(--background)]">{hoveredTotal > 0 ? ((hoveredValue / hoveredTotal) * 100).toFixed(1) : '0.0'}%</strong>
                        {' · '}전월 대비 <strong className={comparisonIsProvisional ? 'text-finance-faint' : trendDeltaColor(hoveredDelta, flow)}>{hoveredDelta === null ? '–' : hoveredDelta === 0 ? '변동 없음' : `${hoveredDelta > 0 ? '▲' : '▼'} ${formatWon(Math.abs(hoveredDelta))}`}</strong>
                        {hoveredDelta !== null && <span className={`ml-1.5 border px-1 t-label ${comparisonIsProvisional ? 'border-finance-faint text-finance-faint' : 'border-finance-green text-finance-green'}`}>{comparisonIsProvisional ? '잠정' : '확정'}</span>}
                      </p>
                  </ChartHoverTooltip>
                )}
              </div>
              <div className="col-span-3 self-end pb-1 t-caption text-finance-muted">
                <p>{chartHint}</p>
                <p className="mt-1 font-semibold text-finance-ink">그래프를 클릭해 상세 항목 선택</p>
              </div>
            </div>

            {selectedRows.length === 0 ? (
              <div className="mt-4 border-y border-finance-hairline py-9 text-center">
                <p className="t-body-strong text-finance-ink">그래프에서 확인할 항목을 선택하세요.</p>
                <p className="mt-1 t-caption text-finance-muted">선·막대·영역을 클릭하면 해당 항목의 12개월 비용과 상세 항목이 표시됩니다.</p>
              </div>
            ) : (
            <div className="mt-4 border-t border-finance-ink">
              <div className="flex items-center justify-between border-b border-finance-hairline py-2">
                <p className="t-body-strong text-finance-ink">
                  {selectedSeries && <span className="mr-2 inline-block h-[9px] w-[9px]" style={{ background: selectedSeries.color }} />}
                  {selectedSeries ? `${selectedSeries.label} · ${selection?.month !== null && selection?.month !== undefined ? `${selection.month + 1}월 선택` : '항목 선택'}` : '전체 항목'}
                </p>
                {selectedSeries && <button className="t-caption font-semibold text-finance-blue hover:text-finance-ink" onClick={() => setSelection(null)} type="button">선택 해제</button>}
              </div>
              <div className="grid items-center gap-x-1.5 border-b border-finance-hairline py-[9px] t-label text-finance-muted" style={{ gridTemplateColumns: GRID_COLUMNS }}>
                <div>{effectiveAxis === 'account' ? '결제수단' : '항목'}</div>
                {Array.from({ length: 12 }, (_, month) => (
                  <div className={`text-right ${month === model.currentMonthIndex ? 'italic text-finance-faint' : !model.eligibleMonths[month] ? 'text-finance-faint' : isProvisional(month) ? 'text-finance-amber' : month === highlightedMonth ? 'font-bold text-finance-ink' : ''}`} key={month}>
                    {month + 1}월{month === model.currentMonthIndex ? '·진행 중' : isProvisional(month) ? '·잠정' : ''}
                  </div>
                ))}
                <div className="text-right">합계<span className="block font-normal text-finance-faint">{model.divisor > 0 ? `마감 ${model.divisor}개월` : '잠정'}</span></div>
                <div className="text-right">월평균<span className="block font-normal text-finance-faint">{model.divisor > 0 ? `마감 ${model.divisor}개월` : '잠정'}</span></div>
                <div className="text-center">추세</div>
              </div>

              {selectedRows.map((row) => {
                const canExpand = effectiveAxis === 'category' && row.subs.length > 0
                const isExpanded = canExpand && expanded.has(row.label)
                return (
                  <div key={row.id}>
                    <div
                      className={`grid items-center gap-x-1.5 border-b border-finance-track py-[9px] t-caption ${highlightedSeriesId === row.id ? 'bg-finance-blue-tint' : 'bg-finance-panel'}`}
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
                            aria-describedby={cellTooltip?.kind === 'summary' && cellTooltip.key === `summary:${row.id}:${month}` ? tooltipId : undefined}
                            aria-label={rawValue === null ? `${row.label} ${month + 1}월 ${model.monthStates[month] === 'future' ? '예정' : '기록 없음'}` : `${row.label} ${month + 1}월 ${formatWon(rawValue)}원, ${isExcluded ? '합계에 다시 포함' : '합계에서 제외'}`}
                            aria-pressed={isExcluded}
                            className={`min-w-0 px-0.5 py-1 text-right tabular-nums ${month === model.currentMonthIndex ? 'italic' : ''} ${isExcluded ? 'text-finance-faint line-through' : rawValue === null ? 'cursor-default text-finance-faint' : isProvisional(month) ? 'text-finance-faint hover:bg-finance-blue-tint' : 'text-finance-ink hover:bg-finance-blue-tint'}`}
                            disabled={rawValue === null}
                            key={month}
                            onBlur={scheduleHide}
                            onClick={() => toggleCell(key)}
                            onFocus={(event) => rawValue !== null && showSummaryTooltip(row, month, rawValue, cellAnchor(event.currentTarget), focusScrollState(event.currentTarget))}
                            onKeyDown={(event) => { if (event.key === 'Escape') closeCellTooltip() }}
                            onMouseEnter={(event) => {
                              updateHover(row.id, month)
                              if (rawValue !== null) showSummaryTooltip(row, month, rawValue, { x: event.clientX, y: event.clientY })
                            }}
                            onMouseLeave={scheduleHide}
                            onMouseMove={(event) => rawValue !== null && setCellTooltip((current) => (
                              current?.kind === 'summary' && current.key === `summary:${row.id}:${month}`
                                ? { ...current, anchor: { x: event.clientX, y: event.clientY } }
                                : current
                            ))}
                            title={rawValue === null ? undefined : isExcluded ? '합계에 다시 포함' : '합계와 그래프에서 제외'}
                            type="button"
                          >
                            {rawValue === null ? model.monthStates[month] === 'future' ? '—' : '–' : rawValue === 0 ? model.closedMonths[month] ? '0' : '–' : formatWon(rawValue)}
                          </button>
                        )
                      })}
                      <div className={`text-right font-bold tabular-nums ${model.divisor > 0 ? 'text-finance-ink' : 'text-finance-faint'}`}>{formatWon(model.divisor > 0 ? row.closedTotal : row.provisionalTotal)}</div>
                      <div className={`text-right tabular-nums ${row.average === null ? 'text-finance-faint' : 'text-finance-muted'}`}>{row.average !== null ? formatWon(row.average) : row.provisionalAverage !== null ? formatWon(row.provisionalAverage) : '—'}</div>
                      <div className="flex justify-center"><Sparkline activeMonths={model.activeMonths} preserveRecordedMonths closedMonths={model.closedMonths} flow={flow} label={row.label} values={row.values.map((value, month) => model.availableMonths[month] ? value : null)} /></div>
                    </div>

                    {isExpanded && row.subs.map((sub) => (
                      <div
                        className={`grid items-center gap-x-1.5 border-b border-finance-track py-2 t-caption ${highlightedSeriesId === row.id ? 'bg-finance-blue-tint' : 'bg-white'}`}
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
                          const available = model.availableMonths[month]
                          const tooltipKey = cellCacheKey(sub.major, sub.sub, month + 1)
                          return (
                            <button
                              aria-describedby={cellTooltip?.kind === 'detail' && cellTooltip.key === tooltipKey ? tooltipId : undefined}
                              aria-label={!available ? `${sub.major} ${sub.sub} ${month + 1}월 ${model.monthStates[month] === 'future' ? '예정' : '기록 없음'}` : `${sub.major} ${sub.sub} ${month + 1}월 ${formatWon(rawValue)}원, ${isExcluded ? '합계에 다시 포함' : '합계에서 제외'}`}
                              aria-pressed={isExcluded}
                              className={`min-w-0 px-0.5 py-1 text-right tabular-nums ${month === model.currentMonthIndex ? 'italic' : ''} ${isExcluded ? 'text-finance-faint line-through' : !available ? 'cursor-default text-finance-faint' : isProvisional(month) ? 'text-finance-faint hover:bg-finance-blue-tint' : 'text-finance-ink hover:bg-finance-blue-tint'}`}
                              disabled={!available}
                              key={month}
                              onBlur={scheduleHide}
                              onClick={() => toggleCell(key)}
                              onFocus={(event) => available && requestCellTransactions(sub.major, sub.sub, month + 1, 0, cellAnchor(event.currentTarget), focusScrollState(event.currentTarget))}
                              onKeyDown={(event) => { if (event.key === 'Escape') closeCellTooltip() }}
                              onMouseEnter={(event) => {
                                updateHover(row.id, month)
                                if (available) requestCellTransactions(sub.major, sub.sub, month + 1, 180, { x: event.clientX, y: event.clientY })
                              }}
                              onMouseLeave={scheduleHide}
                              onMouseMove={(event) => updateDetailTooltipAnchor(tooltipKey, { x: event.clientX, y: event.clientY })}
                              title={!available ? model.monthStates[month] === 'future' ? '아직 오지 않은 달입니다' : '거래 기록이 없습니다' : isExcluded ? '합계에 다시 포함' : '합계와 그래프에서 제외'}
                              type="button"
                            >
                              {!available ? model.monthStates[month] === 'future' ? '—' : '–' : rawValue === 0 ? model.closedMonths[month] ? '0' : '–' : formatWon(rawValue)}
                            </button>
                          )
                        })}
                        <div className={`text-right font-semibold tabular-nums ${model.divisor > 0 ? 'text-finance-ink' : 'text-finance-faint'}`}>{formatWon(model.divisor > 0 ? sub.closedTotal : sub.provisionalTotal)}</div>
                        <div className={`text-right tabular-nums ${sub.average === null ? 'text-finance-faint' : 'text-finance-muted'}`}>{sub.average !== null ? formatWon(sub.average) : sub.provisionalAverage !== null ? formatWon(sub.provisionalAverage) : '—'}</div>
                        <div className="flex justify-center"><Sparkline activeMonths={model.activeMonths} preserveRecordedMonths closedMonths={model.closedMonths} flow={flow} label={`${sub.major} ${sub.label}`} values={sub.values.map((value, month) => model.availableMonths[month] ? value : null)} /></div>
                      </div>
                    ))}
                  </div>
                )
              })}

            </div>
            )}
          </div>
        </div>
      )}

      {model.series.length > 0 && <p className="mt-2 t-caption text-finance-faint sm:hidden">그래프와 표를 함께 좌우로 밀어 12개월을 확인하세요.</p>}

      <p className="mt-2.5 t-caption text-finance-faint">
        {excluded.size > 0 && <>제외된 셀 {excluded.size}개 · 표와 그래프 모두에서 빠집니다. 취소선 셀을 다시 클릭하면 복원. </>}
        추세는 최근 6개월 · {flow === 'expense' ? '결제수단 축은 같은 지출을 결제수단별로 나눈 값입니다.' : '수입·저축은 카테고리 축만 제공합니다.'}
      </p>

      {cellTooltip && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto bg-finance-ink p-3 text-white shadow-xl"
          id={tooltipId}
          onMouseEnter={() => clearTimer(hideTimer)}
          onMouseLeave={scheduleHide}
          ref={tooltipRef}
          role="tooltip"
          style={{ left: 8, top: 8, visibility: 'hidden' }}
        >
          {cellTooltip.kind === 'summary' ? (
            <div>
              <p className="font-semibold text-white">{cellTooltip.major} · {cellTooltip.month}월</p>
              <p className="mt-1 t-kpi-sm">{formatWon(cellTooltip.value)}<span className="ml-1 t-caption font-medium text-finance-faint">원</span></p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>,
        document.body,
      )}
    </section>
  )
}

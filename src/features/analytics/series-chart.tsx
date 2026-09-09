'use client'

import { Interaction, type BarElement, type ChartData, type ChartOptions, type InteractionModeFunction, type Plugin, type PointElement } from 'chart.js'
import { getRelativePosition } from 'chart.js/helpers'
import { useMemo, useRef } from 'react'
import { Bar, Line } from 'react-chartjs-2'

import {
  CHART_LINE_WIDTH,
  CHART_LINE_WIDTH_ACTIVE,
  CHART_POINT_RADIUS,
  CHART_POINT_RADIUS_ACTIVE,
  alpha,
  PROVISIONAL_DASH,
  provisionalPattern,
  resolveChartColor,
  monthlyEligibilityBoundary,
  useFinanceChartPalette,
} from './chart-js'
import { hitTestAreaBands, type SeriesChartKind, type SeriesChartSeries } from './series-chart-geometry'
import type { StatsMonthState } from './category-detail'

export * from './series-chart-geometry'

declare module 'chart.js' {
  interface InteractionModeMap {
    financeArea: InteractionModeFunction
    financeStacked: InteractionModeFunction
    financeLine: InteractionModeFunction
  }
}

Interaction.modes.financeLine = (chart, event, _options, useFinalPosition) => {
  const position = getRelativePosition(event, chart)
  const index = Number(chart.scales.x.getValueForPixel(position.x))
  let selected: { element: PointElement; datasetIndex: number; index: number } | null = null
  let distance = Infinity
  for (const meta of chart.getSortedVisibleDatasetMetas()) {
    if (chart.data.datasets[meta.index].data[index] == null) continue
    const point = meta.data[index] as PointElement | undefined
    if (!point || point.skip) continue
    const y = point.getProps(['y'], useFinalPosition).y
    if (y === null) continue
    if (Math.abs(y - position.y) < distance) {
      selected = { element: point, datasetIndex: meta.index, index }
      distance = Math.abs(y - position.y)
    }
  }
  return selected ? [selected] : []
}

// Keep the column under the pointer even when exclusions shrink its bars to
// zero. Global nearest-XY would otherwise jump to a taller neighbouring month.
Interaction.modes.financeStacked = (chart, event, options, useFinalPosition) => {
  const position = getRelativePosition(event, chart)
  const items = Interaction.modes.index(chart, event, { ...options, axis: 'x', intersect: false }, useFinalPosition)
  const intersected = items.find(({ element }) => (element as BarElement).inRange(position.x, position.y, useFinalPosition))
  if (intersected) return [intersected]
  let nearest: (typeof items)[number] | undefined
  let nearestDistance = Infinity
  for (const item of items) {
    const y = (item.element as BarElement).getCenterPoint(useFinalPosition).y
    if (y === null) continue
    const distance = Math.abs(y - position.y)
    if (distance < nearestDistance) {
      nearest = item
      nearestDistance = distance
    }
  }
  return nearest ? [nearest] : []
}

Interaction.modes.financeArea = (chart, event, _options, useFinalPosition) => {
  const position = getRelativePosition(event, chart)
  const { left, right, top, bottom } = chart.chartArea
  if (position.x < left || position.x > right || position.y < top || position.y > bottom) return []
  const bands = chart.getSortedVisibleDatasetMetas().map((meta) => ({
    seriesId: String(meta.index),
    points: meta.data.map((element) => {
      const point = element as PointElement
      const { x, y } = point.getProps(['x', 'y'], useFinalPosition)
      return point.skip || x === null || y === null ? null : { x, y }
    }),
  }))
  const hit = hitTestAreaBands(bands, chart.scales.y.getPixelForValue(0), position.x, position.y)
  // An isolated closed month has no adjacent area to fill. Its visible boundary
  // points remain inspectable, without inventing a band across an open month.
  if (!hit) return Interaction.modes.point(chart, event, { ..._options, intersect: true }, useFinalPosition)
  const datasetIndex = Number(hit.seriesId)
  return [{ element: chart.getDatasetMeta(datasetIndex).data[hit.month], datasetIndex, index: hit.month }]
}

function normalizedPercent(series: SeriesChartSeries[], seriesIndex: number, month: number) {
  const total = series.reduce((sum, row) => sum + Math.max(row.values[month] ?? 0, 0), 0)
  if (total <= 0) return 0
  return (Math.max(series[seriesIndex].values[month] ?? 0, 0) / total) * 100
}

export function SeriesChart({
  series,
  kind,
  monthStates,
  activeMonths,
  hoverSeries,
  hoverMonth,
  selectedSeries,
  selectedMonth,
  onHover,
  onSelect,
}: {
  series: SeriesChartSeries[]
  kind: SeriesChartKind
  currentMonthIndex: number | null
  monthStates: StatsMonthState[]
  activeMonths: number
  hoverSeries: string | null
  hoverMonth: number | null
  selectedSeries: string | null
  selectedMonth: number | null
  onHover: (seriesId: string | null, month: number | null) => void
  onSelect: (seriesId: string, month: number) => void
}) {
  const palette = useFinanceChartPalette()
  const pointerInside = useRef(false)
  const labels = useMemo(() => Array.from({ length: 12 }, (_, month) => `${month + 1}월`), [])
  const isBar = kind === 'stacked'

  const data = useMemo<ChartData<'bar'> | ChartData<'line'>>(() => {
    const hatch = provisionalPattern(palette)
    const provisional = (month: number) => ['open', 'needs_review', 'current'].includes(monthStates[month])
    const datasets = series.map((row, seriesIndex) => {
      const color = resolveChartColor(row.color, palette)
      const focusedSeries = hoverSeries ?? selectedSeries
      const dimmed = focusedSeries !== null && focusedSeries !== row.id
      const values = Array.from({ length: 12 }, (_, month) => {
        if (month >= activeMonths || row.values[month] == null) return null
        return kind === 'area' ? normalizedPercent(series, seriesIndex, month) : row.values[month]
      })

      if (isBar) {
        return {
          id: row.id,
          label: row.label,
          data: values,
          backgroundColor: values.map((_, month) => provisional(month) ? hatch : alpha(color, dimmed ? 0.16 : 1)),
          borderColor: values.map((_, month) => provisional(month) ? palette.faint : palette.background),
          borderWidth: 1,
          barPercentage: 0.72,
          categoryPercentage: 0.82,
        }
      }

      return {
        id: row.id,
        label: row.label,
        data: values,
        backgroundColor: kind === 'area' ? alpha(color, dimmed ? 0.08 : 0.72) : color,
        borderColor: alpha(color, dimmed ? 0.16 : 1),
        borderWidth: focusedSeries === row.id ? CHART_LINE_WIDTH_ACTIVE : CHART_LINE_WIDTH,
        fill: kind === 'area' ? (seriesIndex === 0 ? 'origin' : '-1') : false,
        segment: {
          borderDash: (context: { p0DataIndex: number; p1DataIndex: number }) => provisional(context.p0DataIndex) || provisional(context.p1DataIndex) ? PROVISIONAL_DASH : undefined,
        },
        pointBackgroundColor: values.map((_, month) => provisional(month) ? palette.background : color),
        pointBorderColor: values.map((_, month) => provisional(month) ? color : palette.background),
        pointBorderWidth: 1.5,
        pointRadius: (context: { dataIndex: number }) => {
          if (hoverSeries === row.id) {
            return context.dataIndex === hoverMonth ? CHART_POINT_RADIUS_ACTIVE : CHART_POINT_RADIUS
          }
          if (selectedSeries === row.id && context.dataIndex === selectedMonth) {
            return CHART_POINT_RADIUS_ACTIVE
          }
          if (values[context.dataIndex] !== null && values[context.dataIndex - 1] == null && values[context.dataIndex + 1] == null) return CHART_POINT_RADIUS
          return 0
        },
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: kind === 'line' ? 0.22 : 0,
        spanGaps: false,
      }
    })
    return { labels, datasets } as ChartData<'bar'> | ChartData<'line'>
  }, [activeMonths, monthStates, hoverMonth, hoverSeries, isBar, kind, labels, palette, selectedMonth, selectedSeries, series])

  const commonOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: kind === 'area' ? 'financeArea' as const : kind === 'stacked' ? 'financeStacked' as const : 'financeLine' as const, intersect: false },
    onHover: (_event: unknown, elements: Array<{ datasetIndex: number; index: number }>) => {
      const element = elements[0]
      if (!pointerInside.current || !element || element.index >= activeMonths || series[element.datasetIndex]?.values[element.index] == null) {
        onHover(null, null)
        return
      }
      onHover(series[element.datasetIndex]?.id ?? null, element.index)
    },
    onClick: (_event: unknown, elements: Array<{ datasetIndex: number; index: number }>) => {
      const element = elements[0]
      const seriesId = element ? series[element.datasetIndex]?.id : null
      if (!element || element.index >= activeMonths || !seriesId || series[element.datasetIndex]?.values[element.index] == null) return
      onSelect(seriesId, element.index)
    },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        stacked: true,
        offset: true,
        display: false,
        border: { display: false },
        grid: { display: false },
      },
      y: {
        stacked: kind !== 'line',
        beginAtZero: true,
        max: kind === 'area' ? 100 : undefined,
        display: true,
        border: { display: false },
        grid: { color: palette.track, drawTicks: false },
        ticks: { display: false },
      },
    },
  }), [activeMonths, kind, onHover, onSelect, palette.track, series])

  const hoverBoundary = useMemo<Plugin<'bar' | 'line'>>(() => ({
    id: 'finance-hover-boundary',
    beforeEvent: (chart, { event, inChartArea, replay }) => {
      const month = event.x == null ? -1 : Number(chart.scales.x.getValueForPixel(event.x))
      const unavailable = chart.data.datasets.every(dataset => dataset.data[month] == null)
      if (event.type === 'mouseout' || !inChartArea || !pointerInside.current || unavailable) {
        chart.setActiveElements([])
        // Options/data update in place; plugins do not. Use the current callback
        // so refreshed report state never goes through the initial closure.
        chart.options.onHover?.call(chart, event, [], chart)
        // Suppress stale hovers, but preserve a queued click: Chart.js batches
        // events in animation frames, so the pointer may have already left.
        if (event.type !== 'mouseout' && (unavailable || replay || event.type !== 'click')) return false
      }
    },
  }), [])
  const eligibilityBoundary = useMemo(() => monthlyEligibilityBoundary(), [])

  return (
    <div
      aria-label={`${kind === 'stacked' ? '누적 막대' : kind === 'line' ? '선' : '100% 누적 영역'} 월별 차트`}
      className="relative block h-[220px] w-full cursor-crosshair"
      onMouseMoveCapture={() => { pointerInside.current = true }}
      onTouchStartCapture={() => { pointerInside.current = true }}
      onMouseLeave={() => { pointerInside.current = false; onHover(null, null) }}
      role="img"
    >
      {isBar
        ? <Bar data={data as ChartData<'bar'>} options={commonOptions as ChartOptions<'bar'>} plugins={[hoverBoundary, eligibilityBoundary]} />
        : <Line data={data as ChartData<'line'>} options={commonOptions as ChartOptions<'line'>} plugins={[hoverBoundary, eligibilityBoundary]} />}
    </div>
  )
}

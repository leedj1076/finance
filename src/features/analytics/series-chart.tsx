'use client'

import type { MouseEvent } from 'react'

import {
  buildSeriesChartGeometry,
  hitTestSeriesChart,
  SERIES_MONTH_SLOT,
  SERIES_PLOT_HEIGHT,
  SERIES_PLOT_WIDTH,
  type SeriesChartKind,
  type SeriesChartSeries,
} from './series-chart-geometry'

export * from './series-chart-geometry'

export function SeriesChart({
  series,
  kind,
  currentMonthIndex,
  activeMonths,
  hoverSeries,
  hoverMonth,
  onHover,
}: {
  series: SeriesChartSeries[]
  kind: SeriesChartKind
  currentMonthIndex: number | null
  activeMonths: number
  hoverSeries: string | null
  hoverMonth: number | null
  onHover: (seriesId: string | null, month: number | null) => void
}) {
  const geometry = buildSeriesChartGeometry(series, kind, activeMonths)

  function opacityFor(seriesId: string, month?: number) {
    const seriesOpacity = hoverSeries && hoverSeries !== seriesId ? 0.18 : 1
    return month === currentMonthIndex ? seriesOpacity * 0.6 : seriesOpacity
  }

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const hit = hitTestSeriesChart({
      series,
      kind,
      activeMonths,
      xRatio: (event.clientX - bounds.left) / Math.max(bounds.width, 1),
      yRatio: (event.clientY - bounds.top) / Math.max(bounds.height, 1),
    })
    onHover(hit?.seriesId ?? null, hit?.month ?? null)
  }

  return (
    <svg
      aria-label={`${kind === 'stacked' ? '누적 막대' : kind === 'line' ? '선' : '100% 누적 영역'} 월별 차트`}
      className="block h-[220px] w-full"
      onMouseLeave={() => onHover(null, null)}
      onMouseMove={handleMouseMove}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${SERIES_PLOT_WIDTH} ${SERIES_PLOT_HEIGHT}`}
    >
      <line stroke="var(--finance-track)" x1="0" x2={SERIES_PLOT_WIDTH} y1="1" y2="1" />
      <line stroke="var(--finance-track)" x1="0" x2={SERIES_PLOT_WIDTH} y1="110" y2="110" />
      <line stroke="var(--finance-border)" x1="0" x2={SERIES_PLOT_WIDTH} y1="219" y2="219" />

      {kind === 'area' && geometry.areas.map((area) => (
        <polygon
          fill={area.color}
          key={area.seriesId}
          opacity={opacityFor(area.seriesId)}
          points={area.points}
          stroke="var(--finance-bg)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {kind === 'stacked' && geometry.bars.map((bar) => (
        <rect
          fill={bar.color}
          height={bar.height}
          key={`${bar.seriesId}:${bar.month}`}
          opacity={opacityFor(bar.seriesId, bar.month)}
          stroke="var(--finance-bg)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          width={bar.width}
          x={bar.x}
          y={bar.y}
        />
      ))}
      {kind === 'line' && geometry.lines.map((line) => (
        <polyline
          fill="none"
          key={line.seriesId}
          opacity={opacityFor(line.seriesId)}
          points={line.points}
          stroke={line.color}
          strokeLinejoin="round"
          strokeWidth={hoverSeries === line.seriesId ? 2.5 : 2}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {hoverMonth !== null && hoverMonth < activeMonths && (
        <rect
          fill="transparent"
          height={SERIES_PLOT_HEIGHT}
          pointerEvents="none"
          stroke="var(--finance-ink)"
          strokeOpacity="0.08"
          vectorEffect="non-scaling-stroke"
          width={SERIES_MONTH_SLOT}
          x={hoverMonth * SERIES_MONTH_SLOT}
          y="0"
        />
      )}
    </svg>
  )
}

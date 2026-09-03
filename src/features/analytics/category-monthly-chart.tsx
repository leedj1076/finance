'use client'

import Link from 'next/link'
import { useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { CategoryMonthlyData } from './account-monthly'
import {
  BOTTOM,
  ChartFrame,
  ChartLegendToggles,
  DIMMED_OPACITY,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  LINE_WIDTH_ACTIVE,
  OTHER_SERIES_NAME,
  POINT_RADIUS,
  POINT_RADIUS_ACTIVE,
  TOP,
  coordinates,
  pathFor,
  plotWidthFor,
  pointerPosition,
  seriesColor,
} from './chart-primitives'
import type { ChartTooltipState } from './chart-tooltip'

export function CategoryMonthlyChart({
  data,
  detailHref,
}: {
  data: CategoryMonthlyData
  detailHref?: (category: string) => string
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const visibleCategories = data.categories.filter((category) => !hidden.has(category))
  const maxValue = Math.max(
    1,
    ...visibleCategories.flatMap((category) => data.series[category])
      .filter((value): value is number => value !== null),
  )

  function toggle(category: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
    setHovered(null)
    setTooltip(null)
  }

  function showNearestCategory(event: ReactPointerEvent<SVGElement>, width: number) {
    const position = pointerPosition(event)
    let nearest: { category: string; color: string; distance: number } | null = null

    for (const category of visibleCategories) {
      const points = coordinates(data.series[category], maxValue, 0, width)
      let distance = Number.POSITIVE_INFINITY

      points.forEach((point) => {
        if (point.y === null) return
        distance = Math.min(distance, Math.hypot(position.x - point.x, position.y - point.y))
      })
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]
        const end = points[index]
        if (start.y === null || end.y === null) continue
        const dx = end.x - start.x
        const dy = end.y - start.y
        const lengthSquared = dx * dx + dy * dy
        const progress = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
          ((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared,
        ))
        distance = Math.min(distance, Math.hypot(position.x - (start.x + progress * dx), position.y - (start.y + progress * dy)))
      }

      const color = seriesColor(data.categories.indexOf(category), category)
      if (!nearest || distance < nearest.distance) nearest = { category, color, distance }
    }

    if (!nearest) {
      setHovered(null)
      setTooltip(null)
      return
    }

    const rows = data.series[nearest.category].flatMap((value, index) => value === null
      ? []
      : [{ color: nearest.color, label: `${index + 1}월`, separator: '  ', value }])
    const title = nearest.category === OTHER_SERIES_NAME && data.folded?.length
      ? `${OTHER_SERIES_NAME} · ${data.folded.join(', ')}`
      : nearest.category
    setHovered(nearest.category)
    setTooltip({ ...position, title, rows })
  }

  return (
    <div>
      <ChartLegendToggles
        hidden={hidden}
        items={data.categories.map((category, index) => ({ name: category, color: seriesColor(index, category) }))}
        label="분류 범례"
        onHover={setHovered}
        onToggle={toggle}
        renderExtra={detailHref ? (category) => (
          <Link
            aria-label={`${category} 상세 보기`}
            className="px-1.5 py-1 t-badge text-finance-faint hover:bg-finance-blue-tint hover:text-finance-blue"
            href={detailHref(category)}
          >
            상세
          </Link>
        ) : undefined}
      />
      <ChartFrame
        onLeave={() => {
          setHovered(null)
          setTooltip(null)
        }}
        tooltip={tooltip}
      >
        {(width) => (
          <svg aria-label="분류별 월간 추이" height={HEIGHT} role="img" viewBox={`0 0 ${width} ${HEIGHT}`} width={width}>
            <Grid maxValue={maxValue} width={width} />
            {data.categories.map((category, index) => {
              if (hidden.has(category)) return null
              const color = seriesColor(index, category)
              const points = coordinates(data.series[category], maxValue, 0, width)
              const dimmed = hovered !== null && hovered !== category
              const active = hovered === category
              return (
                <g key={category} opacity={dimmed ? DIMMED_OPACITY : 1}>
                  <path
                    aria-label={`${category} 월별 금액`}
                    className="chart-line-enter"
                    d={pathFor(points)}
                    fill="none"
                    pathLength={1}
                    pointerEvents="none"
                    stroke={color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={active ? LINE_WIDTH_ACTIVE : LINE_WIDTH}
                  />
                  {points.map((point, monthIndex) => point.y === null ? null : (
                    <circle
                      className="chart-point-enter"
                      cx={point.x}
                      cy={point.y}
                      fill={color}
                      key={monthIndex}
                      pointerEvents="none"
                      r={active ? POINT_RADIUS_ACTIVE : POINT_RADIUS}
                      style={{ animationDelay: `${180 + monthIndex * 28}ms` }}
                    />
                  ))}
                </g>
              )
            })}
            <rect
              aria-label="분류별 차트 hover 영역"
              fill="transparent"
              height={HEIGHT - TOP - BOTTOM}
              onPointerEnter={(event) => showNearestCategory(event, width)}
              onPointerMove={(event) => showNearestCategory(event, width)}
              width={plotWidthFor(width)}
              x={LEFT}
              y={TOP}
            />
          </svg>
        )}
      </ChartFrame>
    </div>
  )
}

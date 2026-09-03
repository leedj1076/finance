'use client'

import Link from 'next/link'
import { useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { CategoryMonthlyData } from './account-monthly'
import {
  BOTTOM,
  ChartLegendToggles,
  ChartPlaceholder,
  DIMMED_OPACITY,
  Grid,
  HEIGHT,
  LEFT,
  LINE_WIDTH,
  LINE_WIDTH_ACTIVE,
  OTHER_SERIES_NAME,
  POINT_RADIUS,
  POINT_RADIUS_ACTIVE,
  RIGHT,
  TOP,
  WIDTH,
  coordinates,
  pathFor,
  pointerPosition,
  seriesColor,
  useHydrated,
} from './chart-primitives'
import { ChartTooltip, type ChartTooltipState } from './chart-tooltip'

export function CategoryMonthlyChart({
  data,
  detailHref,
}: {
  data: CategoryMonthlyData
  detailHref?: (category: string) => string
}) {
  const hydrated = useHydrated()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const visibleCategories = data.categories.filter((category) => !hidden.has(category))
  const maxValue = Math.max(
    1,
    ...visibleCategories.flatMap((category) => data.series[category])
      .filter((value): value is number => value !== null),
  )

  if (!hydrated) return <ChartPlaceholder />

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

  function showNearestCategory(event: ReactPointerEvent<SVGElement>) {
    const position = pointerPosition(event)
    let nearest: { category: string; color: string; distance: number } | null = null

    for (const category of visibleCategories) {
      const points = coordinates(data.series[category], maxValue)
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
        const nearestX = start.x + progress * dx
        const nearestY = start.y + progress * dy
        distance = Math.min(distance, Math.hypot(position.x - nearestX, position.y - nearestY))
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
      <div
        className="relative min-w-[620px]"
        onPointerLeave={() => {
          setHovered(null)
          setTooltip(null)
        }}
      >
        <svg
          aria-label="분류별 월간 추이"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Grid maxValue={maxValue} />
          {data.categories.map((category, index) => {
            if (hidden.has(category)) return null
            const color = seriesColor(index, category)
            const points = coordinates(data.series[category], maxValue)
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
            onPointerEnter={showNearestCategory}
            onPointerMove={showNearestCategory}
            width={WIDTH - LEFT - RIGHT}
            x={LEFT}
            y={TOP}
          />
        </svg>
        <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
      </div>
    </div>
  )
}

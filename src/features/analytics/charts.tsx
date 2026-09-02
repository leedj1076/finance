'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'

import type { AccountMonthlyData, CategoryMonthlyData } from './account-monthly'
import { ChartTooltip, type ChartTooltipRow, type ChartTooltipState } from './chart-tooltip'
import { formatWon } from '@/lib/finance'

type MonthlyCashflow = {
  month: string
  income: number
  expense: number
  savingsRate: number
  active: boolean
}

type TrendPoint = {
  month: string
  amount: number
  active: boolean
}

const WIDTH = 760
const HEIGHT = 250
const LEFT = 54
const RIGHT = 18
const TOP = 18
const BOTTOM = 38
const PALETTE = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#B07AA1',
  '#EDC948', '#FF9DA7', '#9C755F', '#499894', '#79706E', '#A0CBE8',
  '#BAB0AC', '#8CD17D', '#B6992D', '#86BCB6', '#D37295',
]

const subscribe = () => () => undefined

function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

function ChartPlaceholder() {
  return <div aria-hidden className="h-[250px] min-w-[620px] animate-pulse rounded-xl bg-zinc-50" />
}

function compactWon(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  if (absolute >= 10_000) return `${Math.round(value / 10_000)}만`
  return formatWon(value)
}

function monthLabel(month: string, fallbackIndex: number) {
  const match = month.match(/(?:^|-)0?(\d{1,2})$/)
  return match ? `${Number(match[1])}월` : (month || `${fallbackIndex + 1}월`)
}

function coordinates(values: Array<number | null>, maxValue: number) {
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  return values.map((value, index) => ({
    x: LEFT + (plotWidth * index) / 11,
    y: value === null ? null : TOP + plotHeight - (value / maxValue) * plotHeight,
    value,
  }))
}

function pathFor(points: ReturnType<typeof coordinates>) {
  let path = ''
  let drawing = false
  for (const point of points) {
    if (point.y === null) {
      drawing = false
      continue
    }
    path += `${drawing ? ' L' : ' M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    drawing = true
  }
  return path
}

function pointerPosition(event: ReactPointerEvent<SVGElement>, width = WIDTH, height = HEIGHT) {
  const svg = event.currentTarget.ownerSVGElement
  if (!svg) return { x: 0, y: 0 }
  const bounds = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * width,
    y: ((event.clientY - bounds.top) / bounds.height) * height,
  }
}

function tooltipAt(
  event: ReactPointerEvent<SVGElement>,
  title: string,
  rows: ChartTooltipRow[],
) {
  return { ...pointerPosition(event), title, rows }
}

function Grid({ maxValue }: { maxValue: number }) {
  return (
    <g>
      {[0, 0.5, 1].map((ratio) => {
        const y = TOP + (HEIGHT - TOP - BOTTOM) * ratio
        const value = Math.round(maxValue * (1 - ratio))
        return (
          <g key={ratio}>
            <line stroke="#e4e4e7" strokeDasharray="3 4" x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
            <text fill="#a1a1aa" fontSize="10" textAnchor="end" x={LEFT - 8} y={y + 3}>
              {compactWon(value)}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 12 }, (_, index) => {
        const x = LEFT + ((WIDTH - LEFT - RIGHT) * index) / 11
        return (
          <text fill="#71717a" fontSize="10" key={index} textAnchor="middle" x={x} y={HEIGHT - 12}>
            {index + 1}월
          </text>
        )
      })}
    </g>
  )
}

export function MonthlyCashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const incomeValues = data.map((item) => item.active ? item.income : null)
  const expenseValues = data.map((item) => item.active ? item.expense : null)
  const maxValue = Math.max(1, ...incomeValues.filter((value): value is number => value !== null), ...expenseValues.filter((value): value is number => value !== null))
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = 17
  const barGap = 3

  if (!hydrated) return <ChartPlaceholder />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />수입</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" />지출</span>
      </div>
      <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
        <svg
          aria-label="월별 수입과 지출 막대 차트"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Grid maxValue={maxValue} />
          {data.map((item, index) => {
            if (!item.active) return null
            const center = LEFT + (plotWidth * index) / 11
            const displayMonth = monthLabel(item.month, index)
            return ([
              { color: '#2563eb', label: '수입', value: item.income, x: center - barWidth - barGap / 2 },
              { color: '#e11d48', label: '지출', value: item.expense, x: center + barGap / 2 },
            ]).map((bar) => {
              const height = (bar.value / maxValue) * plotHeight
              return (
                <rect
                  aria-label={`${displayMonth} ${bar.label} ${formatWon(bar.value)}원`}
                  className="chart-bar-enter"
                  fill={bar.color}
                  height={height}
                  key={`${bar.label}-${index}`}
                  onPointerEnter={(event) => setTooltip(tooltipAt(event, displayMonth, [{ color: bar.color, label: bar.label, value: bar.value }]))}
                  onPointerMove={(event) => setTooltip(tooltipAt(event, displayMonth, [{ color: bar.color, label: bar.label, value: bar.value }]))}
                  rx="3"
                  width={barWidth}
                  x={bar.x}
                  y={TOP + plotHeight - height}
                  style={{ animationDelay: `${index * 35}ms` }}
                />
              )
            })
          })}
        </svg>
        <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
      </div>
    </div>
  )
}

export function AccountMonthlyChart({ data }: { data: AccountMonthlyData }) {
  const hydrated = useHydrated()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const visibleAccounts = data.accounts.filter((account) => !hidden.has(account))
  const monthTotals = Array.from({ length: 12 }, (_, index) => data.accounts.reduce(
    (sum, account) => sum + (hidden.has(account) ? 0 : (data.series[account][index] ?? 0)),
    0,
  ))
  const maxValue = Math.max(1, ...monthTotals)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = 32

  if (!hydrated) return <ChartPlaceholder />

  function toggle(account: string) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
    setTooltip(null)
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-zinc-600">
        {data.accounts.map((account, index) => (
          <button
            aria-pressed={!hidden.has(account)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 transition-opacity ${hidden.has(account) ? 'border-zinc-200 bg-zinc-100 text-zinc-400 line-through' : 'border-transparent'}`}
            key={account}
            onClick={() => toggle(account)}
            type="button"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
            {account}
          </button>
        ))}
      </div>
      <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
        <svg
          aria-label="결제수단별 월간 금액 누적 막대 차트"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <Grid maxValue={maxValue} />
          {Array.from({ length: 12 }, (_, monthIndex) => {
            let cumulative = 0
            return visibleAccounts.map((account) => {
              const accountIndex = data.accounts.indexOf(account)
              const value = data.series[account][monthIndex]
              if (value === null || value <= 0) return null
              const previous = cumulative
              cumulative += value
              const x = LEFT + (plotWidth * monthIndex) / 11 - barWidth / 2
              const y = TOP + plotHeight - (cumulative / maxValue) * plotHeight
              const height = ((cumulative - previous) / maxValue) * plotHeight
              const color = PALETTE[accountIndex % PALETTE.length]
              return (
                <rect
                  aria-label={`${monthIndex + 1}월 ${account} ${formatWon(value)}원`}
                  className="chart-bar-enter"
                  fill={color}
                  height={height}
                  key={`${account}-${monthIndex}`}
                  onPointerEnter={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, [{ color, label: account, value }]))}
                  onPointerMove={(event) => setTooltip(tooltipAt(event, `${monthIndex + 1}월`, [{ color, label: account, value }]))}
                  rx="2"
                  width={barWidth}
                  x={x}
                  y={y}
                  style={{ animationDelay: `${monthIndex * 35}ms` }}
                />
              )
            })
          })}
        </svg>
        <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
      </div>
    </div>
  )
}

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

      const color = PALETTE[data.categories.indexOf(category) % PALETTE.length]
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
    setHovered(nearest.category)
    setTooltip({ ...position, title: nearest.category, rows })
  }

  return (
    <div>
      <div aria-label="분류 범례" className="mb-4 flex flex-wrap gap-2" role="group">
        {data.categories.map((category, index) => {
          const visible = !hidden.has(category)
          return (
            <span className="inline-flex items-center gap-1" key={category}>
              <button
                aria-pressed={visible}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity ${visible ? 'border-zinc-200 bg-white text-zinc-700' : 'border-zinc-200 bg-zinc-100 text-zinc-400 line-through'}`}
                onBlur={() => setHovered(null)}
                onClick={() => toggle(category)}
                onFocus={() => visible && setHovered(category)}
                onMouseEnter={() => visible && setHovered(category)}
                onMouseLeave={() => setHovered(null)}
                type="button"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                {category}
              </button>
              {detailHref && (
                <Link
                  aria-label={`${category} 상세 보기`}
                  className="rounded-full px-1.5 py-1 text-[10px] font-medium text-zinc-400 hover:bg-emerald-50 hover:text-emerald-700"
                  href={detailHref(category)}
                >
                  상세
                </Link>
              )}
            </span>
          )
        })}
      </div>
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
            const color = PALETTE[index % PALETTE.length]
            const points = coordinates(data.series[category], maxValue)
            const dimmed = hovered !== null && hovered !== category
            const active = hovered === category
            return (
              <g key={category} opacity={dimmed ? 0.16 : 1}>
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
                  strokeWidth={active ? 3.5 : 2}
                />
                {points.map((point, monthIndex) => point.y === null ? null : (
                  <circle
                    className="chart-point-enter"
                    cx={point.x}
                    cy={point.y}
                    fill={color}
                    key={monthIndex}
                    pointerEvents="none"
                    r={active ? 3.5 : 2.2}
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

export function FlowTrendChart({ data, label, tone }: { data: TrendPoint[]; label: string; tone: 'blue' | 'emerald' | 'rose' }) {
  const hydrated = useHydrated()
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null)
  const values = data.map((item) => item.active ? item.amount : null)
  const maxValue = Math.max(1, ...values.filter((value): value is number => value !== null))
  const points = coordinates(values, maxValue)
  const color = tone === 'blue' ? '#2563eb' : tone === 'emerald' ? '#059669' : '#e11d48'

  if (!hydrated) return <ChartPlaceholder />

  const hitWidth = (WIDTH - LEFT - RIGHT) / 12

  return (
    <div className="relative min-w-[620px]" onPointerLeave={() => setTooltip(null)}>
      <svg
        aria-label={`월별 ${label} 추이`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <Grid maxValue={maxValue} />
        <path className="chart-line-enter" d={pathFor(points)} fill="none" pathLength={1} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {points.map((point, index) => point.y === null ? null : (
          <circle className="chart-point-enter" cx={point.x} cy={point.y} fill={color} key={index} pointerEvents="none" r="4" style={{ animationDelay: `${180 + index * 35}ms` }} />
        ))}
        {points.map((point, index) => point.y === null ? null : (
          <rect
            aria-label={`${monthLabel(data[index].month, index)} ${label} ${formatWon(point.value ?? 0)}원`}
            fill="transparent"
            height={HEIGHT - TOP - BOTTOM}
            key={`hit-${index}`}
            onPointerEnter={(event) => setTooltip(tooltipAt(event, monthLabel(data[index].month, index), [{ color, label, value: point.value ?? 0 }]))}
            onPointerMove={(event) => setTooltip(tooltipAt(event, monthLabel(data[index].month, index), [{ color, label, value: point.value ?? 0 }]))}
            width={hitWidth}
            x={Math.max(LEFT, point.x - hitWidth / 2)}
            y={TOP}
          />
        ))}
      </svg>
      <ChartTooltip chartHeight={HEIGHT} chartWidth={WIDTH} tooltip={tooltip} />
    </div>
  )
}

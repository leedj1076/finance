'use client'

import { useState, useSyncExternalStore } from 'react'

import type { AccountMonthlyData, CategoryMonthlyData } from './account-monthly'
import { formatRate, formatWon } from '@/lib/finance'

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
  const incomeValues = data.map((item) => item.active ? item.income : null)
  const expenseValues = data.map((item) => item.active ? item.expense : null)
  const maxValue = Math.max(1, ...incomeValues.filter((value): value is number => value !== null), ...expenseValues.filter((value): value is number => value !== null))
  const incomePoints = coordinates(incomeValues, maxValue)
  const expensePoints = coordinates(expenseValues, maxValue)

  if (!hydrated) return <ChartPlaceholder />

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />수입</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" />지출</span>
      </div>
      <svg
        aria-label="월별 수입과 지출 추이"
        className="h-auto w-full min-w-[620px]"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <Grid maxValue={maxValue} />
        <path d={pathFor(incomePoints)} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d={pathFor(expensePoints)} fill="none" stroke="#e11d48" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {incomePoints.map((point, index) => point.y === null ? null : (
          <circle cx={point.x} cy={point.y} fill="#2563eb" key={`income-${index}`} r="4">
            <title>{data[index].month} 수입 {formatWon(point.value ?? 0)}원</title>
          </circle>
        ))}
        {expensePoints.map((point, index) => point.y === null ? null : (
          <circle cx={point.x} cy={point.y} fill="#e11d48" key={`expense-${index}`} r="4">
            <title>{data[index].month} 지출 {formatWon(point.value ?? 0)}원 · 순저축률 {formatRate(data[index].savingsRate)}%</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

export function AccountMonthlyChart({ data }: { data: AccountMonthlyData }) {
  const hydrated = useHydrated()
  const monthTotals = Array.from({ length: 12 }, (_, index) => data.accounts.reduce(
    (sum, account) => sum + (data.series[account][index] ?? 0),
    0,
  ))
  const maxValue = Math.max(1, ...monthTotals)
  const plotHeight = HEIGHT - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const barWidth = 32

  if (!hydrated) return <ChartPlaceholder />

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-zinc-600">
        {data.accounts.map((account, index) => (
          <span className="flex items-center gap-1.5" key={account}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
            {account}
          </span>
        ))}
      </div>
      <svg
        aria-label="결제수단별 월간 금액 누적 막대 차트"
        className="h-auto w-full min-w-[620px]"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <Grid maxValue={maxValue} />
        {Array.from({ length: 12 }, (_, monthIndex) => {
          let cumulative = 0
          return data.accounts.map((account, accountIndex) => {
            const value = data.series[account][monthIndex]
            if (value === null || value <= 0) return null
            const previous = cumulative
            cumulative += value
            const x = LEFT + (plotWidth * monthIndex) / 11 - barWidth / 2
            const y = TOP + plotHeight - (cumulative / maxValue) * plotHeight
            const height = ((cumulative - previous) / maxValue) * plotHeight
            return (
              <rect
                fill={PALETTE[accountIndex % PALETTE.length]}
                height={height}
                key={`${account}-${monthIndex}`}
                rx="2"
                width={barWidth}
                x={x}
                y={y}
              >
                <title>{monthIndex + 1}월 {account} {formatWon(value)}원</title>
              </rect>
            )
          })
        })}
      </svg>
    </div>
  )
}

export function CategoryMonthlyChart({ data }: { data: CategoryMonthlyData }) {
  const hydrated = useHydrated()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)
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
  }

  return (
    <div>
      <div aria-label="분류 범례" className="mb-4 flex flex-wrap gap-2" role="group">
        {data.categories.map((category, index) => {
          const visible = !hidden.has(category)
          return (
            <button
              aria-pressed={visible}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-opacity ${visible ? 'border-zinc-200 bg-white text-zinc-700' : 'border-zinc-200 bg-zinc-100 text-zinc-400 line-through'}`}
              key={category}
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
          )
        })}
      </div>
      <svg
        aria-label="분류별 월간 추이"
        className="h-auto w-full min-w-[620px]"
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
            <g
              key={category}
              onMouseEnter={() => setHovered(category)}
              onMouseLeave={() => setHovered(null)}
              opacity={dimmed ? 0.16 : 1}
            >
              <path
                d={pathFor(points)}
                fill="none"
                pointerEvents="stroke"
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={active ? 3.5 : 2}
              />
              {points.map((point, monthIndex) => point.y === null ? null : (
                <circle
                  cx={point.x}
                  cy={point.y}
                  fill={color}
                  key={monthIndex}
                  r={active ? 3.5 : 2.2}
                >
                  <title>{category} · {monthIndex + 1}월 {formatWon(point.value ?? 0)}원</title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function FlowTrendChart({ data, label, tone }: { data: TrendPoint[]; label: string; tone: 'blue' | 'emerald' | 'rose' }) {
  const hydrated = useHydrated()
  const values = data.map((item) => item.active ? item.amount : null)
  const maxValue = Math.max(1, ...values.filter((value): value is number => value !== null))
  const points = coordinates(values, maxValue)
  const color = tone === 'blue' ? '#2563eb' : tone === 'emerald' ? '#059669' : '#e11d48'

  if (!hydrated) return <ChartPlaceholder />

  return (
    <svg
      aria-label={`월별 ${label} 추이`}
      className="h-auto w-full min-w-[620px]"
      role="img"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <Grid maxValue={maxValue} />
      <path d={pathFor(points)} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      {points.map((point, index) => point.y === null ? null : (
        <circle cx={point.x} cy={point.y} fill={color} key={index} r="4">
          <title>{data[index].month} {label} {formatWon(point.value ?? 0)}원</title>
        </circle>
      ))}
    </svg>
  )
}

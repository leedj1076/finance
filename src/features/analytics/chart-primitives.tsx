'use client'

import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'

import { formatWon } from '@/lib/finance'

import type { ChartTooltipRow } from './chart-tooltip'

export const WIDTH = 760
export const HEIGHT = 250
export const LEFT = 54
export const RIGHT = 18
export const TOP = 18
export const BOTTOM = 38
export const PALETTE = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#B07AA1',
  '#EDC948', '#FF9DA7', '#9C755F', '#499894', '#79706E', '#A0CBE8',
  '#BAB0AC', '#8CD17D', '#B6992D', '#86BCB6', '#D37295',
]

const subscribe = () => () => undefined

export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

export function ChartPlaceholder() {
  return <div aria-hidden className="h-[250px] min-w-[620px] animate-pulse rounded-xl bg-zinc-50" />
}

export function compactWon(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`
  if (absolute >= 10_000) return `${Math.round(value / 10_000)}만`
  return formatWon(value)
}

export function monthLabel(month: string, fallbackIndex: number) {
  const match = month.match(/(?:^|-)0?(\d{1,2})$/)
  return match ? `${Number(match[1])}월` : (month || `${fallbackIndex + 1}월`)
}

export function coordinates(values: Array<number | null>, maxValue: number) {
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  return values.map((value, index) => ({
    x: LEFT + (plotWidth * index) / 11,
    y: value === null ? null : TOP + plotHeight - (value / maxValue) * plotHeight,
    value,
  }))
}

export function pathFor(points: ReturnType<typeof coordinates>) {
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

export function pointerPosition(event: ReactPointerEvent<SVGElement>, width = WIDTH, height = HEIGHT) {
  const svg = event.currentTarget.ownerSVGElement
  if (!svg) return { x: 0, y: 0 }
  const bounds = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * width,
    y: ((event.clientY - bounds.top) / bounds.height) * height,
  }
}

export function tooltipAt(
  event: ReactPointerEvent<SVGElement>,
  title: string,
  rows: ChartTooltipRow[],
) {
  return { ...pointerPosition(event), title, rows }
}

export function Grid({ maxValue }: { maxValue: number }) {
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

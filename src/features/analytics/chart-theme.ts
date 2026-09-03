import { formatWon } from '@/lib/finance'

// Shared chart geometry and marks. Pure module so server components (home
// charts) and client components (interactive charts) read the same values.
// Visual rules: docs/design/swiss-ledger/chart-specs.html

export const WIDTH = 760
export const HEIGHT = 250
export const LEFT = 54
export const RIGHT = 18
export const TOP = 18
export const BOTTOM = 38
// Inner horizontal padding of the plot so the first and last marks (a 32px
// stacked bar is 16px either side of its center) stay clear of the axis
// labels and the right edge. Every chart's x positions go through xAt().
export const PLOT_INSET = 20

export const LINE_WIDTH = 2
export const LINE_WIDTH_ACTIVE = 2.5
export const LINE_WIDTH_SECONDARY = 1.5
export const REFERENCE_LINE_WIDTH = 1.5
export const POINT_RADIUS = 3
export const POINT_RADIUS_ACTIVE = 4
export const BAR_PAIR_WIDTH = 17
export const BAR_PAIR_GAP = 3
export const BAR_STACK_WIDTH = 32
export const DIMMED_OPACITY = 0.16

// Categorical series: fixed order, never cycled. The extended palette keeps
// the full household taxonomy distinguishable when annual stats show every
// major category; "그 외" remains a dedicated neutral color for folded axes.
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
  'var(--chart-9)',
  'var(--chart-10)',
  'var(--chart-11)',
  'var(--chart-12)',
  'var(--chart-13)',
  'var(--chart-14)',
  'var(--chart-15)',
  'var(--chart-16)',
  'var(--chart-17)',
  'var(--chart-18)',
] as const
export const CHART_OTHER = 'var(--chart-other)'
export const OTHER_SERIES_NAME = '그 외'

export function seriesColor(index: number, name?: string) {
  if (name === OTHER_SERIES_NAME || index >= CHART_SERIES.length) return CHART_OTHER
  return CHART_SERIES[index]
}

// Role colors are fixed meanings (income/expense/saving/over/warn) and are
// never reused as series colors.
export const ROLE = {
  income: 'var(--finance-blue)',
  expense: 'var(--finance-ink)',
  saving: 'var(--finance-green)',
  over: 'var(--finance-red)',
  warn: 'var(--finance-amber)',
  ink: 'var(--finance-ink)',
  muted: 'var(--finance-muted)',
  faint: 'var(--finance-faint)',
  grid: 'var(--finance-border)',
  track: 'var(--finance-track)',
} as const

// x of the index-th of `count` evenly spaced marks inside the inset plot.
export function xAt(index: number, count: number, width: number) {
  const inner = width - LEFT - RIGHT - PLOT_INSET * 2
  return LEFT + PLOT_INSET + (inner * index) / Math.max(count - 1, 1)
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

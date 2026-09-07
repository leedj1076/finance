import { formatWon } from '@/lib/finance'

// Shared chart vocabulary: series colors, role colors, and the value and
// month formatters. Chart.js owns plot geometry now; the two stroke sizes
// below are for the hand-drawn SVG sparkline and savings ring on 홈.
// Visual rules: docs/design/swiss-ledger/chart-specs.html

export const LINE_WIDTH = 2
export const POINT_RADIUS = 3
export const DIMMED_OPACITY = 0.16

// Categorical series: fixed order, never cycled. 1-6 are the pairs validated
// against color-vision deficiency; 7-18 extend the ramp so an annual stats
// table can label every major category, and are weaker at telling adjacent
// series apart. Fold to a top-N plus "그 외" when the chart itself has to
// carry the distinction.
const CHART_SERIES = [
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

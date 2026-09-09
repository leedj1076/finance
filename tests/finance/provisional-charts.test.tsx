import { renderToStaticMarkup } from 'react-dom/server'
import type { ChartData } from 'chart.js'
import { afterEach, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({ bars: [] as ChartData<'bar'>[], lines: [] as ChartData<'line'>[] }))
vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: ChartData<'bar'> }) => { captured.bars.push(data); return null },
  Line: ({ data }: { data: ChartData<'line'> }) => { captured.lines.push(data); return null },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { AnnualFlowOverview, type AnnualFlowRow } from '@/features/analytics/annual-flow-overview'
import { SeriesChart } from '@/features/analytics/series-chart'
import * as chartStyles from '@/features/analytics/chart-js'
import { SavingsProgressRing } from '@/features/analytics/home-dashboard-charts'
import type { StatsMonthState } from '@/features/analytics/category-detail'
import { StatsMonthlySection } from '@/features/analytics/stats-monthly-section'

afterEach(() => { captured.bars.length = 0; captured.lines.length = 0; vi.unstubAllGlobals() })

const states: StatsMonthState[] = ['closed', 'open', 'needs_review', 'closed', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future']
const monthly = states.map((state, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`, state, active: state !== 'future',
  hasTransactions: index < 3, income: index < 3 ? 100 : 0, expense: index < 3 ? 60 : 0,
  saving: index < 3 ? 10 : 0, savingsRate: index < 3 ? 40 : 0,
})) as AnnualFlowRow[]

test('annual chart keeps explicit closed zero, gaps absent open/current/future, and marks provisional bars and points', () => {
  const html = renderToStaticMarkup(<AnnualFlowOverview monthly={monthly} annualRate={40} provisionalRate={35} savingsTarget={30} />)
  const bar = captured.bars[0].datasets[0]
  expect(bar.data).toEqual([100, 100, 100, 0, null, null, null, null, null, null, null, null])
  expect(bar.backgroundColor).toEqual(['#2563eb', '#a1a1aa', '#a1a1aa', '#2563eb', '#a1a1aa', '#a1a1aa', '#a1a1aa', '#a1a1aa', '#a1a1aa', '#a1a1aa', '#a1a1aa', '#a1a1aa'])
  expect((bar.borderColor as string[])[1]).toBe('#a1a1aa')
  const line = captured.lines[0].datasets[0]
  expect(line.data).toEqual([40, 40, 40, 0, null, null, null, null, null, null, null, null])
  expect(captured.lines[0].datasets[1].data).toEqual([30, 30, 30, 30, null, null, null, null, null, null, null, null])
  expect((line.pointBackgroundColor as string[]).slice(0, 4)).toEqual(['#16a34a', '#ffffff', '#ffffff', '#16a34a'])
  const dash = (line.segment as { borderDash: (context: unknown) => unknown }).borderDash
  expect(dash({ p0DataIndex: 0, p1DataIndex: 3 })).toBeUndefined()
  expect(dash({ p0DataIndex: 0, p1DataIndex: 1 })).toEqual([5, 4])
  expect(captured.bars[0].labels).toContain('6월·진행 중')
  expect(html).toContain('미마감 · 잠정')
  expect(html).toContain('마감 2개월')
  expect(html).toContain('잠정 포함 35.0%')
})

test.each(['stacked', 'line', 'area'] as const)('series %s preserves nulls and applies provisional fill or dashed hollow marks', kind => {
  renderToStaticMarkup(<SeriesChart kind={kind} monthStates={states} currentMonthIndex={5} activeMonths={6}
    series={[{ id: 'food', label: '식비', color: 'var(--chart-1)', values: [40, 60, 20, 0, null, 10, 500] }]}
    hoverSeries={null} hoverMonth={null} selectedSeries={null} selectedMonth={null} onHover={() => {}} onSelect={() => {}} />)
  const data = kind === 'stacked' ? captured.bars[0] : captured.lines[0]
  const dataset = data.datasets[0]
  expect(dataset.data.slice(3)).toEqual([0, null, kind === 'area' ? 100 : 10, null, null, null, null, null, null])
  if (kind === 'stacked') {
    expect((dataset.backgroundColor as string[])[1]).toBe('#a1a1aa')
    expect((dataset.borderColor as string[])[1]).toBe('#a1a1aa')
  } else {
    const line = captured.lines[0].datasets[0]
    expect((line.pointBackgroundColor as string[])[1]).toBe('#ffffff')
    expect((line.segment as { borderDash: (context: unknown) => unknown }).borderDash({ p0DataIndex: 0, p1DataIndex: 1 })).toEqual([5, 4])
  }
})

test('hatch has an SSR fallback and builds a faint diagonal repeating canvas pattern', () => {
  const palette = { faint: '#aaa', background: '#fff' } as chartStyles.FinanceChartPalette
  expect(chartStyles.provisionalPattern(palette)).toBe('#aaa')
  const pattern = {} as CanvasPattern
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 0, fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), createPattern: vi.fn(() => pattern) }
  const canvas = { width: 0, height: 0, getContext: () => context }
  vi.stubGlobal('document', { createElement: () => canvas })
  expect(chartStyles.provisionalPattern(palette)).toBe(pattern)
  expect(context.strokeStyle).toBe('#aaa')
  expect(context.moveTo).toHaveBeenCalledWith(-1, 7)
  expect(context.lineTo).toHaveBeenCalledWith(7, -1)
  expect(context.createPattern).toHaveBeenCalledWith(canvas, 'repeat')
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
  expect(chartStyles.provisionalPattern(palette)).toBe('#aaa')
})

test('provisional ring dims numeric text and marks without changing progress geometry or the default home ring', () => {
  const solid = renderToStaticMarkup(<SavingsProgressRing value={40} target={30} />)
  const provisional = renderToStaticMarkup(<SavingsProgressRing value={40} target={30} provisional />)
  expect(solid).toContain('stroke="var(--finance-green)"')
  expect(provisional).toContain('stroke="var(--finance-faint)"')
  expect(provisional).toMatch(/<text[^>]*fill="var\(--finance-faint\)"[^>]*>40.0%/)
  expect(provisional.match(/stroke-dasharray="([^"]+)"/)?.[1]).toBe(solid.match(/stroke-dasharray="([^"]+)"/)?.[1])
})

test('monthly chart labels all twelve calendar columns before selection and keeps current italic and absent values null', () => {
  const detail = { groups: [{ major: '식비', subs: [{ sub: '외식', months: [40, 60, 20, 0, 0, 10, 0, 0, 0, 0, 0, 0] }] }],
    months: [1, 2, 3, 4, 5], divisor: 2, currentMonth: 6, closedMonths: [1, 4], endedMonths: [1, 2, 3, 4, 5],
    recordedMonths: [1, 2, 3, 6], provisionalMonths: [1, 2, 3, 4], provisionalDivisor: 4, states }
  const html = renderToStaticMarkup(<StatsMonthlySection year={2026} details={{ expense: detail, income: detail, saving: detail }} accountMonthly={{ expense: { accounts: [], series: {} }, income: { accounts: [], series: {} } }} />)
  expect(html).toContain('2월·잠정')
  expect(html).toMatch(/class="[^"]*italic[^"]*">6월·진행 중/)
  expect(html).toContain('12월')
  expect(captured.bars[0].datasets[0].data).toEqual([40, 60, 20, 0, null, 10, null, null, null, null, null, null])
})

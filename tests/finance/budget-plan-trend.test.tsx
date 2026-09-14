import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { PlanTrend } from '@/features/budgets/plan-trend'

const trend = [
  { month: '2026-06', amount: 1_298_653, closed: true, revision: 7 },
  { month: '2026-07', amount: 1_253_700, closed: true, revision: 2 },
  { month: '2026-08', amount: 1_257_831, closed: false, revision: 4 },
]

function render(overrides: Partial<Parameters<typeof PlanTrend>[0]> = {}) {
  return renderToStaticMarkup(createElement(PlanTrend, {
    major: '식비',
    previousActualMonth: '2026-09',
    trend,
    ...overrides,
  }))
}

describe('PlanTrend', () => {
  test('shows every trend month oldest first', () => {
    const html = render()
    expect(html.indexOf('6월')).toBeLessThan(html.indexOf('7월'))
    expect(html.indexOf('7월')).toBeLessThan(html.indexOf('8월'))
    expect(html).toContain('1,298,653')
    expect(html).toContain('1,257,831')
  })

  test('marks the month that is also the previous-actual row', () => {
    expect(render({ previousActualMonth: '2026-08' })).toContain('8월 · 지난달')
    expect(render()).not.toContain('· 지난달')
  })

  test('does not write a provisional tag in the header', () => {
    expect(render()).not.toContain('잠정')
  })

  test('writes zero for a closed month with no spend and a dash for an open one', () => {
    const html = render({ trend: [
      { month: '2026-06', amount: 0, closed: true, revision: 1 },
      { month: '2026-07', amount: 0, closed: false, revision: 1 },
    ] })
    expect(html).toContain('>0<')
    expect(html).toContain('>–<')
  })

  test('says so when there is nothing recorded', () => {
    expect(render({ trend: [] })).toContain('기록 없음')
  })

  test('labels each cell for screen readers without a pressed state', () => {
    const html = render()
    expect(html).toContain('식비 6월 1,298,653원, 거래 목록 보기')
    expect(html).not.toContain('aria-pressed')
  })
})

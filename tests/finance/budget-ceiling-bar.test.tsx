import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import { CeilingBar } from '@/features/budgets/ceiling-bar'
import { spendingCeilingForTarget } from '@/features/budgets/plan-calculations'

const basis = {
  averageIncome: 6_115_000,
  incomeStart: '2026-01-01',
  incomeEnd: '2026-09-01',
  incomeMonthCount: 8,
}

function render(overrides: Partial<Parameters<typeof CeilingBar>[0]> = {}) {
  return renderToStaticMarkup(createElement(CeilingBar, {
    target: 30,
    basis,
    total: 1_840_000,
    ceiling: 4_280_500,
    dirty: false,
    pending: false,
    disabled: false,
    onTargetChange: vi.fn(),
    ...overrides,
  }))
}

function textFrom(html: string) {
  return html.replace(/<[^>]+>/g, '')
}

type RangeElementProps = {
  children?: ReactNode
  onChange?: (event: { target: { value: string } }) => void
  type?: string
}

function findRange(node: ReactNode): ReactElement<RangeElementProps> | null {
  if (!isValidElement<RangeElementProps>(node)) return null
  if (node.type === 'input' && node.props.type === 'range') return node
  for (const child of Array.isArray(node.props.children) ? node.props.children : [node.props.children]) {
    const match = findRange(child)
    if (match) return match
  }
  return null
}

test('keeps the canonical server ceiling while the savings target is unchanged', () => {
  expect(spendingCeilingForTarget({
    averageIncome: 1_001,
    initialSavingsTarget: 30,
    savingsTarget: 30,
    serverSpendCeiling: 701,
  })).toBe(701)
})

test('recalculates a changed target with the existing ties-to-even rounding', () => {
  expect(spendingCeilingForTarget({
    averageIncome: 1_001,
    initialSavingsTarget: 30,
    savingsTarget: 50,
    serverSpendCeiling: 701,
  })).toBe(500)
})

test('a changed target produces a zero ceiling when income is zero', () => {
  expect(spendingCeilingForTarget({
    averageIncome: 0,
    initialSavingsTarget: 30,
    savingsTarget: 50,
    serverSpendCeiling: 0,
  })).toBe(0)
})

describe('CeilingBar', () => {
  test('renders the desktop and compact totals with a clean disabled save action', () => {
    const html = render()

    const text = textFrom(html)

    expect(html).toContain('목표 지출 상한')
    expect(html).toContain('4,280,500')
    expect(html).toContain('편집안 합계')
    expect(html).toContain('1,840,000')
    expect(html).toContain('여유 2,440,500')
    expect(text).toContain('상한 428만 · 합계 184만 · 여유 244만')
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*type="submit"[^>]*>.*저장됨.*<\/button>/)
  })

  test('shows an unsaved marker and enabled save action for a dirty draft', () => {
    const html = render({ dirty: true })

    expect(html).toContain('아직 저장하지 않은 편집안')
    expect(html).toContain('변경사항 저장')
    expect(html).toMatch(/<button(?![^>]+disabled="")[^>]*type="submit"/)
  })

  test('flags an invalid total instead of calculating a misleading balance', () => {
    const html = render({ total: null })

    expect(html).toContain('입력 확인 필요')
    expect(html).toContain('text-finance-amber')
    expect(html).not.toContain('여유 4,280,500')
  })

  test('reports overage with its absolute amount', () => {
    const html = render({ ceiling: 1_720_000, total: 1_840_000 })

    expect(html).toContain('초과 120,000')
    expect(html).toContain('text-finance-red')
  })

  test('uses a native dismissible popover for the bounded target and explains its arithmetic', () => {
    const html = render()

    const text = textFrom(html)

    expect(html).toMatch(/<button[^>]+aria-haspopup="dialog"[^>]+popoverTarget="savings-target-popover"/)
    expect(html).toMatch(/<div[^>]+id="savings-target-popover"[^>]+popover="auto"[^>]+role="dialog"/)
    expect(html).toMatch(/<input[^>]+aria-label="목표 저축률"[^>]+max="80"[^>]+min="0"[^>]+step="1"[^>]+type="range"/)
    expect(html).toContain('30%')
    expect(text).toContain('월평균 수입 6,115,000 × (1 − 30%) = 상한 4,280,500')
    expect(text).toContain('8개월 수입 기준 (2026-01 ~ 2026-08)')
    expect(html).toContain('편집안대로면 예상 순저축률')
    expect(html).toContain('69.9%')
    expect(html).toContain('저축률 변경도 저장 버튼으로 함께 저장됩니다.')
  })

  test('marks the desktop trigger as the popover anchor and renders the target as a large value', () => {
    const html = render()

    expect(html).toMatch(/<button[^>]+class="[^"]*ceiling-bar__target-anchor[^"]*"[^>]+popoverTarget="savings-target-popover"/)
    expect(html).toMatch(/<output[^>]+class="t-kpi-sm"[^>]*>30%<\/output>/)
  })

  test('keeps zero-income arithmetic finite', () => {
    const html = render({
      basis: { ...basis, averageIncome: 0, incomeMonthCount: 0 },
      ceiling: 0,
      total: 0,
    })

    const text = textFrom(html)

    expect(text).toContain('월평균 수입 0 × (1 − 30%) = 상한 0')
    expect(html).toContain('0.0%')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('Infinity')
  })

  test('reports the controlled slider value as an integer target', () => {
    const onTargetChange = vi.fn()
    const slider = findRange(CeilingBar({
      target: 30,
      basis,
      total: 1_840_000,
      ceiling: 4_280_500,
      dirty: false,
      pending: false,
      disabled: false,
      onTargetChange,
    }))

    slider?.props.onChange?.({ target: { value: '47' } })

    expect(onTargetChange).toHaveBeenCalledWith(47)
  })
})

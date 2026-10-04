import { describe, expect, it } from 'vitest'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'

describe('investment formatters', () => {
  it('formats won without decimals and dollars with two', () => {
    expect(formatMoney(9408000, 'KRW')).toBe('9,408,000')
    expect(formatMoney(1965.75, 'USD')).toBe('$1,965.75')
    expect(formatMoney(6444, 'USD')).toBe('$6,444.00')
  })
  it('uses a real minus and keeps displayed zero unsigned', () => {
    expect(formatSigned(864000, 'KRW')).toBe('+864,000')
    expect(formatSigned(-420000, 'KRW')).toBe('−420,000')
    expect(formatSigned(-12.3, 'USD')).toBe('−$12.30')
    expect(formatSigned(0, 'KRW')).toBe('0')
    expect(formatSigned(-0.001, 'USD')).toBe('0')
    expect(formatMoney(-0.01, 'KRW')).toBe('0')
    expect(formatMoney(-0.001, 'USD')).toBe('$0.00')
  })
  it('formats percentages to one decimal and dashes null', () => {
    expect(formatPct(10.06)).toBe('+10.1%')
    expect(formatPct(-5.84)).toBe('−5.8%')
    expect(formatPct(0)).toBe('0.0%')
    expect(formatPct(-0.001)).toBe('0.0%')
    expect(formatPct(null)).toBe('–')
  })
  it.each([NaN, Infinity, -Infinity])('shows missing instead of non-finite %s', (value) => {
    expect(formatMoney(value, 'KRW')).toBe('–')
    expect(formatMoney(value, 'USD')).toBe('–')
    expect(formatSigned(value, 'KRW')).toBe('–')
    expect(formatPct(value)).toBe('–')
  })
})

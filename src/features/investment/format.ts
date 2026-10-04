import { formatWon } from '@/lib/finance'

import type { Currency } from './types'

const MINUS = '−'
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function displayedZero(value: number, currency: Currency) {
  return currency === 'USD' ? Number(Math.abs(value).toFixed(2)) === 0 : Math.round(Math.abs(value)) === 0
}

export function formatMoney(value: number, currency: Currency) {
  if (!Number.isFinite(value)) return '–'
  const abs = Math.abs(value)
  const body = currency === 'USD' ? `$${usd.format(abs)}` : formatWon(abs)
  return value < 0 && !displayedZero(value, currency) ? `${MINUS}${body}` : body
}

export function formatSigned(value: number, currency: Currency) {
  if (!Number.isFinite(value)) return '–'
  if (displayedZero(value, currency)) return '0'
  return value > 0 ? `+${formatMoney(value, currency)}` : formatMoney(value, currency)
}

export function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '–'
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0.0%'
  const body = `${Math.abs(rounded).toFixed(1)}%`
  return rounded > 0 ? `+${body}` : `${MINUS}${body}`
}

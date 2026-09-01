const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonthKey(value: string | undefined): value is string {
  return Boolean(value && MONTH_PATTERN.test(value))
}

export function shiftMonth(month: string, delta: number) {
  if (!isMonthKey(month)) throw new Error(`invalid month: ${month}`)

  const [year, monthNumber] = month.split('-').map(Number)
  const index = year * 12 + monthNumber - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function monthBounds(month: string) {
  if (!isMonthKey(month)) throw new Error(`invalid month: ${month}`)
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` }
}

export function currentMonthInKorea(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7)
}

export function savingsRate(income: number, expense: number) {
  if (income <= 0) return 0
  return ((income - expense) / income) * 100
}

export function formatWon(value: number) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(value))
}

export function formatRate(value: number) {
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

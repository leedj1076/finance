import { currentMonthInKorea } from '@/lib/finance'

export type MonthPace = {
  elapsed: number
  daysInMonth: number
  ratio: number
  percent: number
}

export function calculateMonthPace(
  month: string,
  today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
): MonthPace {
  const [year, monthNumber] = month.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const todayMonth = today.slice(0, 7)
  const elapsed = month < todayMonth
    ? daysInMonth
    : month > todayMonth
      ? 0
      : Math.min(Math.max(Number(today.slice(8, 10)) || 0, 0), daysInMonth)
  const ratio = daysInMonth > 0 ? elapsed / daysInMonth : 0
  return { elapsed, daysInMonth, ratio, percent: ratio * 100 }
}

export function currentMonthPace() {
  return calculateMonthPace(currentMonthInKorea())
}

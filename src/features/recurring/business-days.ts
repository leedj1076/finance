import { getHolidayPreset } from '@hyunbinseo/holidays-kr'
import { recurringPostingDate, type RecurringSchedule } from './calculations'

export async function resolveRecurringPostingDate(rule: RecurringSchedule & { day: number }, month: string): Promise<string> {
  const scheduledDate = recurringPostingDate(month, rule.day)
  if (!rule.adjustToBusinessDay) return scheduledDate
  return rule.businessDayDirection === 'next'
    ? nextKoreanBusinessDay(scheduledDate)
    : previousKoreanBusinessDay(scheduledDate)
}

export function previousKoreanBusinessDay(date: string): Promise<string> {
  return koreanBusinessDay(date, -1)
}

export function nextKoreanBusinessDay(date: string): Promise<string> {
  return koreanBusinessDay(date, 1)
}

/** Published Korean calendars bundled with the package; no network at posting time.
 * Missing future calendars fail closed rather than silently posting on a holiday.
 * Bank business days also exclude May 1 (including before its public-holiday status).
 */
async function koreanBusinessDay(date: string, step: -1 | 1): Promise<string> {
  const cursor = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(cursor.valueOf()) || cursor.toISOString().slice(0, 10) !== date) {
    throw new Error('올바른 거래 날짜가 아닙니다.')
  }
  for (let attempts = 0; attempts < 31; attempts += 1) {
    const key = cursor.toISOString().slice(0, 10)
    let holidays
    try {
      holidays = await getHolidayPreset(key.slice(0, 4))
    } catch {
      throw new Error(`${key.slice(0, 4)}년 공휴일 자료가 없습니다. 달력 업데이트 후 반영해 주세요.`)
    }
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6 && key.slice(5) !== '05-01' && !(key in holidays)) return key
    cursor.setUTCDate(cursor.getUTCDate() + step)
  }
  throw new Error(`${step === -1 ? '이전' : '이후'} 영업일을 찾지 못했습니다. 공휴일 설정을 확인해 주세요.`)
}

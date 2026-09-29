import { expect, test } from 'vitest'

import { previousKoreanBusinessDay, nextKoreanBusinessDay, resolveRecurringPostingDate } from '@/features/recurring/business-days'

test.each([
  ['2026-09-25', '2026-09-23'], // Chuseok starts on the 24th
  ['2026-10-25', '2026-10-23'],
  ['2026-11-25', '2026-11-25'],
  ['2026-12-25', '2026-12-24'],
  ['2027-04-25', '2027-04-23'],
  ['2026-05-25', '2026-05-22'], // Buddha birthday substitute
  ['2027-02-09', '2027-02-05'], // Seollal + substitute
  ['2026-02-16', '2026-02-13'], // Seollal eve, not just lunar new year
  ['2026-01-01', '2025-12-31'], // preserves source month separately
  ['2026-05-01', '2026-04-30'],
  ['2026-06-03', '2026-06-02'], // election
])('adjusts %s to the previous Korean bank business day %s', async (date, expected) => {
  expect(await previousKoreanBusinessDay(date)).toBe(expected)
})

test('does not silently guess holidays outside the published calendar', async () => {
  await expect(previousKoreanBusinessDay('2100-01-25')).rejects.toThrow(/공휴일/)
  await expect(nextKoreanBusinessDay('2100-01-25')).rejects.toThrow(/공휴일/)
})

test.each([
  ['2026-09-25', '2026-09-28'], // Chuseok, then weekend
  ['2026-10-25', '2026-10-26'],
  ['2026-11-25', '2026-11-25'], // already a business day
  ['2026-12-25', '2026-12-28'],
  ['2027-02-09', '2027-02-10'], // Seollal substitute
  ['2026-05-01', '2026-05-04'], // bank holiday, then weekend
  ['2026-01-31', '2026-02-02'], // crosses month
  ['2023-12-31', '2024-01-02'], // crosses year and New Year holiday
])('adjusts %s to the next Korean bank business day %s', async (date, expected) => {
  expect(await nextKoreanBusinessDay(date)).toBe(expected)
})

test('resolves all three modes and preserves the legacy previous-day default', async () => {
  expect(await resolveRecurringPostingDate({ day: 31 }, '2026-01')).toBe('2026-01-31')
  expect(await resolveRecurringPostingDate({ day: 31, adjustToBusinessDay: false, businessDayDirection: 'next' }, '2026-01')).toBe('2026-01-31')
  expect(await resolveRecurringPostingDate({ day: 31, adjustToBusinessDay: true }, '2026-01')).toBe('2026-01-30')
  expect(await resolveRecurringPostingDate({ day: 31, adjustToBusinessDay: true, businessDayDirection: 'next' }, '2026-01')).toBe('2026-02-02')
  // Clamp missing dates before adjusting, not after.
  expect(await resolveRecurringPostingDate({ day: 31, adjustToBusinessDay: true, businessDayDirection: 'next' }, '2026-02')).toBe('2026-03-03')
})

test.each(['2026-02-30', 'invalid'])('rejects invalid dates in either direction: %s', async date => {
  await expect(previousKoreanBusinessDay(date)).rejects.toThrow(/날짜/)
  await expect(nextKoreanBusinessDay(date)).rejects.toThrow(/날짜/)
})

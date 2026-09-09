import { expect, test } from 'vitest'

import { previousKoreanBusinessDay } from '@/features/recurring/business-days'

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
})

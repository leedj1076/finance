import { expect, test } from 'vitest'

import { occurrenceCounter } from '@/features/inbox/occurrence'

test('numbers repeats of the same key from zero in call order', () => {
  const next = occurrenceCounter()
  expect([next('a'), next('a'), next('b'), next('a')]).toEqual([0, 1, 0, 2])
})

test('starts over for a new counter so re-uploads reproduce the same indexes', () => {
  const first = occurrenceCounter()
  const second = occurrenceCounter()
  first('a')
  expect(second('a')).toBe(0)
})

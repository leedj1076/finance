import { expect, test } from 'vitest'
import { canCloseMonth, monthCloseState, validCloseInput } from '@/features/month-close/state'

test('only a recorded matching revision is closed, including revision zero', () => {
  expect(monthCloseState({ revision: 0, closedRevision: null, closedAt: null })).toBe('open')
  expect(monthCloseState({ revision: 0, closedRevision: 0, closedAt: '2026-09-09' })).toBe('closed')
  expect(monthCloseState({ revision: 2, closedRevision: 1, closedAt: '2026-09-09' })).toBe('needs_review')
  expect(monthCloseState({ revision: 2, closedRevision: null, closedAt: '2026-09-09' })).toBe('needs_review')
})

test('closing uses the Korean month boundary and refuses malformed/current/future months', () => {
  const now = new Date('2026-08-31T15:00:00Z')
  expect(canCloseMonth('2026-08', now)).toBe(true)
  expect(canCloseMonth('2026-09', now)).toBe(false)
  expect(canCloseMonth('2026-10', now)).toBe(false)
  expect(canCloseMonth('2026-13', now)).toBe(false)
  expect(canCloseMonth('0000-01', now)).toBe(false)
})

test('untrusted close input cannot coerce revisions or warning consent', () => {
  expect(validCloseInput({ month: '2026-08', revision: 0, acknowledgeWarnings: false, acknowledgeEmpty: true })).toBe(true)
  for (const revision of [-1, 0.5, NaN, Infinity, '0']) {
    expect(validCloseInput({ month: '2026-08', revision, acknowledgeWarnings: true, acknowledgeEmpty: true })).toBe(false)
  }
  expect(validCloseInput({ month: '2026-08', revision: 1, acknowledgeWarnings: 'true', acknowledgeEmpty: true })).toBe(false)
})

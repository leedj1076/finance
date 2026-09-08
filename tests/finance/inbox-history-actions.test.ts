import { beforeEach, expect, test, vi } from 'vitest'

import { loadInboxHistoryItems, restoreInboxItems } from '@/features/inbox/history-actions'

const auth = vi.hoisted(() => ({ signedIn: true }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => auth.signedIn ? { householdId: 'test' } : null }))
vi.mock('@/db/client', () => ({ db: {} }))
beforeEach(() => { auth.signedIn = true })

test('expired sessions cannot read or restore history and receive inline feedback', async () => {
  auth.signedIn = false
  expect(await loadInboxHistoryItems({ source: 'card:hyundai', processedOn: '2026-09-03', status: 'all', page: 1 })).toHaveProperty('error')
  expect(await restoreInboxItems([1])).toHaveProperty('error')
})

test('invalid history filters and unsafe selections stop before database access', async () => {
  expect(await loadInboxHistoryItems({ source: 'card:hyundai', processedOn: 'bad-date', status: 'all', page: 1 })).toHaveProperty('error')
  expect(await loadInboxHistoryItems({ source: 'card:hyundai', processedOn: '2026-09-03', status: 'all', page: 0 })).toHaveProperty('error')
  for (const ids of [[], [-1], [1.5], Array.from({ length: 501 }, (_, i) => i + 1)]) {
    expect(await restoreInboxItems(ids)).toHaveProperty('error')
  }
})

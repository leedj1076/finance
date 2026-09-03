import { describe, expect, test } from 'vitest'

import { buildInboxProcessingHistory } from '@/features/inbox/queries'

describe('inbox processing history', () => {
  test('groups processed rows by inferred source and Korea processing date', () => {
    const history = buildInboxProcessingHistory([
      { owner: 'DJ', bsCat1: '__source:card:samsung', status: 'done', date: '2026-08-02', createdAt: new Date('2026-09-02T16:00:00Z') },
      { owner: 'DJ', bsCat1: '__source:card:samsung', status: 'dismissed', date: '2026-07-20', createdAt: new Date('2026-09-02T16:30:00Z') },
      { owner: 'YJ', bsCat1: '생활', status: 'done', date: '2026-08-05', createdAt: new Date('2026-09-02T12:00:00Z') },
      { owner: 'YJ', bsCat1: '생활', status: 'pending', date: '2026-08-06', createdAt: new Date('2026-09-02T12:00:00Z') },
    ])

    expect(history).toHaveLength(2)
    expect(history).toContainEqual(expect.objectContaining({
      source: 'card:samsung',
      processedOn: '2026-09-03',
      done: 1,
      dismissed: 1,
      earliestMonth: '2026-07',
      latestMonth: '2026-08',
    }))
    expect(history).toContainEqual(expect.objectContaining({ source: 'banksalad:yj', done: 1 }))
  })
})

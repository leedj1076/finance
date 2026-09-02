import { describe, expect, it } from 'vitest'

import { formatInboxMonth, groupInboxItemsByMonth } from '@/features/inbox/grouping'

describe('inbox month grouping', () => {
  it('keeps the incoming month and transaction order', () => {
    const groups = groupInboxItemsByMonth([
      { id: 3, date: '2026-07-03' },
      { id: 2, date: '2026-07-01' },
      { id: 1, date: '2026-06-30' },
    ])

    expect(groups).toEqual([
      { month: '2026-07', items: [{ id: 3, date: '2026-07-03' }, { id: 2, date: '2026-07-01' }] },
      { month: '2026-06', items: [{ id: 1, date: '2026-06-30' }] },
    ])
  })

  it('formats a compact Korean month heading', () => {
    expect(formatInboxMonth('2026-07')).toBe('2026년 7월')
  })
})

import { describe, expect, it } from 'vitest'

import {
  formatInboxMonth,
  formatInboxPaymentSource,
  groupInboxItemsByMonth,
  groupInboxItemsByPaymentSource,
} from '@/features/inbox/grouping'

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

  it('groups rows by owner and original payment source in incoming order', () => {
    const groups = groupInboxItemsByPaymentSource([
      { id: 3, owner: 'DJ', pay: '네이버 현대카드' },
      { id: 2, owner: 'YJ', pay: '네이버 현대카드' },
      { id: 1, owner: 'DJ', pay: '네이버 현대카드' },
      { id: 4, owner: 'DJ', pay: null },
    ])

    expect(groups.map((group) => ({
      label: formatInboxPaymentSource(group),
      ids: group.items.map((item) => item.id),
    }))).toEqual([
      { label: 'DJ · 네이버 현대카드', ids: [3, 1] },
      { label: 'YJ · 네이버 현대카드', ids: [2] },
      { label: 'DJ · 결제 소스 미상', ids: [4] },
    ])
  })
})

import { describe, expect, it } from 'vitest'

import {
  formatInboxMonth,
  formatInboxPaymentSource,
  groupInboxItemsByMonth,
  groupInboxItemsByMonthAndPaymentSource,
  groupInboxItemsByMonthOwnerAndPaymentSource,
  groupInboxItemsByOwner,
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

  it('groups different raw labels under the same resolved payment account', () => {
    const groups = groupInboxItemsByPaymentSource([
      { id: 1, owner: 'YJ', pay: '본인200', accountId: 12 },
      { id: 2, owner: 'YJ', pay: '신한 교직원복지', accountId: 12 },
      { id: 3, owner: 'YJ', pay: '다른 카드', accountId: 13 },
    ])

    expect(groups.map((group) => ({ accountId: group.accountId, ids: group.items.map((item) => item.id) })))
      .toEqual([
        { accountId: 12, ids: [1, 2] },
        { accountId: 13, ids: [3] },
      ])
  })

  it('uses month as the outer group and payment source as the inner group', () => {
    const groups = groupInboxItemsByMonthAndPaymentSource([
      { id: 5, date: '2026-08-10', owner: 'YJ', pay: '신한카드' },
      { id: 4, date: '2026-08-09', owner: 'DJ', pay: '국민카드' },
      { id: 3, date: '2026-08-08', owner: 'YJ', pay: '신한카드' },
      { id: 2, date: '2026-07-31', owner: 'DJ', pay: '국민카드' },
    ])

    expect(groups.map((month) => ({
      month: month.month,
      sources: month.sources.map((source) => ({
        key: source.key,
        label: formatInboxPaymentSource(source),
        ids: source.items.map((item) => item.id),
      })),
    }))).toEqual([
      {
        month: '2026-08',
        sources: [
          { key: '2026-08\u0000YJ\u0000신한카드', label: 'YJ · 신한카드', ids: [5, 3] },
          { key: '2026-08\u0000DJ\u0000국민카드', label: 'DJ · 국민카드', ids: [4] },
        ],
      },
      {
        month: '2026-07',
        sources: [
          { key: '2026-07\u0000DJ\u0000국민카드', label: 'DJ · 국민카드', ids: [2] },
        ],
      },
    ])
  })

  it('groups the review hierarchy by month, owner, then payment source', () => {
    const groups = groupInboxItemsByMonthOwnerAndPaymentSource([
      { id: 6, date: '2026-08-10', owner: 'YJ', pay: '신한카드' },
      { id: 5, date: '2026-08-09', owner: 'DJ', pay: '국민카드' },
      { id: 4, date: '2026-08-08', owner: 'YJ', pay: '현대카드' },
      { id: 3, date: '2026-08-07', owner: 'YJ', pay: '신한카드' },
      { id: 2, date: '2026-07-31', owner: 'DJ', pay: '국민카드' },
    ])

    expect(groups.map((month) => ({
      month: month.month,
      owners: month.owners.map((owner) => ({
        key: owner.key,
        owner: owner.owner,
        ids: owner.items.map((item) => item.id),
        sources: owner.sources.map((source) => ({
          key: source.key,
          pay: source.pay,
          ids: source.items.map((item) => item.id),
        })),
      })),
    }))).toEqual([
      {
        month: '2026-08',
        owners: [
          {
            key: '2026-08\u0000YJ',
            owner: 'YJ',
            ids: [6, 4, 3],
            sources: [
              { key: '2026-08\u0000YJ\u0000YJ\u0000신한카드', pay: '신한카드', ids: [6, 3] },
              { key: '2026-08\u0000YJ\u0000YJ\u0000현대카드', pay: '현대카드', ids: [4] },
            ],
          },
          {
            key: '2026-08\u0000DJ',
            owner: 'DJ',
            ids: [5],
            sources: [
              { key: '2026-08\u0000DJ\u0000DJ\u0000국민카드', pay: '국민카드', ids: [5] },
            ],
          },
        ],
      },
      {
        month: '2026-07',
        owners: [
          {
            key: '2026-07\u0000DJ',
            owner: 'DJ',
            ids: [2],
            sources: [
              { key: '2026-07\u0000DJ\u0000DJ\u0000국민카드', pay: '국민카드', ids: [2] },
            ],
          },
        ],
      },
    ])
  })

  it('keeps each owner payment-source list independent', () => {
    const groups = groupInboxItemsByOwner([
      { id: 3, owner: 'DJ', pay: '현대카드' },
      { id: 2, owner: 'YJ', pay: '현대카드' },
      { id: 1, owner: 'DJ', pay: '현대카드' },
    ])

    expect(groups.map((group) => ({
      owner: group.owner,
      ids: group.items.map((item) => item.id),
      sourceIds: group.sources.map((source) => source.items.map((item) => item.id)),
    }))).toEqual([
      { owner: 'DJ', ids: [3, 1], sourceIds: [[3, 1]] },
      { owner: 'YJ', ids: [2], sourceIds: [[2]] },
    ])
  })
})

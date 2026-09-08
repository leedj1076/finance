import { describe, expect, it } from 'vitest'

import {
  cardAccountCandidates,
  resolveCardAccountId,
  suggestCardAccountId,
} from '@/features/inbox/account-match'

const accounts = [
  { id: 1, name: 'DJ 현대 - 미래에셋', owner: 'DJ', type: 'card' },
  { id: 2, name: 'DJ 현대 - 네이버', owner: 'DJ', type: 'card' },
  { id: 3, name: 'DJ 농협', owner: 'DJ', type: 'card' },
  { id: 4, name: 'YJ 현대', owner: 'YJ', type: 'card' },
  { id: 5, name: 'YJ 현금/이체', owner: 'YJ', type: 'cash' },
]

describe('card account matching', () => {
  it('matches an unambiguous owner and issuer', () => {
    expect(suggestCardAccountId(accounts, '현대카드', 'YJ')).toBe(4)
    expect(suggestCardAccountId(accounts, '농협카드', 'DJ')).toBe(3)
  })

  it('does not guess when an owner has multiple cards from the issuer', () => {
    expect(suggestCardAccountId(accounts, '현대카드', 'DJ')).toBeNull()
  })

  it('does not fall back to another issuer just because it is the owner only card', () => {
    expect(suggestCardAccountId(accounts, '국민카드', 'YJ')).toBeNull()
  })

  it('accepts only an explicitly selected eligible card when matching is ambiguous', () => {
    const cards = [
      { id: 1, name: 'DJ 현대 네이버', owner: 'DJ', type: 'card' },
      { id: 2, name: 'DJ 현대 미래에셋', owner: 'DJ', type: 'card' },
      { id: 3, name: 'YJ 현대', owner: 'YJ', type: 'card' },
    ]

    expect(resolveCardAccountId(cards, '현대카드', 'DJ', '2')).toBe(2)
    expect(resolveCardAccountId(cards, '현대카드', 'DJ', null)).toBeNull()
    expect(resolveCardAccountId(cards, '현대카드', 'DJ', '3')).toBeNull()
    expect(resolveCardAccountId(cards, '현대카드', 'DJ', '')).toBeNull()
  })

  it('filters candidates by card type, owner, compact issuer name, and active state', () => {
    expect(cardAccountCandidates([
      { id: 1, name: 'DJ 현대 네이버', owner: 'DJ', type: 'card' },
      { id: 2, name: 'DJ 현 대 미래에셋', owner: 'DJ', type: 'card', active: true },
      { id: 3, name: 'DJ 현대 해지', owner: 'DJ', type: 'card', active: false },
      { id: 4, name: 'YJ 현대', owner: 'YJ', type: 'card' },
      { id: 5, name: 'DJ 현대 계좌', owner: 'DJ', type: 'cash' },
      { id: 6, name: 'DJ 신한', owner: 'DJ', type: 'card' },
    ], '현대카드', 'DJ').map((card) => card.id)).toEqual([1, 2])
  })
})

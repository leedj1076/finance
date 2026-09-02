import { describe, expect, it } from 'vitest'

import { suggestCardAccountId } from '@/features/inbox/account-match'

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
})

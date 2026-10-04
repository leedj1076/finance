export type Space = 'ledger' | 'investment'

export const SPACE_COOKIE = 'finance-space'
export const SPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function parseSpace(value: string | undefined): Space {
  return value === 'investment' ? 'investment' : 'ledger'
}

export const SPACE_HOME: Record<Space, string> = { ledger: '/dashboard', investment: '/investment' }

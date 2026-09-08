import { revalidatePath } from 'next/cache'

/**
 * Which route reads which data. A server action names the data it changed and
 * every route that reads it is revalidated, so a transaction added on /ledger
 * cannot leave 홈 or 통계 showing the previous numbers. Listing readers here
 * beats each action guessing, which is how /dashboard came to be refreshed by
 * a Banksalad upload but not by a manual entry.
 */
const ROUTES = {
  home: '/dashboard',
  ledger: '/ledger',
  stats: '/report',
  budgets: '/budgets',
  budgetReview: '/budgets/review',
  assets: '/assets',
  inbox: '/inbox',
  recurring: '/recurring',
  manage: '/manage',
  settings: '/settings',
} as const

type Route = keyof typeof ROUTES

export type FinanceDomain =
  | 'transactions'
  | 'budgets'
  | 'assets'
  | 'inbox'
  | 'taxonomy'
  | 'recurring'
  | 'settings'

const READERS: Record<FinanceDomain, readonly Route[]> = {
  // History also reads ledger matches and their confirmed categories/accounts.
  transactions: ['home', 'ledger', 'stats', 'budgets', 'budgetReview', 'recurring', 'inbox'],
  budgets: ['home', 'ledger', 'budgets', 'budgetReview'],
  assets: ['home', 'assets', 'stats', 'settings'],
  // 홈's todo list counts pending rows; the header badge on other pages is
  // chrome and can wait for their next server render.
  inbox: ['inbox', 'home'],
  taxonomy: ['home', 'ledger', 'stats', 'budgets', 'inbox', 'manage', 'settings'],
  recurring: ['home', 'ledger', 'budgets', 'recurring', 'settings'],
  settings: ['home', 'ledger', 'budgets', 'assets', 'manage', 'settings'],
}

/** Pure part, so the reader map can be asserted without Next's cache. */
export function routesToRevalidate(domains: readonly FinanceDomain[]) {
  const routes = new Set<string>()
  for (const domain of domains) {
    for (const route of READERS[domain]) routes.add(ROUTES[route])
  }
  return [...routes]
}

export function revalidateFinance(...domains: FinanceDomain[]) {
  for (const route of routesToRevalidate(domains)) revalidatePath(route)
}

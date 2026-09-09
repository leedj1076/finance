import { expect, test } from 'vitest'

import { routesToRevalidate } from '@/lib/revalidate'

test('a transaction change refreshes every page that reports on transactions', () => {
  expect(routesToRevalidate(['transactions']).sort()).toEqual([
    '/budgets',
    '/budgets/review',
    '/dashboard',
    '/inbox',
    '/ledger',
    '/recurring',
    '/report',
  ])
})

test('an inbox change refreshes the inbox, home todos and closed-month pending notice', () => {
  expect(routesToRevalidate(['inbox']).sort()).toEqual(['/dashboard', '/inbox', '/ledger'])
})

test('closing or reopening refreshes statistics and every live status label', () => {
  expect(routesToRevalidate(['monthClose']).sort()).toEqual(['/budgets', '/budgets/review', '/dashboard', '/ledger', '/report'])
})

test('combining domains lists each route once', () => {
  const routes = routesToRevalidate(['transactions', 'budgets', 'assets'])
  expect(new Set(routes).size).toBe(routes.length)
  expect(routes).toContain('/assets')
})

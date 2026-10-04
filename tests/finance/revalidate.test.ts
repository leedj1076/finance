import { expect, test, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { revalidatePath } from 'next/cache'

import { revalidateFinance, routesToRevalidate } from '@/lib/revalidate'

test('investment changes refresh only investment routes including dynamic details', () => {
  expect(routesToRevalidate(['investment']).sort()).toEqual([
    '/investment', '/investment/advisor', '/investment/settings', '/investment/transactions', '/investment/trend', '/investment/watch',
  ])
  revalidateFinance('investment')
  expect(revalidatePath).toHaveBeenCalledWith('/investment/[securityId]', 'page')
})

test('a transaction change refreshes every page that reports on transactions', () => {
  expect(routesToRevalidate(['transactions']).sort()).toEqual([
    '/budgets',
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
  expect(routesToRevalidate(['monthClose']).sort()).toEqual(['/budgets', '/dashboard', '/ledger', '/report'])
})

test('combining domains lists each route once', () => {
  const routes = routesToRevalidate(['transactions', 'budgets', 'assets'])
  expect(new Set(routes).size).toBe(routes.length)
  expect(routes).toContain('/assets')
})

import { beforeEach, expect, test, vi } from 'vitest'

import { GET } from '@/app/api/inbox/history/route'
import type { InboxHistoryRequest } from '@/features/inbox/history-types'

const context = vi.hoisted(() => ({ signedIn: true, fail: false }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => {
  if (context.fail) throw new Error('private connection credentials')
  return context.signedIn ? { householdId: 'server-household' } : null
} }))
// Query correctness and household isolation are covered against the local DB.
vi.mock('@/features/inbox/history-queries', () => ({ getInboxHistoryItems: async (householdId: string, request: InboxHistoryRequest) => {
  if (householdId !== 'server-household' || request.source !== 'card:samsung' || request.processedOn !== '2026-09-03' || request.status !== 'dismissed' || request.page !== 2) throw new Error('wrong authenticated query')
  return { items: [], total: 51, page: 2, pageSize: 50 }
} }))
const query = 'source=card%3Asamsung&processedOn=2026-09-03&status=dismissed&page=2'
const request = (params = query) => new Request(`http://localhost:3000/api/inbox/history?${params}`)
beforeEach(() => { context.signedIn = true; context.fail = false })

test('history GET returns the authenticated household query without shared caching', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('private')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toEqual({ data: { items: [], total: 51, page: 2, pageSize: 50 } })
})

test('expired sessions and missing household return safe private JSON 401', async () => {
  context.signedIn = false
  const response = await GET(request())
  expect(response.status).toBe(401)
  expect(response.headers.get('Location')).toBeNull()
  expect(response.headers.get('Cache-Control')).toContain('private, no-store')
  expect(await response.json()).toHaveProperty('error')
})

test.each([
  '', `${query}&householdId=attacker`, `${query}&page=1`, query.replace('page=2', 'page=0'),
  query.replace('page=2', 'page=1.5'), query.replace('page=2', 'page=9007199254740992'),
  query.replace('page=2', 'page='), query.replace('dismissed', 'deleted'),
  query.replace('2026-09-03', 'bad-date'), query.replace('card%3Asamsung', 'x'.repeat(101)),
  `source=${'x'.repeat(2100)}`,
])('malformed, unbounded, duplicated, or household-controlled query is rejected (%#)', async (params) => {
  const response = await GET(request(params))
  expect(response.status).toBe(400)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toHaveProperty('error')
})

test('auth and query failures do not expose internal error details', async () => {
  context.fail = true
  const authFailure = await GET(request())
  context.fail = false
  const queryFailure = await GET(request(query.replace('samsung', 'hyundai')))
  for (const response of [authFailure, queryFailure]) {
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toContain('private, no-store')
    expect(await response.json()).toEqual({ error: '항목을 불러오지 못했습니다. 다시 시도해 주세요.' })
  }
})

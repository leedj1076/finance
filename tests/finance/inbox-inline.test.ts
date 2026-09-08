import { beforeEach, expect, test, vi } from 'vitest'

import { processInbox } from '@/features/inbox/actions'

const auth = vi.hoisted(() => ({ signedIn: true }))
vi.mock('@/lib/household', () => ({
  requireHousehold: async () => auth.signedIn ? { householdId: 'test-household' } : null,
}))
// Preflight failures must not reach the database. Persistence has its own
// integration tests; this boundary also keeps this test independent of DB env.
vi.mock('@/db/client', () => ({ db: {} }))

beforeEach(() => { auth.signedIn = true })

test('inline selection errors return feedback instead of navigating away from edits', async () => {
  const form = new FormData()
  form.set('inline', '1')
  form.set('intent', 'dismiss')
  await expect(processInbox(form)).resolves.toEqual({ error: '선택된 항목이 없습니다.' })
})

test('an expired inline session returns an error without redirecting or clearing the form', async () => {
  auth.signedIn = false
  const form = new FormData()
  form.set('inline', '1')
  await expect(processInbox(form)).resolves.toEqual({ error: '가족 가계부에 연결된 계정이 아닙니다.' })
})

test('oversized inline selection returns a reviewable error before any writes', async () => {
  const form = new FormData()
  form.set('inline', '1')
  for (let id = 1; id <= 501; id += 1) form.append('ids', String(id))
  await expect(processInbox(form)).resolves.toEqual({ error: '한 번에 최대 500건까지 처리할 수 있습니다.' })
})

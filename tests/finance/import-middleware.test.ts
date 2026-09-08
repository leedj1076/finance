import { NextRequest } from 'next/server'
import { beforeEach, expect, test, vi } from 'vitest'

import { updateSession } from '@/lib/supabase/middleware'

const auth = vi.hoisted(() => ({ signedIn: false, refresh: false }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string; options: { path: string; maxAge: number } }>) => void } }) => ({ auth: { getClaims: async () => {
    if (auth.refresh) options.cookies.setAll([{ name: 'test-session', value: auth.signedIn ? 'renewed' : '', options: { path: '/', maxAge: auth.signedIn ? 3600 : 0 } }])
    return { data: auth.signedIn ? { claims: { sub: 'test-user' } } : null }
  } } }),
}))
beforeEach(() => { auth.signedIn = false; auth.refresh = false })

test('unauthenticated multipart import is JSON 401 and preserves expired cookie clearing', async () => {
  auth.refresh = true
  const response = await updateSession(new NextRequest('http://localhost:3000/api/import', { method: 'POST' }))
  expect(response.status).toBe(401)
  expect(response.headers.get('Location')).toBeNull()
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toEqual({ type: 'error', code: 'invalid_input', message: '가족 가계부에 연결된 계정으로 다시 로그인해 주세요.' })
  expect(response.cookies.get('test-session')).toMatchObject({ value: '', maxAge: 0, path: '/' })
})

test('authenticated import passes through with refreshed session cookie', async () => {
  auth.signedIn = true
  auth.refresh = true
  const response = await updateSession(new NextRequest('http://localhost:3000/api/import', { method: 'POST' }))
  expect(response.headers.get('x-middleware-next')).toBe('1')
  expect(response.cookies.get('test-session')).toMatchObject({ value: 'renewed', maxAge: 3600 })
})

test('history GET returns private JSON 401 with cleared cookies and signed-in reads pass through', async () => {
  auth.refresh = true
  const response = await updateSession(new NextRequest('http://localhost:3000/api/inbox/history?source=card:samsung'))
  expect(response.status).toBe(401)
  expect(response.headers.get('Location')).toBeNull()
  expect(response.headers.get('Cache-Control')).toContain('private, no-store')
  expect(await response.json()).toHaveProperty('error')
  expect(response.cookies.get('test-session')).toMatchObject({ value: '', maxAge: 0 })
  auth.signedIn = true
  const signedIn = await updateSession(new NextRequest('http://localhost:3000/api/inbox/history'))
  expect(signedIn.headers.get('x-middleware-next')).toBe('1')
  expect(signedIn.cookies.get('test-session')).toMatchObject({ value: 'renewed', maxAge: 3600 })
})

test('protected pages and other API paths retain login redirects; public login still passes', async () => {
  for (const path of ['/inbox', '/api/import-other', '/api/inbox/history-other']) {
    const response = await updateSession(new NextRequest(`http://localhost:3000${path}`))
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('http://localhost:3000/login')
  }
  expect((await updateSession(new NextRequest('http://localhost:3000/login'))).headers.get('x-middleware-next')).toBe('1')
})

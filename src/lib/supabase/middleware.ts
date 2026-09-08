import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

function isPublicPath(pathname: string) {
  return pathname === '/login' || pathname.startsWith('/auth/')
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const isSignedIn = typeof data?.claims?.sub === 'string'

  if (!isSignedIn && !isPublicPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname === '/api/inbox/history') {
      const unauthorized = NextResponse.json({ error: '가족 가계부에 연결된 계정이 아닙니다.' }, {
        status: 401, headers: { 'Cache-Control': 'private, no-store' },
      })
      for (const cookie of response.cookies.getAll()) unauthorized.cookies.set(cookie)
      return unauthorized
    }
    if (request.nextUrl.pathname === '/api/import') {
      const unauthorized = NextResponse.json({
        type: 'error',
        code: 'invalid_input',
        message: '가족 가계부에 연결된 계정으로 다시 로그인해 주세요.',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      for (const cookie of response.cookies.getAll()) unauthorized.cookies.set(cookie)
      return unauthorized
    }
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  return response
}

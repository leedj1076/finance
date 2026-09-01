'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(() => createBrowserSupabase(), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)

    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    if (!result.data.session) {
      setMessage('확인 이메일을 보냈습니다. 이메일 인증 후 로그인해 주세요.')
      return
    }

    router.push('/')
    router.refresh()
  }

  function toggleMode() {
    setMode((current) => (current === 'signin' ? 'signup' : 'signin'))
    setError(null)
    setMessage(null)
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-6">
      <section className="w-full rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-medium text-emerald-700">우리집 가계부</p>
        <h1 className="mb-6 text-2xl font-semibold text-zinc-950">
          {mode === 'signin' ? '로그인' : '계정 만들기'}
        </h1>

        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            이메일
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              type="email"
              placeholder="이메일"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            비밀번호
            <input
              className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              type="password"
              placeholder="비밀번호"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button
            className="mt-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? '처리 중…' : mode === 'signin' ? '로그인' : '가입'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}

        <button
          className="mt-5 text-sm text-zinc-600 underline-offset-4 hover:underline"
          onClick={toggleMode}
          type="button"
        >
          {mode === 'signin' ? '계정이 없으신가요? 가입' : '이미 계정이 있으신가요? 로그인'}
        </button>
      </section>
    </main>
  )
}

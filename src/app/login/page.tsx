'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createBrowserSupabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(() => createBrowserSupabase(), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await supabase.auth.signInWithPassword({ email, password })

    setBusy(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-6">
      <section className="w-full rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-medium text-emerald-700">우리집 가계부</p>
        <h1 className="text-2xl font-semibold text-zinc-950">로그인</h1>
        <p className="mb-6 mt-2 text-sm text-zinc-500">
          등록된 가족 계정만 로그인할 수 있습니다.
        </p>

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
              autoComplete="current-password"
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
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      </section>
    </main>
  )
}

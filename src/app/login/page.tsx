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
      <section className="w-full border-t border-finance-ink py-8">
        <div className="mb-8 flex items-center gap-3"><span className="grid h-7 w-7 place-items-center bg-finance-ink t-caption font-bold text-white">우</span><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">우리집 가계부</p></div>
        <h1 className="text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">로그인</h1>
        <p className="mb-6 mt-2 t-caption text-finance-muted">
          등록된 가족 계정만 로그인할 수 있습니다.
        </p>

        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 t-body font-medium text-finance-ink">
            이메일
            <input
              className="h-[34px] border border-finance-hairline bg-white px-3 text-[13px] outline-none focus:border-finance-blue"
              type="email"
              placeholder="이메일"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 t-body font-medium text-finance-ink">
            비밀번호
            <input
              className="h-[34px] border border-finance-hairline bg-white px-3 text-[13px] outline-none focus:border-finance-blue"
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
            className="mt-2 h-[34px] bg-finance-ink px-4 text-[13px] font-semibold text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>

        {error && <p className="mt-4 t-body text-finance-red">{error}</p>}
      </section>
    </main>
  )
}

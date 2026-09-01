'use client'

import { useMemo, useState } from 'react'

import { createBrowserSupabase } from '@/lib/supabase/client'

type PasswordChangeFormProps = {
  email: string
}

export function PasswordChangeForm({ email }: PasswordChangeFormProps) {
  const supabase = useMemo(() => createBrowserSupabase(), [])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    if (newPassword.length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (newPassword !== confirmation) {
      setError('새 비밀번호가 서로 일치하지 않습니다.')
      return
    }
    if (currentPassword === newPassword) {
      setError('현재 비밀번호와 다른 비밀번호를 입력해 주세요.')
      return
    }

    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (signInError) {
      setBusy(false)
      setError('현재 비밀번호가 올바르지 않습니다.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setBusy(false)
    if (updateError) {
      setError(updateError.message)
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmation('')
    setMessage('비밀번호를 변경했습니다.')
  }

  return (
    <form className="mt-6 grid gap-4" onSubmit={submit}>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        현재 비밀번호
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        새 비밀번호
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        새 비밀번호 확인
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
        />
      </label>
      <button
        className="mt-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? '변경 중…' : '비밀번호 변경'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}
    </form>
  )
}

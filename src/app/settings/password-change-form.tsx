'use client'

import { useActionState } from 'react'

import { changePassword } from './actions'

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState(changePassword, {})

  return (
    <form action={action} className="mt-6 grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        현재 비밀번호
        <input
          className="rounded-lg border border-zinc-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          type="password"
          autoComplete="current-password"
          name="currentPassword"
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
          name="newPassword"
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
          name="confirmation"
          required
        />
      </label>
      <button
        className="mt-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? '변경 중…' : '비밀번호 변경'}
      </button>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  )
}

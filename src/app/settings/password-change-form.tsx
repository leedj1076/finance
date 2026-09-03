'use client'

import { useActionState } from 'react'

import { changePassword } from './actions'

export function PasswordChangeForm() {
  const [state, action, pending] = useActionState(changePassword, {})

  return (
    <form action={action} className="mt-6 grid gap-4">
      <label className="grid gap-1.5 t-body font-medium text-finance-ink">
        현재 비밀번호
        <input
          className="h-[34px] border border-finance-hairline bg-white px-3 t-body outline-none focus:border-finance-blue"
          type="password"
          autoComplete="current-password"
          name="currentPassword"
          required
        />
      </label>
      <label className="grid gap-1.5 t-body font-medium text-finance-ink">
        새 비밀번호
        <input
          className="h-[34px] border border-finance-hairline bg-white px-3 t-body outline-none focus:border-finance-blue"
          type="password"
          autoComplete="new-password"
          minLength={8}
          name="newPassword"
          required
        />
      </label>
      <label className="grid gap-1.5 t-body font-medium text-finance-ink">
        새 비밀번호 확인
        <input
          className="h-[34px] border border-finance-hairline bg-white px-3 t-body outline-none focus:border-finance-blue"
          type="password"
          autoComplete="new-password"
          minLength={8}
          name="confirmation"
          required
        />
      </label>
      <button
        className="mt-2 h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? '변경 중…' : '비밀번호 변경'}
      </button>
      {state.error && <p className="t-body text-finance-red">{state.error}</p>}
    </form>
  )
}

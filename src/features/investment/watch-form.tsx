'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { addWatchSecurity, type ActionState } from './actions'

const control = 'h-[34px] border border-finance-border bg-white px-2 t-body-normal text-finance-ink'

export function WatchForm() {
  const [state, action] = useActionState<ActionState, FormData>(addWatchSecurity, {})
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" key={state.saved?.id ?? 'form'}>
      <label className="grid gap-1 t-label uppercase text-finance-muted">시장<select className={control} defaultValue="KR" name="market"><option value="KR">KR</option><option value="US">US</option></select></label>
      <label className="grid gap-1 t-label uppercase text-finance-muted">종목코드<input className={`${control} w-[120px]`} name="symbol" placeholder="005930" required /></label>
      <label className="grid gap-1 t-label uppercase text-finance-muted">이름<input className={`${control} w-[160px]`} name="name" placeholder="선택" /></label>
      <SubmitButton className="h-[34px] border border-finance-ink px-3 t-caption-strong text-finance-ink" pendingLabel="추가 중…">추가</SubmitButton>
      {state.error && <p className="w-full t-caption text-finance-red" role="alert">{state.error}</p>}
      {state.message && !state.error && <p className="w-full t-caption text-finance-green" role="status">{state.message}</p>}
    </form>
  )
}

'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveInvestmentAccount, type ActionState } from './actions'
import type { AccountRow } from './types'

const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function AccountForm({ account }: { account?: AccountRow & { credentialRef: string } }) {
  const [state, action] = useActionState<ActionState, FormData>(saveInvestmentAccount, {})
  return (
    <form action={action} className="grid gap-3 border-t border-finance-border py-4 sm:grid-cols-2 lg:grid-cols-[100px_minmax(0,1fr)_160px_180px_auto] sm:items-end" key={state.saved?.id ?? account?.id ?? 'new'}>
      {account && <input name="id" type="hidden" value={account.id} />}
      <label className={label}>소유자<input className={control} defaultValue={account?.owner ?? ''} maxLength={20} name="owner" placeholder="DJ" required /></label>
      <label className={label}>계좌 이름<input className={control} defaultValue={account?.name ?? ''} maxLength={60} name="name" placeholder="DJ 키움 종합" required /></label>
      <label className={label}>계좌번호<input className={control} defaultValue={account?.brokerAccountNo ?? ''} inputMode="numeric" name="brokerAccountNo" pattern={'[0-9\\-]{4,20}'} required /></label>
      <label className={label}>키체인 항목 이름<input className={control} defaultValue={account?.credentialRef ?? ''} name="credentialRef" pattern={'[a-z0-9\\-]{2,40}'} placeholder="dj-kiwoom" required /></label>
      <div className="flex items-center gap-3">
        {account && <label className="inline-flex items-center gap-1.5 t-caption text-finance-muted"><input defaultChecked={account.active} name="active" type="checkbox" />사용</label>}
        <SubmitButton className="h-[34px] bg-finance-ink px-4 t-caption-strong text-white" pendingLabel="저장 중…">{account ? '저장' : '추가'}</SubmitButton>
      </div>
      {state.error && <p className="col-span-full t-caption text-finance-red" role="alert">{state.error}</p>}
      {state.message && !state.error && <p className="col-span-full t-caption text-finance-green" role="status">{state.message}</p>}
    </form>
  )
}

'use client'

import { startTransition, useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveInvestmentAccount, type ActionState } from './actions'
import type { AccountRow } from './types'

const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal tracking-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function AccountForm({ account }: { account?: AccountRow & { credentialRef: string } }) {
  const [draft, setDraft] = useState({ owner: account?.owner ?? '', name: account?.name ?? '', brokerAccountNo: account?.brokerAccountNo ?? '', credentialRef: account?.credentialRef ?? '', active: account?.active ?? true })
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await saveInvestmentAccount(previous, form)
    if (result.saved && !account) setDraft({ owner: '', name: '', brokerAccountNo: '', credentialRef: '', active: true })
    return result
  }, {})
  return (
    <form action={action} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)) }} className="grid gap-3 border-t border-finance-border py-4 sm:grid-cols-2 lg:grid-cols-[100px_minmax(0,1fr)_160px_180px_auto] sm:items-end">
      <fieldset className="contents" disabled={pending}>
        {account && <input name="id" type="hidden" value={account.id} />}
        <label className={label}>소유자<input className={control} value={draft.owner} onChange={event => setDraft({ ...draft, owner: event.target.value })} maxLength={20} name="owner" placeholder="DJ" required /></label>
        <label className={label}>계좌 이름<input className={control} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={60} name="name" placeholder="DJ 키움 종합" required /></label>
        <label className={label}>계좌번호<input className={control} value={draft.brokerAccountNo} onChange={event => setDraft({ ...draft, brokerAccountNo: event.target.value })} inputMode="numeric" name="brokerAccountNo" pattern={'[0-9\\-]{4,20}'} required /></label>
        <label className={label}>키체인 항목 이름<input className={control} value={draft.credentialRef} onChange={event => setDraft({ ...draft, credentialRef: event.target.value })} name="credentialRef" pattern={'[a-z0-9\\-]{2,40}'} placeholder="dj-kiwoom" required /></label>
        <div className="flex items-center gap-3">
          {account && <label className="inline-flex items-center gap-1.5 t-caption text-finance-muted"><input checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} name="active" type="checkbox" />사용</label>}
          <SubmitButton className="h-[34px] bg-finance-ink px-4 t-caption-strong text-white" pendingLabel="저장 중…">{account ? '저장' : '추가'}</SubmitButton>
        </div>
        {state.error && <p className="col-span-full t-caption text-finance-red" role="alert">{state.error}</p>}
        {state.message && !state.error && <p className="col-span-full t-caption text-finance-green" role="status">{state.message}</p>}
      </fieldset>
    </form>
  )
}

'use client'

import { startTransition, useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveManualTransaction, type ActionState } from './actions'
import { CASH_KINDS, KIND_LABELS, TRANSACTION_KINDS, type AccountRow, type SecurityRow, type TransactionKind } from './types'

const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function ManualTransactionForm({ accounts, securities, today }: { accounts: AccountRow[]; securities: SecurityRow[]; today: string }) {
  const [kind, setKind] = useState<TransactionKind>('buy')
  const [securityId, setSecurityId] = useState('')
  const [cashCurrency, setCashCurrency] = useState('KRW')
  const isCash = CASH_KINDS.includes(kind)
  const isTrade = kind === 'buy' || kind === 'sell'
  const activeAccounts = accounts.filter(account => account.active)
  const emptyDraft = { accountId: String(activeAccounts[0]?.id ?? ''), tradeDate: today, quantity: '', price: '', fee: '0', amount: '', memo: '' }
  const [draft, setDraft] = useState(emptyDraft)
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await saveManualTransaction(previous, form)
    if (result.saved) setDraft(emptyDraft)
    return result
  }, {})
  const currency = isCash ? cashCurrency : securities.find(security => String(security.id) === securityId)?.currency ?? 'KRW'
  return (
    <form action={action} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)) }} className="mt-4 grid gap-3 border-y border-finance-border bg-finance-panel px-3 py-4 sm:grid-cols-4 lg:grid-cols-8">
      <fieldset className="contents" disabled={pending}>
        <label className={label}>종류
          <select className={control} name="kind" onChange={(event) => setKind(event.target.value as TransactionKind)} value={kind}>
            {TRANSACTION_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
          </select>
        </label>
        <label className={label}>계좌
          <select className={control} value={draft.accountId} onChange={event => setDraft({ ...draft, accountId: event.target.value })} name="accountId" required>
            {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label className={label}>종목
          <select className={control} value={isCash ? '' : securityId} onChange={event => setSecurityId(event.target.value)} disabled={isCash} required={!isCash} name="securityId">
            <option value="">{isCash ? '해당 없음' : '선택'}</option>
            {securities.map((security) => <option key={security.id} value={security.id}>{security.name} ({security.symbol})</option>)}
          </select>
        </label>
        <label className={label}>날짜<input className={control} value={draft.tradeDate} onChange={event => setDraft({ ...draft, tradeDate: event.target.value })} max={today} min="1990-01-01" name="tradeDate" type="date" /></label>
        <label className={label}>{kind === 'adjust' ? '수량 (±)' : '수량'}<input className={control} value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value })} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="quantity" placeholder="0" /></label>
        <label className={label}>{kind === 'adjust' ? '정정 후 단가' : '단가'}<input className={control} value={draft.price} onChange={event => setDraft({ ...draft, price: event.target.value })} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="price" placeholder={kind === 'adjust' ? '선택' : '0'} /></label>
        {isTrade
          ? <label className={label}>수수료·세금<input className={control} value={draft.fee} onChange={event => setDraft({ ...draft, fee: event.target.value })} inputMode="decimal" name="fee" /></label>
          : <label className={label}>금액<input className={control} value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} disabled={kind === 'adjust'} inputMode="decimal" name="amount" placeholder="0" /></label>}
        <label className={label}>통화
          <select className={control} value={currency} onChange={event => setCashCurrency(event.target.value)} disabled={!isCash} name="currency">
            <option value="KRW">KRW</option><option value="USD">USD</option>
          </select>
        </label>
        <label className={`${label} sm:col-span-3 lg:col-span-6`}>메모<input className={control} value={draft.memo} onChange={event => setDraft({ ...draft, memo: event.target.value })} maxLength={200} name="memo" /></label>
        <div className="flex items-end gap-3 sm:col-span-1 lg:col-span-2">
          <SubmitButton className="h-[34px] bg-finance-ink px-4 t-caption-strong text-white disabled:opacity-40" disabled={activeAccounts.length === 0 || (!isCash && securities.length === 0)} pendingLabel="저장 중…">저장</SubmitButton>
          {state.error && <p className="t-caption text-finance-red" role="alert">{state.error}</p>}
          {state.message && !state.error && <p className="t-caption text-finance-green" role="status">{state.message}</p>}
        </div>
        {!isCash && securities.length === 0 && <p className="col-span-full t-caption text-finance-muted">관심 화면에서 종목을 먼저 추가하세요. 입금·출금은 종목 없이 입력할 수 있습니다.</p>}
      </fieldset>
    </form>
  )
}

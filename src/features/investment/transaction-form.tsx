'use client'

import { useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveManualTransaction, type ActionState } from './actions'
import { CASH_KINDS, KIND_LABELS, TRANSACTION_KINDS, type AccountRow, type SecurityRow, type TransactionKind } from './types'

const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function ManualTransactionForm({ accounts, securities, today }: { accounts: AccountRow[]; securities: SecurityRow[]; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveManualTransaction, {})
  const [kind, setKind] = useState<TransactionKind>('buy')
  const [securityId, setSecurityId] = useState('')
  const [cashCurrency, setCashCurrency] = useState('KRW')
  const isCash = CASH_KINDS.includes(kind)
  const isTrade = kind === 'buy' || kind === 'sell'
  const activeAccounts = accounts.filter(account => account.active)
  const currency = isCash ? cashCurrency : securities.find(security => String(security.id) === securityId)?.currency ?? 'KRW'
  return (
    <form action={action} className="mt-4 grid gap-3 border-y border-finance-border bg-finance-panel px-3 py-4 sm:grid-cols-4 lg:grid-cols-8" key={state.saved?.id ?? 'form'}>
      <label className={label}>종류
        <select className={control} name="kind" onChange={(event) => setKind(event.target.value as TransactionKind)} value={kind}>
          {TRANSACTION_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
        </select>
      </label>
      <label className={label}>계좌
        <select className={control} defaultValue={activeAccounts[0]?.id} name="accountId" required>
          {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <label className={label}>종목
        <select className={control} value={isCash ? '' : securityId} onChange={event => setSecurityId(event.target.value)} disabled={isCash} required={!isCash} name="securityId">
          <option value="">{isCash ? '해당 없음' : '선택'}</option>
          {securities.map((security) => <option key={security.id} value={security.id}>{security.name} ({security.symbol})</option>)}
        </select>
      </label>
      <label className={label}>날짜<input className={control} defaultValue={today} max={today} min="1990-01-01" name="tradeDate" type="date" /></label>
      <label className={label}>{kind === 'adjust' ? '수량 (±)' : '수량'}<input className={control} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="quantity" placeholder="0" /></label>
      <label className={label}>{kind === 'adjust' ? '정정 후 단가' : '단가'}<input className={control} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="price" placeholder={kind === 'adjust' ? '선택' : '0'} /></label>
      {isTrade
        ? <label className={label}>수수료·세금<input className={control} defaultValue="0" inputMode="decimal" name="fee" /></label>
        : <label className={label}>금액<input className={control} disabled={kind === 'adjust'} inputMode="decimal" name="amount" placeholder="0" /></label>}
      <label className={label}>통화
        <select className={control} value={currency} onChange={event => setCashCurrency(event.target.value)} disabled={!isCash} name="currency">
          <option value="KRW">KRW</option><option value="USD">USD</option>
        </select>
      </label>
      <label className={`${label} sm:col-span-3 lg:col-span-6`}>메모<input className={control} maxLength={200} name="memo" /></label>
      <div className="flex items-end gap-3 sm:col-span-1 lg:col-span-2">
        <SubmitButton className="h-[34px] bg-finance-ink px-4 t-caption-strong text-white disabled:opacity-40" disabled={activeAccounts.length === 0 || (!isCash && securities.length === 0)} pendingLabel="저장 중…">저장</SubmitButton>
        {state.error && <p className="t-caption text-finance-red" role="alert">{state.error}</p>}
        {state.message && !state.error && <p className="t-caption text-finance-green" role="status">{state.message}</p>}
      </div>
      {!isCash && securities.length === 0 && <p className="col-span-full t-caption text-finance-muted">관심 화면에서 종목을 먼저 추가하세요. 입금·출금은 종목 없이 입력할 수 있습니다.</p>}
    </form>
  )
}

'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { saveTransaction, type TransactionActionState } from './actions'
import { ledgerUrl, type LedgerFilters } from './filters'
import type { TransactionFlow } from './transaction-input'

type CategoryOption = {
  id: number
  kind: TransactionFlow
  major: string
  sub: string
}

type AccountOption = {
  id: number
  name: string
}

type EditingTransaction = {
  id: number
  date: string
  flow: TransactionFlow
  fixed: boolean
  categoryId: number | null
  memo: string | null
  amount: number
  accountId: number | null
}

type TransactionFormProps = {
  accounts: AccountOption[]
  categories: CategoryOption[]
  defaultDate: string
  editing: EditingTransaction | null
  filters: LedgerFilters
  month: string
}

const initialState: TransactionActionState = {}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      className="h-[34px] bg-finance-ink px-4 text-[13px] font-semibold text-white hover:bg-finance-blue disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : editing ? '수정 저장' : '거래 추가'}
    </button>
  )
}

export function TransactionForm({
  accounts,
  categories,
  defaultDate,
  editing,
  filters,
  month,
}: TransactionFormProps) {
  const [state, action] = useActionState(saveTransaction, initialState)
  const [flow, setFlow] = useState<TransactionFlow>(editing?.flow ?? 'expense')
  const [categoryId, setCategoryId] = useState(editing?.categoryId?.toString() ?? '')
  const visibleCategories = categories.filter((category) => category.kind === flow)

  return (
    <article
      className={`mt-6 border-t ${
        editing ? 'border-finance-amber' : 'border-finance-ink'
      }`}
    >
      <div className="flex items-center justify-between border-b border-finance-border py-4">
        <div>
          <h2 className="text-sm font-bold text-finance-ink">
            {editing ? '거래 수정' : '거래 직접 입력'}
          </h2>
          <p className="mt-1 text-xs text-finance-muted">
            {editing ? '선택한 거래를 수정하고 있습니다.' : '은행 가져오기 외 거래를 직접 기록합니다.'}
          </p>
        </div>
        {editing && (
          <Link className="text-xs font-semibold text-finance-blue hover:text-finance-ink" href={ledgerUrl(month, filters)}>
            수정 취소
          </Link>
        )}
      </div>

      <form action={action} className="grid gap-3 border-b border-finance-border py-4 md:grid-cols-2 xl:grid-cols-6">
        <input name="transactionId" type="hidden" value={editing?.id ?? ''} />
        <input name="returnAccount" type="hidden" value={filters.account} />
        <input name="returnFlow" type="hidden" value={filters.flow} />
        <input name="returnMajor" type="hidden" value={filters.major} />
        <input name="returnQ" type="hidden" value={filters.q} />
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
          날짜
          <input
            className="h-[34px] border border-finance-border bg-white px-3 text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            defaultValue={editing?.date ?? defaultDate}
            name="date"
            required
            type="date"
          />
        </label>
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
          유형
          <select
            className="h-[34px] border border-finance-border bg-white px-3 text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            name="flow"
            onChange={(event) => {
              setFlow(event.target.value as TransactionFlow)
              setCategoryId('')
            }}
            value={flow}
          >
            <option value="expense">지출</option>
            <option value="income">수입</option>
            <option value="saving">저축</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted xl:col-span-2">
          분류
          <select
            className="h-[34px] border border-finance-border bg-white px-3 text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            name="categoryId"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            <option value="">미분류</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.major} · {category.sub}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
          금액
          <input
            className="h-[34px] border border-finance-border bg-white px-3 text-right text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            defaultValue={editing?.amount ?? ''}
            inputMode="numeric"
            name="amount"
            placeholder="0"
            required
          />
        </label>
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted">
          결제수단
          <select
            className="h-[34px] border border-finance-border bg-white px-3 text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            defaultValue={editing?.accountId ?? ''}
            name="accountId"
          >
            <option value="">선택 안 함</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted md:col-span-2 xl:col-span-4">
          사용내역
          <input
            className="h-[34px] border border-finance-border bg-white px-3 text-[13px] font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            defaultValue={editing?.memo ?? ''}
            maxLength={200}
            name="memo"
            placeholder="예: 주말 장보기"
          />
        </label>
        <div className="flex items-end">
          {flow === 'expense' && (
            <label className="flex items-center gap-2 pb-2 text-xs text-finance-muted">
              <input defaultChecked={editing?.fixed ?? false} name="fixed" type="checkbox" />
              고정지출
            </label>
          )}
        </div>
        <div className="flex items-end justify-end">
          <SubmitButton editing={Boolean(editing)} />
        </div>
        {state.error && (
          <p className="text-[13px] text-finance-red md:col-span-2 xl:col-span-6">{state.error}</p>
        )}
      </form>
    </article>
  )
}

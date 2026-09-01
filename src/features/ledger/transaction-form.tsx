'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { saveTransaction, type TransactionActionState } from './actions'
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
  month: string
}

const initialState: TransactionActionState = {}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
  month,
}: TransactionFormProps) {
  const [state, action] = useActionState(saveTransaction, initialState)
  const [flow, setFlow] = useState<TransactionFlow>(editing?.flow ?? 'expense')
  const [categoryId, setCategoryId] = useState(editing?.categoryId?.toString() ?? '')
  const visibleCategories = categories.filter((category) => category.kind === flow)

  return (
    <article
      className={`mt-6 rounded-2xl border bg-white shadow-sm ${
        editing ? 'border-amber-300' : 'border-zinc-200'
      }`}
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-zinc-950">
            {editing ? '거래 수정' : '거래 직접 입력'}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {editing ? '선택한 거래를 수정하고 있습니다.' : '은행 가져오기 외 거래를 직접 기록합니다.'}
          </p>
        </div>
        {editing && (
          <Link className="text-sm text-zinc-500 hover:text-zinc-950" href={`/ledger?month=${month}`}>
            수정 취소
          </Link>
        )}
      </div>

      <form action={action} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-6">
        <input name="transactionId" type="hidden" value={editing?.id ?? ''} />
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          날짜
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            defaultValue={editing?.date ?? defaultDate}
            name="date"
            required
            type="date"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          유형
          <select
            className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700 xl:col-span-2">
          분류
          <select
            className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          금액
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2.5 text-right font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            defaultValue={editing?.amount ?? ''}
            inputMode="numeric"
            name="amount"
            placeholder="0"
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          결제수단
          <select
            className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2 xl:col-span-4">
          사용내역
          <input
            className="rounded-lg border border-zinc-300 px-3 py-2.5 font-normal outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            defaultValue={editing?.memo ?? ''}
            maxLength={200}
            name="memo"
            placeholder="예: 주말 장보기"
          />
        </label>
        <div className="flex items-end">
          {flow === 'expense' && (
            <label className="flex items-center gap-2 pb-2.5 text-sm text-zinc-700">
              <input defaultChecked={editing?.fixed ?? false} name="fixed" type="checkbox" />
              고정지출
            </label>
          )}
        </div>
        <div className="flex items-end justify-end">
          <SubmitButton editing={Boolean(editing)} />
        </div>
        {state.error && (
          <p className="text-sm text-red-700 md:col-span-2 xl:col-span-6">{state.error}</p>
        )}
      </form>
    </article>
  )
}

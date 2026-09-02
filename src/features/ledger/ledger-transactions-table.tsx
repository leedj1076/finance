'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatWon } from '@/lib/finance'

import { deleteTransaction, saveTransaction, type TransactionActionState } from './actions'
import type { LedgerFilters } from './filters'
import type { TransactionFlow } from './transaction-input'

type AccountOption = { id: number; name: string }
type CategoryOption = { id: number; kind: TransactionFlow; major: string; sub: string }
type LedgerRow = {
  id: number
  date: string
  flow: TransactionFlow
  fixed: boolean
  categoryId: number | null
  major: string | null
  sub: string | null
  memo: string | null
  rawMerchant: string | null
  amount: number
  accountId: number | null
  account: string | null
}

const flowLabel = { income: '수입', expense: '지출', saving: '저축' } as const
const flowStyle = { income: 'bg-blue-50 text-blue-700', expense: 'bg-rose-50 text-rose-700', saving: 'bg-emerald-50 text-emerald-700' } as const
const initialState: TransactionActionState = {}
const editInput = 'w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

function RowSaveButton() {
  const { pending } = useFormStatus()
  return <button aria-label="거래 수정 저장" className="rounded bg-zinc-800 px-2 py-1.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50" disabled={pending} type="submit">{pending ? '…' : '✓'}</button>
}

function EditableRow({ accounts, categories, filters, onCancel, row }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  filters: LedgerFilters
  onCancel: () => void
  row: LedgerRow
}) {
  const [state, action] = useActionState(saveTransaction, initialState)
  const [flowToken, setFlowToken] = useState(row.flow === 'expense' ? (row.fixed ? 'expense_fixed' : 'expense_variable') : row.flow)
  const flow: TransactionFlow = flowToken.startsWith('expense') ? 'expense' : flowToken as TransactionFlow
  const visibleCategories = categories.filter((category) => category.kind === flow)
  const formId = `ledger-edit-${row.id}`

  function rememberScroll() {
    sessionStorage.setItem('ledgerScrollY', String(window.scrollY))
  }

  return (
    <>
      <tr className="bg-amber-50/70 align-top">
        <td className="px-2 py-2"><input aria-label="날짜" className={editInput} defaultValue={row.date} form={formId} name="date" required type="date" /></td>
        <td className="px-2 py-2">
          <select aria-label="거래 유형" className={editInput} onChange={(event) => setFlowToken(event.target.value)} value={flowToken}>
            <option value="expense_variable">변동지출</option><option value="expense_fixed">고정지출</option><option value="income">수입</option><option value="saving">저축</option>
          </select>
          <input form={formId} name="flow" type="hidden" value={flow} />
          {flowToken === 'expense_fixed' && <input form={formId} name="fixed" type="hidden" value="on" />}
        </td>
        <td className="px-2 py-2">
          <select aria-label="분류" className={editInput} defaultValue={visibleCategories.some((category) => category.id === row.categoryId) ? row.categoryId ?? '' : ''} form={formId} name="categoryId">
            <option value="">미분류</option>
            {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}
          </select>
        </td>
        <td className="px-2 py-2"><input aria-label="사용내역" className={editInput} defaultValue={row.memo ?? row.rawMerchant ?? ''} form={formId} maxLength={200} name="memo" /></td>
        <td className="px-2 py-2"><input aria-label="금액" className={`${editInput} text-right`} defaultValue={row.amount} form={formId} inputMode="numeric" name="amount" required /></td>
        <td className="px-2 py-2">
          <select aria-label="결제수단" className={editInput} defaultValue={row.accountId ?? ''} form={formId} name="accountId">
            <option value="">선택 안 함</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-2">
          <form action={action} className="flex justify-end gap-1" id={formId} onSubmit={rememberScroll}>
            <input name="transactionId" type="hidden" value={row.id} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnQ" type="hidden" value={filters.q} />
            <RowSaveButton />
            <button aria-label="거래 수정 취소" className="rounded px-2 py-1.5 text-xs text-zinc-500 hover:bg-white hover:text-zinc-900" onClick={onCancel} type="button">✕</button>
          </form>
        </td>
      </tr>
      {state.error && <tr className="bg-rose-50"><td className="px-4 py-2 text-xs text-rose-700" colSpan={7}>{state.error}</td></tr>}
    </>
  )
}

export function LedgerTransactionsTable({ accounts, categories, filters, month, rows }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  filters: LedgerFilters
  month: string
  rows: LedgerRow[]
}) {
  const [editingId, setEditingId] = useState<number | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('ledgerScrollY')
    if (!stored) return
    sessionStorage.removeItem('ledgerScrollY')
    requestAnimationFrame(() => window.scrollTo({ top: Number(stored), behavior: 'auto' }))
  }, [])

  function rememberScroll() {
    sessionStorage.setItem('ledgerScrollY', String(window.scrollY))
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-4 py-2.5 font-medium">날짜</th><th className="px-2 py-2.5 font-medium">구분</th><th className="px-2 py-2.5 font-medium">분류</th><th className="px-2 py-2.5 font-medium">사용내역</th><th className="px-2 py-2.5 text-right font-medium">금액</th><th className="px-2 py-2.5 font-medium">결제수단</th><th className="px-3 py-2.5 text-right font-medium">관리</th></tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => editingId === row.id ? (
            <EditableRow accounts={accounts} categories={categories} filters={filters} key={row.id} onCancel={() => setEditingId(null)} row={row} />
          ) : (
            <tr className="group cursor-pointer hover:bg-zinc-50" key={row.id} onClick={() => setEditingId(row.id)} title="클릭해서 수정">
              <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500">{row.date.slice(5)}</td>
              <td className="px-2 py-2.5"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${flowStyle[row.flow]}`}>{row.flow === 'expense' && row.fixed ? '고정지출' : flowLabel[row.flow]}</span></td>
              <td className="px-2 py-2.5 text-zinc-700"><span>{row.major ?? '미분류'}</span>{row.sub && <span className="text-zinc-400"> · {row.sub}</span>}</td>
              <td className="max-w-64 truncate px-2 py-2.5 text-zinc-700">{row.memo || row.rawMerchant || '-'}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right font-medium text-zinc-950">{formatWon(row.amount)}원</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-zinc-500">{row.account ?? '-'}</td>
              <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                <div className="flex justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                  <button className="text-xs text-zinc-500 hover:text-zinc-950" onClick={() => setEditingId(row.id)} type="button">수정</button>
                  <form action={deleteTransaction} onSubmit={(event) => { if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault(); else rememberScroll() }}>
                    <input name="transactionId" type="hidden" value={row.id} /><input name="month" type="hidden" value={month} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnQ" type="hidden" value={filters.q} />
                    <button className="text-xs text-zinc-400 hover:text-rose-700" type="submit">삭제</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-5 py-12 text-center text-zinc-500" colSpan={7}>조건에 맞는 거래가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

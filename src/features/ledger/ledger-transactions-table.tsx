'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState, useTransition } from 'react'
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
const flowStyle = { income: 'bg-finance-blue-tint text-finance-blue', expense: 'bg-finance-red-tint text-finance-red', saving: 'bg-finance-green-tint text-finance-green' } as const
const initialState: TransactionActionState = {}
const editInput = 'h-[30px] w-full border border-finance-border bg-white px-2 text-xs text-finance-ink outline-none focus:border-finance-blue'

function RowSaveButton() {
  const { pending } = useFormStatus()
  return <button aria-label="거래 수정 저장" className="h-[30px] bg-finance-green px-2.5 text-xs font-semibold text-white hover:bg-finance-ink disabled:opacity-50" disabled={pending} type="submit">{pending ? '…' : '✓'}</button>
}

function EditableRow({ accounts, categories, filters, onCancel, onSaved, row }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  filters: LedgerFilters
  onCancel: () => void
  onSaved: (saved: NonNullable<TransactionActionState['saved']>) => void
  row: LedgerRow
}) {
  const [state, action] = useActionState(async (
    previousState: TransactionActionState,
    formData: FormData,
  ) => {
    const result = await saveTransaction(previousState, formData)
    if (result.saved) onSaved(result.saved)
    return result
  }, initialState)
  const [flowToken, setFlowToken] = useState(row.flow === 'expense' ? (row.fixed ? 'expense_fixed' : 'expense_variable') : row.flow)
  const flow: TransactionFlow = flowToken.startsWith('expense') ? 'expense' : flowToken as TransactionFlow
  const visibleCategories = categories.filter((category) => category.kind === flow)
  const formId = `ledger-edit-${row.id}`

  return (
    <>
      <tr className="bg-finance-panel align-top">
        <td className="py-2 pr-2"><input aria-label="날짜" className={editInput} defaultValue={row.date} form={formId} name="date" required type="date" /></td>
        <td className="px-2 py-2"><input aria-label="사용내역" className={editInput} defaultValue={row.memo ?? row.rawMerchant ?? ''} form={formId} maxLength={200} name="memo" /></td>
        <td className="px-2 py-2">
          <select aria-label="분류" className={editInput} defaultValue={visibleCategories.some((category) => category.id === row.categoryId) ? row.categoryId ?? '' : ''} form={formId} name="categoryId">
            <option value="">미분류</option>
            {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">
          <select aria-label="결제수단" className={editInput} defaultValue={row.accountId ?? ''} form={formId} name="accountId">
            <option value="">선택 안 함</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">
          <select aria-label="거래 유형" className={editInput} onChange={(event) => setFlowToken(event.target.value)} value={flowToken}>
            <option value="expense_variable">변동지출</option><option value="expense_fixed">고정지출</option><option value="income">수입</option><option value="saving">저축</option>
          </select>
          <input form={formId} name="flow" type="hidden" value={flow} />
          {flowToken === 'expense_fixed' && <input form={formId} name="fixed" type="hidden" value="on" />}
        </td>
        <td className="px-2 py-2"><input aria-label="금액" className={`${editInput} text-right`} defaultValue={row.amount} form={formId} inputMode="numeric" name="amount" required /></td>
        <td className="py-2 pl-2">
          <form action={action} className="flex justify-end gap-1" id={formId}>
            <input name="inline" type="hidden" value="1" />
            <input name="transactionId" type="hidden" value={row.id} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnQ" type="hidden" value={filters.q} />
            <RowSaveButton />
            <button aria-label="거래 수정 취소" className="h-[30px] px-2 text-xs text-finance-muted hover:bg-white hover:text-finance-ink" onClick={onCancel} type="button">✕</button>
          </form>
        </td>
      </tr>
      {state.error && <tr><td className="border-l-2 border-finance-red px-4 py-2 text-xs text-finance-red" colSpan={7}>{state.error}</td></tr>}
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
  const router = useRouter()
  const [, startRefresh] = useTransition()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [localRows, setLocalRows] = useState(rows)
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('ledgerScrollY')
    if (!stored) return
    sessionStorage.removeItem('ledgerScrollY')
    requestAnimationFrame(() => window.scrollTo({ top: Number(stored), behavior: 'auto' }))
  }, [])

  function rememberScroll() {
    sessionStorage.setItem('ledgerScrollY', String(window.scrollY))
  }

  function applySavedRow(saved: NonNullable<TransactionActionState['saved']>) {
    const category = categories.find((item) => item.id === saved.categoryId)
    const account = accounts.find((item) => item.id === saved.accountId)
    setLocalRows((current) => current.map((row) => row.id === saved.id
      ? {
          ...row,
          ...saved,
          major: category?.major ?? null,
          sub: category?.sub ?? null,
          account: account?.name ?? null,
        }
      : row))
    setEditingId(null)
    setSavedId(saved.id)
    window.setTimeout(() => setSavedId((current) => current === saved.id ? null : current), 1_500)
    startRefresh(() => router.refresh())
  }

  return (
    <div className="overflow-x-auto border-t border-finance-ink">
      <table className="w-full min-w-[920px] text-left text-[13px]">
        <thead className="border-b border-finance-border text-[11px] font-semibold uppercase tracking-[0.06em] text-finance-muted"><tr><th className="py-[9px] pr-2 font-semibold">날짜</th><th className="px-2 py-[9px] font-semibold">가맹점·사용내역</th><th className="px-2 py-[9px] font-semibold">분류</th><th className="px-2 py-[9px] font-semibold">결제수단</th><th className="px-2 py-[9px] text-center font-semibold">구분</th><th className="px-2 py-[9px] text-right font-semibold">금액</th><th className="py-[9px] pl-2 text-right font-semibold">관리</th></tr></thead>
        <tbody className="divide-y divide-finance-track">
          {localRows.map((row) => editingId === row.id ? (
            <EditableRow accounts={accounts} categories={categories} filters={filters} key={row.id} onCancel={() => setEditingId(null)} onSaved={applySavedRow} row={row} />
          ) : (
            <tr className={`group cursor-pointer transition-colors ${savedId === row.id ? 'bg-finance-green-tint' : 'hover:bg-finance-panel'}`} key={row.id} onClick={() => setEditingId(row.id)} title="클릭해서 수정">
              <td className="whitespace-nowrap py-[11px] pr-2 text-finance-muted">{row.date.slice(5)}</td>
              <td className="max-w-64 truncate px-2 py-[11px] font-medium text-finance-ink">{row.memo || row.rawMerchant || '-'}</td>
              <td className="px-2 py-[11px] text-finance-muted"><span>{row.major ?? '미분류'}</span>{row.sub && <span className="text-finance-faint"> › {row.sub}</span>}</td>
              <td className="whitespace-nowrap px-2 py-[11px] text-finance-muted">{row.account ?? '-'}</td>
              <td className="px-2 py-[11px] text-center"><span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold ${flowStyle[row.flow]}`}>{row.flow === 'expense' && row.fixed ? '고정지출' : flowLabel[row.flow]}</span></td>
              <td className={`whitespace-nowrap px-2 py-[11px] text-right font-semibold ${row.flow === 'income' ? 'text-finance-blue' : row.flow === 'saving' ? 'text-finance-green' : 'text-finance-ink'}`}>{row.flow === 'income' ? '+' : ''}{formatWon(row.amount)}원</td>
              <td className="py-[11px] pl-2" onClick={(event) => event.stopPropagation()}>
                <div className={`flex justify-end gap-2 transition ${savedId === row.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {savedId === row.id && <span className="text-xs font-medium text-finance-green">저장됨</span>}
                  <button className="text-xs text-finance-muted hover:text-finance-ink" onClick={() => setEditingId(row.id)} type="button">수정</button>
                  <form action={deleteTransaction} onSubmit={(event) => { if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault(); else rememberScroll() }}>
                    <input name="transactionId" type="hidden" value={row.id} /><input name="month" type="hidden" value={month} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnQ" type="hidden" value={filters.q} />
                    <button className="text-xs text-finance-faint hover:text-finance-red" type="submit">삭제</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {localRows.length === 0 && <tr><td className="px-5 py-12 text-center text-finance-muted" colSpan={7}>조건에 맞는 거래가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

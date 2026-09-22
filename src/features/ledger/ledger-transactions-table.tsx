'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
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
const editInput = 'h-[30px] w-full border border-finance-border bg-white px-2 t-body text-finance-ink outline-none focus:border-finance-blue'

function RowSaveButton({ mobile = false, busy = false }: { mobile?: boolean; busy?: boolean }) {
  const { pending: formPending } = useFormStatus()
  const pending = busy || formPending
  return <button aria-label="거래 수정 저장" className={`${mobile ? 'min-h-11 px-4 text-sm' : 'h-[30px] px-2.5 t-body-strong'} bg-finance-ink text-white hover:bg-finance-blue disabled:opacity-40`} disabled={pending} type="submit">{pending ? (mobile ? '저장 중…' : '…') : mobile ? '저장' : '✓'}</button>
}

type EditDraft = {
  id: number
  date: string
  memo: string
  amount: string
  categoryId: string
  accountId: string
  flowToken: string
}

function useTransactionEditor(onSaved: (saved: NonNullable<TransactionActionState['saved']>, message?: string) => void) {
  // Both responsive layouts read one draft and submit through one action.
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [error, setError] = useState('')
  const [, action, pending] = useActionState(async (
    previousState: TransactionActionState,
    formData: FormData,
  ) => {
    try {
      const result = await saveTransaction(previousState, formData)
      if (result.saved) {
        setDraft(null)
        setError('')
        onSaved(result.saved, result.message)
      } else setError(result.error ?? '')
      return result
    } catch {
      const error = '저장하지 못했습니다. 수정 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.'
      setError(error)
      return { error }
    }
  }, initialState)

  function begin(row: LedgerRow) {
    if (pending || draft?.id === row.id) return
    setError('')
    setDraft({ id: row.id, date: row.date, memo: row.memo ?? row.rawMerchant ?? '', amount: String(row.amount),
      categoryId: String(row.categoryId ?? ''), accountId: String(row.accountId ?? ''),
      flowToken: row.flow === 'expense' ? (row.fixed ? 'expense_fixed' : 'expense_variable') : row.flow })
  }

  return {
    draft, error, action, pending, begin,
    cancel: () => { if (!pending) { setDraft(null); setError('') } },
    update: (key: keyof Omit<EditDraft, 'id'>, value: string) => {
      if (!pending) setDraft(current => current ? { ...current, [key]: value } : current)
    },
  }
}

function EditableRow({ accounts, categories, editor, filters, onCancel, mobile = false }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  editor: ReturnType<typeof useTransactionEditor>
  filters: LedgerFilters
  onCancel: () => void
  mobile?: boolean
}) {
  if (!editor.draft) return null
  const { draft, action, error } = editor
  const { date, memo, amount, categoryId, accountId, flowToken } = draft
  const setDate = (value: string) => editor.update('date', value)
  const setMemo = (value: string) => editor.update('memo', value)
  const setAmount = (value: string) => editor.update('amount', value)
  const setCategoryId = (value: string) => editor.update('categoryId', value)
  const setAccountId = (value: string) => editor.update('accountId', value)
  const setFlowToken = (value: string) => editor.update('flowToken', value)
  const flow: TransactionFlow = flowToken.startsWith('expense') ? 'expense' : flowToken as TransactionFlow
  const visibleCategories = categories.filter((category) => category.kind === flow)
  const formId = `ledger-edit-${mobile ? 'mobile-' : ''}${draft.id}`

  if (mobile) {
    const input = 'min-h-11 min-w-0 w-full border border-finance-border bg-white px-3 text-base text-finance-ink focus:border-finance-blue'
    const label = 'grid min-w-0 gap-1.5 text-sm text-finance-muted'
    return (
      <form action={action} aria-label="거래 수정" className="grid min-w-0 gap-3" id={formId}>
        <input name="inline" type="hidden" value="1" />
        <input name="transactionId" type="hidden" value={draft.id} />
        <input name="returnSort" type="hidden" value={filters.sort ?? 'date-desc'} />
        <input name="returnAccount" type="hidden" value={filters.account} />
        <input name="returnFlow" type="hidden" value={filters.flow} />
        <input name="returnMajor" type="hidden" value={filters.major} />
        <input name="returnSub" type="hidden" value={filters.sub ?? ''} />
        <input name="returnQ" type="hidden" value={filters.q} />
        <label className={label}>사용내역<input autoFocus className={input} value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={200} name="memo" /></label>
        <div className="grid gap-1.5">
          <label className="text-sm text-finance-muted" htmlFor={`${formId}-amount`}>금액</label>
          <div className="flex min-w-0 gap-2">
            <input aria-label="금액" id={`${formId}-amount`} className={`${input} text-right`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" name="amount" required />
            <button aria-label="금액 부호 바꾸기" aria-pressed={amount.trim().startsWith('-')} className="min-h-11 min-w-11 shrink-0 border border-finance-border text-base text-finance-ink" disabled={editor.pending} onClick={() => setAmount(amount.trim().startsWith('-') ? amount.trim().slice(1) : `-${amount.trim().replace(/^\+/, '')}`)} type="button">±</button>
          </div>
        </div>
        <label className={label}>날짜<input className={input} value={date} onChange={(event) => setDate(event.target.value)} name="date" required type="date" /></label>
        <label className={label}>거래 유형
          <select aria-label="거래 유형" className={input} onChange={(event) => setFlowToken(event.target.value)} value={flowToken}>
            <option value="expense_variable">변동지출</option><option value="expense_fixed">고정지출</option><option value="income">수입</option><option value="saving">저축</option>
          </select>
        </label>
        <input name="flow" type="hidden" value={flow} />
        {flowToken === 'expense_fixed' && <input name="fixed" type="hidden" value="on" />}
        <label className={label}>분류
          <select aria-label="분류" className={input} value={visibleCategories.some((category) => String(category.id) === categoryId) ? categoryId : ''} onChange={(event) => setCategoryId(event.target.value)} name="categoryId">
            <option value="">미분류</option>
            {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}
          </select>
        </label>
        <label className={label}>결제수단
          <select aria-label="결제수단" className={input} value={accountId} onChange={(event) => setAccountId(event.target.value)} name="accountId">
            <option value="">선택 안 함</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="border-l-2 border-finance-red pl-3 text-sm text-finance-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button aria-label="거래 수정 취소" className="min-h-11 border border-finance-border px-4 text-sm text-finance-muted disabled:opacity-40" disabled={editor.pending} onClick={onCancel} type="button">취소</button>
          <RowSaveButton busy={editor.pending} mobile />
        </div>
      </form>
    )
  }

  return (
    <>
      <tr className="bg-finance-panel align-top">
        <td className="py-2 pr-2"><input aria-label="날짜" className={editInput} value={date} onChange={(event) => setDate(event.target.value)} form={formId} name="date" required type="date" /></td>
        <td className="px-2 py-2"><input aria-label="사용내역" className={editInput} value={memo} onChange={(event) => setMemo(event.target.value)} form={formId} maxLength={200} name="memo" /></td>
        <td className="px-2 py-2">
          <select aria-label="분류" className={editInput} value={visibleCategories.some((category) => String(category.id) === categoryId) ? categoryId : ''} onChange={(event) => setCategoryId(event.target.value)} form={formId} name="categoryId">
            <option value="">미분류</option>
            {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">
          <select aria-label="결제수단" className={editInput} value={accountId} onChange={(event) => setAccountId(event.target.value)} form={formId} name="accountId">
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
        <td className="px-2 py-2"><input aria-label="금액" className={`${editInput} text-right`} value={amount} onChange={(event) => setAmount(event.target.value)} form={formId} inputMode="numeric" name="amount" required /></td>
        <td className="py-2 pl-2">
          <form action={action} className="flex justify-end gap-1" id={formId}>
            <input name="inline" type="hidden" value="1" />
            <input name="returnSort" type="hidden" value={filters.sort ?? 'date-desc'} />
            <input name="transactionId" type="hidden" value={draft.id} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnSub" type="hidden" value={filters.sub ?? ''} /><input name="returnQ" type="hidden" value={filters.q} />
            <RowSaveButton busy={editor.pending} />
            <button aria-label="거래 수정 취소" className="h-[30px] px-2 t-caption text-finance-muted hover:bg-white hover:text-finance-ink disabled:opacity-40" disabled={editor.pending} onClick={onCancel} type="button">✕</button>
          </form>
        </td>
      </tr>
      {error && <tr><td className="border-l-2 border-finance-red px-4 py-2 t-caption text-finance-red" colSpan={7}>{error}</td></tr>}
    </>
  )
}

function MobileTransaction({ accounts, categories, editor, filters, month, rememberScroll, row, saved }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  filters: LedgerFilters
  month: string
  editor: ReturnType<typeof useTransactionEditor>
  rememberScroll: () => void
  row: LedgerRow
  saved: boolean
}) {
  const editing = editor.draft?.id === row.id
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const editRef = useRef<HTMLButtonElement>(null)
  const name = row.memo || row.rawMerchant || '-'
  const amountColor = row.flow === 'income' ? 'text-finance-blue' : row.flow === 'saving' ? 'text-finance-green' : 'text-finance-ink'

  useEffect(() => {
    if (editing && detailsRef.current) detailsRef.current.open = true
  }, [editing])

  useEffect(() => {
    if (saved && summaryRef.current?.getClientRects().length) summaryRef.current.focus()
  }, [saved])

  return (
    <li className={`min-w-0 ${saved ? 'bg-finance-green-tint' : ''}`}>
      <details ref={detailsRef} className="group/transaction">
        <summary ref={summaryRef} className="cursor-pointer list-none py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-finance-blue [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-start justify-between gap-3 text-[15px] font-semibold leading-6">
            <span className="min-w-0 truncate text-finance-ink">{name}</span>
            <span className={`shrink-0 whitespace-nowrap tabular-nums ${amountColor}`}>{row.flow === 'income' ? '+' : ''}{formatWon(row.amount)}원</span>
          </span>
          <span className="mt-1 flex min-w-0 items-start gap-2 text-[13px] leading-5 text-finance-muted">
            <span className="min-w-0 flex-1 break-words"><time dateTime={row.date}>{row.date.slice(5).replace('-', '.')}</time> · {row.major ?? '미분류'}{row.sub && ` / ${row.sub}`} · {row.account ?? '결제수단 미지정'}</span>
            <span aria-hidden="true" className="shrink-0 transition-transform group-open/transaction:rotate-180">⌄</span>
          </span>
        </summary>
        <div className="min-w-0 border-t border-finance-track pb-4 pt-3">
          {editing ? (
            <EditableRow accounts={accounts} categories={categories} editor={editor} filters={filters} mobile
              onCancel={() => { editor.cancel(); requestAnimationFrame(() => editRef.current?.focus()) }} />
          ) : (
            <>
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm leading-6">
                <dt className="text-finance-muted">사용내역</dt><dd className="break-words text-finance-ink">{name}</dd>
                <dt className="text-finance-muted">날짜</dt><dd>{row.date}</dd>
                <dt className="text-finance-muted">분류</dt><dd className="break-words">{row.major ?? '미분류'}{row.sub && ` › ${row.sub}`}</dd>
                <dt className="text-finance-muted">결제수단</dt><dd className="break-words">{row.account ?? '결제수단 미지정'}</dd>
                <dt className="text-finance-muted">구분</dt><dd>{row.flow === 'expense' && row.fixed ? '고정지출' : flowLabel[row.flow]}</dd>
              </dl>
              <div className="mt-3 flex items-center justify-end gap-2">
                {saved && <span role="status" className="mr-auto text-sm text-finance-green">저장됨</span>}
                <button ref={editRef} className="min-h-11 border border-finance-border px-4 text-sm text-finance-ink disabled:opacity-40" disabled={editor.pending} onClick={() => editor.begin(row)} type="button">수정</button>
                <form action={deleteTransaction} onSubmit={(event) => { if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault(); else rememberScroll() }}>
                  <input name="transactionId" type="hidden" value={row.id} /><input name="month" type="hidden" value={month} />
                  <input name="returnSort" type="hidden" value={filters.sort ?? 'date-desc'} /><input name="returnAccount" type="hidden" value={filters.account} />
                  <input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} />
                  <input name="returnSub" type="hidden" value={filters.sub ?? ''} /><input name="returnQ" type="hidden" value={filters.q} />
                  <button className="min-h-11 border border-finance-border px-4 text-sm text-finance-red" type="submit">삭제</button>
                </form>
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  )
}

export function LedgerTransactionsTable({ accounts, categories, filters, month, rows }: {
  accounts: AccountOption[]
  categories: CategoryOption[]
  filters: LedgerFilters
  month: string
  rows: LedgerRow[]
}) {
  const [localRows, setLocalRows] = useState(rows)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const editor = useTransactionEditor(applySavedRow)

  // Inline edits update immediately; subsequent server refreshes can also
  // insert, remove or re-filter rows without remounting this table.
  useEffect(() => setLocalRows(rows), [rows])

  useEffect(() => {
    const stored = sessionStorage.getItem('ledgerScrollY')
    if (!stored) return
    sessionStorage.removeItem('ledgerScrollY')
    requestAnimationFrame(() => window.scrollTo({ top: Number(stored), behavior: 'auto' }))
  }, [])

  function rememberScroll() {
    sessionStorage.setItem('ledgerScrollY', String(window.scrollY))
  }

  function applySavedRow(saved: NonNullable<TransactionActionState['saved']>, message?: string) {
    setNotice(message ?? '')
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
    setSavedId(saved.id)
    window.setTimeout(() => setSavedId((current) => current === saved.id ? null : current), 1_500)
    // saveTransaction already revalidates the ledger in this action response,
    // including totals and rows that stop matching the current filters.
  }

  return (
    <div className="min-w-0 border-t border-finance-ink">
      {notice && <p role="status" className="border-l-2 border-finance-green px-4 py-3 t-caption text-finance-green">{notice}</p>}
      <ul aria-label="거래 내역" className="min-w-0 divide-y divide-finance-track min-[861px]:hidden">
        {localRows.map((row) => <MobileTransaction key={row.id} accounts={accounts} categories={categories} editor={editor} filters={filters} month={month} rememberScroll={rememberScroll} row={row} saved={savedId === row.id} />)}
        {localRows.length === 0 && <li className="py-12 text-center text-sm text-finance-muted">조건에 맞는 거래가 없습니다.</li>}
      </ul>
      <div className="hidden overflow-x-auto min-[861px]:block">
      <table className="w-full min-w-[920px] text-left t-body">
        <thead className="border-b border-finance-border t-label uppercase text-finance-muted"><tr><th className="py-[9px] pr-2 font-semibold">날짜</th><th className="px-2 py-[9px] font-semibold">가맹점·사용내역</th><th className="px-2 py-[9px] font-semibold">분류</th><th className="px-2 py-[9px] font-semibold">결제수단</th><th className="px-2 py-[9px] text-center font-semibold">구분</th><th className="px-2 py-[9px] text-right font-semibold">금액</th><th className="py-[9px] pl-2 text-right font-semibold">관리</th></tr></thead>
        <tbody className="divide-y divide-finance-track">
          {localRows.map((row) => editor.draft?.id === row.id ? (
            <EditableRow accounts={accounts} categories={categories} editor={editor} filters={filters} key={row.id} onCancel={editor.cancel} />
          ) : (
            <tr className={`group cursor-pointer transition-colors ${savedId === row.id ? 'bg-finance-green-tint' : 'hover:bg-finance-panel'}`} key={row.id} onClick={() => editor.begin(row)} title="클릭해서 수정">
              <td className="whitespace-nowrap py-[11px] pr-2 text-finance-muted">{row.date.slice(5)}</td>
              <td className="max-w-64 truncate px-2 py-[11px] font-medium text-finance-ink">{row.memo || row.rawMerchant || '-'}</td>
              <td className="px-2 py-[11px] text-finance-muted"><span>{row.major ?? '미분류'}</span>{row.sub && <span className="text-finance-faint"> › {row.sub}</span>}</td>
              <td className="whitespace-nowrap px-2 py-[11px] text-finance-muted">{row.account ?? '-'}</td>
              <td className="px-2 py-[11px] text-center"><span className={`inline-flex px-2 py-0.5 t-badge ${flowStyle[row.flow]}`}>{row.flow === 'expense' && row.fixed ? '고정지출' : flowLabel[row.flow]}</span></td>
              <td className={`whitespace-nowrap px-2 py-[11px] text-right font-semibold ${row.flow === 'income' ? 'text-finance-blue' : row.flow === 'saving' ? 'text-finance-green' : 'text-finance-ink'}`}>{row.flow === 'income' ? '+' : ''}{formatWon(row.amount)}원</td>
              <td className="py-[11px] pl-2" onClick={(event) => event.stopPropagation()}>
                <div className={`flex justify-end gap-2 transition ${savedId === row.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  {savedId === row.id && <span className="t-caption font-medium text-finance-green">저장됨</span>}
                  <button className="t-caption text-finance-muted hover:text-finance-ink" onClick={() => editor.begin(row)} type="button">수정</button>
                  <form action={deleteTransaction} onSubmit={(event) => { if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault(); else rememberScroll() }}>
                    <input name="returnSort" type="hidden" value={filters.sort ?? 'date-desc'} />
                    <input name="transactionId" type="hidden" value={row.id} /><input name="month" type="hidden" value={month} /><input name="returnAccount" type="hidden" value={filters.account} /><input name="returnFlow" type="hidden" value={filters.flow} /><input name="returnMajor" type="hidden" value={filters.major} /><input name="returnSub" type="hidden" value={filters.sub ?? ''} /><input name="returnQ" type="hidden" value={filters.q} />
                    <button className="t-caption text-finance-faint hover:text-finance-red" type="submit">삭제</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {localRows.length === 0 && <tr><td className="px-5 py-12 text-center text-finance-muted" colSpan={7}>조건에 맞는 거래가 없습니다.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  )
}

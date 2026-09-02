'use client'

import { useMemo, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'
import { formatWon } from '@/lib/finance'

import { bulkClassifyTransactions } from './actions'
import {
  classificationFromToken,
  classificationToken,
  type BulkClassificationFlow,
  type BulkClassificationToken,
} from './bulk-classification'

type BulkCategory = {
  id: number
  kind: BulkClassificationFlow
  major: string
  sub: string
}

type BulkTransaction = {
  id: number
  date: string
  flow: BulkClassificationFlow
  fixed: boolean
  memo: string | null
  rawMerchant: string | null
  amount: number
  accountName: string | null
  suggestedFlow: BulkClassificationFlow
  suggestedFixed: boolean
  suggestedCategoryId: number | null
  suggestionSource: 'rule' | 'history' | null
}

type BulkClassifyFormProps = {
  categories: BulkCategory[]
  rows: BulkTransaction[]
}

const inputClass = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
const saveButton = 'rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60'

const tokenLabels: Record<BulkClassificationToken, string> = {
  exp_var: '변동지출',
  exp_fix: '고정지출',
  income: '수입',
  saving: '저축',
}

export function BulkClassifyForm({ categories, rows }: BulkClassifyFormProps) {
  const [tokens, setTokens] = useState<Record<number, BulkClassificationToken>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.id, classificationToken(row.suggestedFlow, row.suggestedFixed)]),
    ),
  )
  const [categoryIds, setCategoryIds] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, String(row.suggestedCategoryId ?? '')])),
  )
  const [suggestionSources, setSuggestionSources] = useState<
    Record<number, BulkTransaction['suggestionSource']>
  >(() => Object.fromEntries(rows.map((row) => [row.id, row.suggestionSource])))
  const [selected, setSelected] = useState(
    () => new Set(rows.filter((row) => row.suggestedCategoryId !== null).map((row) => row.id)),
  )

  const selectableIds = useMemo(
    () => rows.filter((row) => Boolean(categoryIds[row.id])).map((row) => row.id),
    [categoryIds, rows],
  )

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function changeToken(id: number, token: BulkClassificationToken) {
    setTokens((current) => ({ ...current, [id]: token }))
    setCategoryIds((current) => ({ ...current, [id]: '' }))
    setSuggestionSources((current) => ({ ...current, [id]: null }))
    setSelected((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  function changeCategory(id: number, categoryId: string) {
    setCategoryIds((current) => ({ ...current, [id]: categoryId }))
    setSuggestionSources((current) => ({ ...current, [id]: null }))
    setSelected((current) => {
      const next = new Set(current)
      if (categoryId) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <form action={bulkClassifyTransactions} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold text-zinc-950">미분류 거래 일괄 분류</h2>
          <p className="mt-1 text-xs text-zinc-500">
            규칙·이력 추천은 미리 선택했습니다. 유형과 카테고리를 확인한 뒤 저장해 주세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="text-xs font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4"
            onClick={() => setSelected(new Set(selectableIds))}
            type="button"
          >
            분류된 행 전체 선택
          </button>
          <button
            className="text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-4"
            onClick={() => setSelected(new Set())}
            type="button"
          >
            선택 해제
          </button>
          <span className="text-xs text-zinc-500">{selected.size}건 선택</span>
          <SubmitButton
            className={saveButton}
            disabled={selected.size === 0}
            pendingLabel="분류 중…"
            type="submit"
          >
            선택 거래 저장
          </SubmitButton>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="w-14 px-4 py-3 font-medium" scope="col">선택</th>
              <th className="px-3 py-3 font-medium" scope="col">날짜</th>
              <th className="px-3 py-3 font-medium" scope="col">사용내역</th>
              <th className="px-3 py-3 text-right font-medium" scope="col">금액</th>
              <th className="min-w-36 px-3 py-3 font-medium" scope="col">구분</th>
              <th className="min-w-72 px-3 py-3 font-medium" scope="col">카테고리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((transaction) => {
              const classification = classificationFromToken(tokens[transaction.id])!
              const visibleCategories = categories.filter(
                (category) => category.kind === classification.flow,
              )
              const source = suggestionSources[transaction.id]
              const categorySelected = Boolean(categoryIds[transaction.id])

              return (
                <tr className="hover:bg-zinc-50" key={transaction.id}>
                  <td className="px-4 py-3 text-center">
                    <input
                      aria-label={`${transaction.rawMerchant || transaction.memo || '거래'} 선택`}
                      checked={selected.has(transaction.id)}
                      className="h-4 w-4 accent-emerald-700 disabled:opacity-40"
                      disabled={!categorySelected}
                      name="ids"
                      onChange={() => toggle(transaction.id)}
                      type="checkbox"
                      value={transaction.id}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-500">
                    {transaction.date}
                  </td>
                  <td className="max-w-80 px-3 py-3">
                    <p className="truncate font-medium text-zinc-950">
                      {transaction.rawMerchant || transaction.memo || '내용 없음'}
                    </p>
                    <p className="mt-1 truncate text-xs text-zinc-400">
                      {transaction.accountName ?? '결제수단 없음'}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-zinc-900">
                    {formatWon(transaction.amount)}원
                  </td>
                  <td className="px-3 py-3">
                    <select
                      aria-label={`${transaction.rawMerchant || transaction.memo || '거래'} 유형`}
                      className={inputClass}
                      name={`flow_${transaction.id}`}
                      onChange={(event) => changeToken(
                        transaction.id,
                        event.target.value as BulkClassificationToken,
                      )}
                      value={tokens[transaction.id]}
                    >
                      {(Object.keys(tokenLabels) as BulkClassificationToken[]).map((token) => (
                        <option key={token} value={token}>{tokenLabels[token]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`${transaction.rawMerchant || transaction.memo || '거래'} 카테고리`}
                        className={`${inputClass} min-w-56 flex-1`}
                        name={`category_${transaction.id}`}
                        onChange={(event) => changeCategory(transaction.id, event.target.value)}
                        value={categoryIds[transaction.id] ?? ''}
                      >
                        <option value="">선택</option>
                        {visibleCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.major} · {category.sub}
                          </option>
                        ))}
                      </select>
                      {source && (
                        <span className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-medium ${
                          source === 'rule'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}>
                          {source === 'rule' ? '규칙' : '이력'}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </form>
  )
}

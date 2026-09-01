'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { formatWon } from '@/lib/finance'

import { saveAssets, type AssetActionState } from './actions'
import type { AssetKind } from './calculations'

type AssetRow = {
  id: number
  name: string
  currentAmount: number | null
  previousAmount: number | null
  effectiveAmount: number
}

type AssetGroup = {
  major: string
  kind: AssetKind
  subtotal: number
  rows: AssetRow[]
}

type NewRow = {
  key: number
  major: string
  kind: AssetKind
  name: string
  amount: string
}

const initialState: AssetActionState = {}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : '이달 자산 저장'}
    </button>
  )
}

export function AssetForm({ groups, month }: { groups: AssetGroup[]; month: string }) {
  const [state, action] = useActionState(saveAssets, initialState)
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [nextKey, setNextKey] = useState(1)

  function toggleDeleted(id: number) {
    setDeletedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addRow(major: string, kind: AssetKind) {
    setNewRows((current) => [...current, { key: nextKey, major, kind, name: '', amount: '' }])
    setNextKey((current) => current + 1)
  }

  function updateNewRow(key: number, field: 'amount' | 'name', value: string) {
    setNewRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row))
  }

  return (
    <form action={action} className="mt-6">
      <input name="month" type="hidden" value={month} />
      <input
        name="newAssets"
        type="hidden"
        value={JSON.stringify(newRows.map(({ major, kind, name, amount }) => ({ major, kind, name, amount })))}
      />
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold text-zinc-950">잔고 입력 · {month}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              빈칸은 직전 잔액을 유지합니다. 기존 값을 지우고 저장하면 이번 달 스냅샷만 삭제됩니다.
            </p>
          </div>
          <SaveButton />
        </div>

        <div className="grid gap-px bg-zinc-200 lg:grid-cols-2">
          {groups.map((group) => {
            const groupNewRows = newRows.filter((row) => row.major === group.major)
            return (
              <section className="bg-white p-5" key={`${group.kind}-${group.major}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-zinc-900">{group.major}</h3>
                    {group.kind === 'liability' && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">부채</span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">소계 {formatWon(group.subtotal)}원</span>
                </div>

                <div className="mt-4 space-y-2">
                  {group.rows.map((row) => {
                    const deleted = deletedIds.has(row.id)
                    return (
                      <div
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(115px,0.8fr)_36px] items-center gap-2 rounded-xl p-2 ${deleted ? 'bg-rose-50 opacity-60' : 'bg-zinc-50'}`}
                        key={row.id}
                      >
                        <input name="accountId" type="hidden" value={row.id} />
                        <input name={`deleted:${row.id}`} type="hidden" value={deleted ? 'on' : ''} />
                        <input
                          aria-label={`${row.name} 이름`}
                          className={`min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 ${deleted ? 'line-through' : ''}`}
                          defaultValue={row.name}
                          name={`name:${row.id}`}
                          type="text"
                        />
                        <label className="relative">
                          <span className="sr-only">{row.name} 잔액</span>
                          <input
                            aria-label={`${row.name} 잔액`}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-7 text-right text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                            defaultValue={row.currentAmount ?? ''}
                            inputMode="numeric"
                            name={`amount:${row.id}`}
                            placeholder={row.effectiveAmount ? formatWon(row.effectiveAmount) : '0'}
                            type="text"
                          />
                          <span className="pointer-events-none absolute right-2 top-2.5 text-xs text-zinc-400">원</span>
                        </label>
                        <button
                          aria-label={`${row.name} ${deleted ? '삭제 취소' : '삭제'}`}
                          className={`h-9 rounded-lg text-lg ${deleted ? 'bg-rose-100 text-rose-700' : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700'}`}
                          onClick={() => toggleDeleted(row.id)}
                          type="button"
                        >
                          {deleted ? '↶' : '×'}
                        </button>
                      </div>
                    )
                  })}

                  {groupNewRows.map((row) => (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(115px,0.8fr)_36px] items-center gap-2 rounded-xl bg-emerald-50 p-2" key={row.key}>
                      <input
                        aria-label={`${group.major} 새 항목 이름`}
                        autoFocus
                        className="min-w-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                        onChange={(event) => updateNewRow(row.key, 'name', event.target.value)}
                        placeholder="새 항목 이름"
                        type="text"
                        value={row.name}
                      />
                      <label className="relative">
                        <span className="sr-only">{group.major} 새 항목 잔액</span>
                        <input
                          aria-label={`${group.major} 새 항목 잔액`}
                          className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 pr-7 text-right text-sm text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          inputMode="numeric"
                          onChange={(event) => updateNewRow(row.key, 'amount', event.target.value)}
                          placeholder="0"
                          type="text"
                          value={row.amount}
                        />
                        <span className="pointer-events-none absolute right-2 top-2.5 text-xs text-zinc-400">원</span>
                      </label>
                      <button
                        aria-label={`${group.major} 새 항목 제거`}
                        className="h-9 rounded-lg text-lg text-zinc-400 hover:bg-emerald-100 hover:text-zinc-700"
                        onClick={() => setNewRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="mt-3 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  onClick={() => addRow(group.major, group.kind)}
                  type="button"
                >
                  + 항목 추가
                </button>
              </section>
            )
          })}
        </div>
      </section>
      {state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
    </form>
  )
}

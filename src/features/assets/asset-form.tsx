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
      className="h-[34px] bg-finance-ink px-4 text-[13px] font-semibold text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : '이달 자산 저장'}
    </button>
  )
}

export function AssetForm({ groups, month, balanceOnly = false }: { groups: AssetGroup[]; month: string; balanceOnly?: boolean }) {
  const [state, action] = useActionState(saveAssets, initialState)
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [nextKey, setNextKey] = useState(1)
  const [orderedIds, setOrderedIds] = useState(() => groups.flatMap((group) => group.rows.map((row) => row.id)))
  const [draggingId, setDraggingId] = useState<number | null>(null)

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

  function dropRow(group: AssetGroup, targetId: number) {
    if (draggingId === null || draggingId === targetId || !group.rows.some((row) => row.id === draggingId)) return
    setOrderedIds((current) => {
      const next = [...current]
      const from = next.indexOf(draggingId)
      const to = next.indexOf(targetId)
      if (from < 0 || to < 0) return current
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDraggingId(null)
  }

  return (
    <form action={action} className="mt-6">
      <input name="month" type="hidden" value={month} />
      <input
        name="newAssets"
        type="hidden"
        value={JSON.stringify(newRows.map(({ major, kind, name, amount }) => ({ major, kind, name, amount })))}
      />
      <section className="overflow-hidden border-t border-finance-ink">
        <div className="flex flex-col justify-between gap-4 border-b border-finance-hairline py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-bold text-finance-ink">잔고 보정 · {month}</h2>
            <p className="mt-1 text-xs text-finance-muted">
              빈칸은 직전 잔액을 유지합니다. 기존 값을 지우고 저장하면 이번 달 스냅샷만 삭제됩니다. 계정 이름과 그룹은 설정에서 관리합니다.
            </p>
          </div>
          <SaveButton />
        </div>

        <div className="grid gap-px bg-finance-hairline lg:grid-cols-2">
          {groups.map((group) => {
            const groupNewRows = newRows.filter((row) => row.major === group.major)
            const orderedRows = [...group.rows].sort((left, right) => orderedIds.indexOf(left.id) - orderedIds.indexOf(right.id))
            return (
              <section className="bg-white p-5" key={`${group.kind}-${group.major}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-zinc-900">{group.major}</h3>
                    {group.kind === 'liability' && (
                      <span className="bg-finance-red-tint px-2 py-0.5 text-[11px] font-semibold text-finance-red">부채</span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">소계 {formatWon(group.subtotal)}원</span>
                </div>

                <div className="mt-4 space-y-2">
                  {orderedRows.map((row) => {
                    const deleted = deletedIds.has(row.id)
                    return (
                      <div
                        className={`grid items-center gap-2 border-b border-finance-hairline p-2 ${balanceOnly ? 'grid-cols-[minmax(0,1fr)_minmax(115px,0.8fr)]' : 'grid-cols-[24px_minmax(0,1fr)_minmax(115px,0.8fr)_36px]'} ${deleted ? 'bg-finance-red-tint opacity-60' : 'bg-white'} ${draggingId === row.id ? 'opacity-40' : ''}`}
                        key={row.id}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => dropRow(group, row.id)}
                      >
                        <input name="accountId" type="hidden" value={row.id} />
                        <input name={`deleted:${row.id}`} type="hidden" value={deleted ? 'on' : ''} />
                        {balanceOnly ? (
                          <><input name={`name:${row.id}`} type="hidden" value={row.name} /><span className="text-[13px] font-medium text-finance-ink">{row.name}</span></>
                        ) : (
                          <>
                            <span className="cursor-grab text-center text-zinc-300" draggable onDragEnd={() => setDraggingId(null)} onDragStart={() => setDraggingId(row.id)} title="끌어서 순서 변경">⠿</span>
                            <input aria-label={`${row.name} 이름`} className={`h-[34px] min-w-0 border border-finance-hairline bg-white px-3 text-[13px] text-finance-ink outline-none focus:border-finance-blue ${deleted ? 'line-through' : ''}`} defaultValue={row.name} name={`name:${row.id}`} type="text" />
                          </>
                        )}
                        <label className="relative">
                          <span className="sr-only">{row.name} 잔액</span>
                          <input
                            aria-label={`${row.name} 잔액`}
                            className="h-[34px] w-full border border-finance-hairline bg-white px-3 pr-7 text-right text-[13px] tabular-nums text-finance-ink outline-none focus:border-finance-blue"
                            defaultValue={row.currentAmount ?? ''}
                            inputMode="numeric"
                            name={`amount:${row.id}`}
                            placeholder={row.effectiveAmount ? formatWon(row.effectiveAmount) : '0'}
                            type="text"
                          />
                          <span className="pointer-events-none absolute right-2 top-2.5 text-xs text-zinc-400">원</span>
                        </label>
                        {!balanceOnly && <button
                          aria-label={`${row.name} ${deleted ? '삭제 취소' : '삭제'}`}
                          className={`h-[34px] text-lg ${deleted ? 'bg-finance-red-tint text-finance-red' : 'text-finance-faint hover:bg-finance-track hover:text-finance-ink'}`}
                          onClick={() => toggleDeleted(row.id)}
                          type="button"
                        >
                          {deleted ? '↶' : '×'}
                        </button>}
                      </div>
                    )
                  })}

                  {!balanceOnly && groupNewRows.map((row) => (
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_minmax(115px,0.8fr)_36px] items-center gap-2 border-b border-finance-green bg-finance-green-tint p-2" key={row.key}>
                      <span className="text-center text-zinc-300">＋</span>
                      <input
                        aria-label={`${group.major} 새 항목 이름`}
                        autoFocus
                        className="h-[34px] min-w-0 border border-finance-hairline bg-white px-3 text-[13px] text-finance-ink outline-none focus:border-finance-blue"
                        onChange={(event) => updateNewRow(row.key, 'name', event.target.value)}
                        placeholder="새 항목 이름"
                        type="text"
                        value={row.name}
                      />
                      <label className="relative">
                        <span className="sr-only">{group.major} 새 항목 잔액</span>
                        <input
                          aria-label={`${group.major} 새 항목 잔액`}
                          className="h-[34px] w-full border border-finance-hairline bg-white px-3 pr-7 text-right text-[13px] tabular-nums text-finance-ink outline-none focus:border-finance-blue"
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
                        className="h-[34px] text-lg text-finance-faint hover:bg-finance-green-tint hover:text-finance-ink"
                        onClick={() => setNewRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {!balanceOnly && <button
                  className="mt-3 h-[30px] px-2 text-xs font-semibold text-finance-blue hover:bg-finance-blue-tint"
                  onClick={() => addRow(group.major, group.kind)}
                  type="button"
                >
                  + 항목 추가
                </button>}
              </section>
            )
          })}
        </div>
      </section>
      {state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
    </form>
  )
}

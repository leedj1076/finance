'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { saveAssetAccounts, type AssetActionState } from './actions'
import type { AssetKind } from './calculations'

type AssetRow = { id: number; name: string }
type AssetGroup = { major: string; kind: AssetKind; rows: AssetRow[] }
type NewRow = { key: number; major: string; kind: AssetKind; name: string }

function SaveButton() {
  const { pending } = useFormStatus()
  return <button className="h-[34px] bg-finance-ink px-4 text-xs font-semibold text-white hover:bg-finance-blue disabled:opacity-50" disabled={pending} type="submit">{pending ? '저장 중…' : '계정 변경 저장'}</button>
}

export function AssetAccountsManager({ groups }: { groups: AssetGroup[] }) {
  const [state, action] = useActionState<AssetActionState, FormData>(saveAssetAccounts, {})
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(groups.flatMap((group) => group.rows.map((row) => [row.id, row.name]))))
  const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [nextKey, setNextKey] = useState(1)
  const payload = useMemo(() => JSON.stringify(newRows.map((row) => ({ ...row, amount: '' }))), [newRows])

  return (
    <form action={action} className="mt-6">
      <input name="newAssets" type="hidden" value={payload} />
      <div className="flex flex-col justify-between gap-3 border-y border-finance-ink py-4 sm:flex-row sm:items-center">
        <div><h2 className="text-sm font-bold text-finance-ink">자산 계정</h2><p className="mt-1 text-xs text-finance-muted">이름·그룹·사용 여부를 관리합니다. 월별 잔액은 자산 화면의 잔고 보정에서 입력합니다.</p></div>
        <SaveButton />
      </div>
      <div className="grid gap-px bg-finance-hairline lg:grid-cols-2">
        {groups.map((group) => (
          <section className="bg-white p-5" key={`${group.kind}:${group.major}`}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-finance-ink">{group.major}</h3><button className="text-xs font-semibold text-finance-blue" onClick={() => { setNewRows((current) => [...current, { key: nextKey, major: group.major, kind: group.kind, name: '' }]); setNextKey((value) => value + 1) }} type="button">+ 계정 추가</button></div>
            <div className="mt-3 divide-y divide-finance-hairline">
              {group.rows.map((row) => {
                const deleted = deletedIds.has(row.id)
                return (
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 ${deleted ? 'opacity-50' : ''}`} key={row.id}>
                    <input name="accountId" type="hidden" value={row.id} />
                    <input name={`deleted:${row.id}`} type="hidden" value={deleted ? 'on' : ''} />
                    <input aria-label={`${row.name} 이름`} className={`h-[34px] border border-finance-hairline bg-white px-3 text-[13px] outline-none focus:border-finance-blue ${deleted ? 'line-through' : ''}`} name={`name:${row.id}`} onChange={(event) => setNames((current) => ({ ...current, [row.id]: event.target.value }))} value={names[row.id] ?? ''} />
                    <button className={`w-16 text-xs font-semibold ${deleted ? 'text-finance-blue' : 'text-finance-red'}`} onClick={() => setDeletedIds((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })} type="button">{deleted ? '취소' : '보관'}</button>
                  </div>
                )
              })}
              {newRows.filter((row) => row.major === group.major && row.kind === group.kind).map((row) => (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2" key={row.key}>
                  <input aria-label={`${group.major} 새 계정 이름`} autoFocus className="h-[34px] border border-finance-green bg-white px-3 text-[13px] outline-none" onChange={(event) => setNewRows((current) => current.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item))} placeholder="새 계정 이름" value={row.name} />
                  <button className="w-16 text-xs font-semibold text-finance-red" onClick={() => setNewRows((current) => current.filter((item) => item.key !== row.key))} type="button">제거</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {state.error && <p className="mt-3 text-sm text-finance-red">{state.error}</p>}
    </form>
  )
}

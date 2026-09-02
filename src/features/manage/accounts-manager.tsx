'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { bulkSaveAccounts } from './actions'

type AccountRow = {
  id: number
  name: string
  owner: string | null
  type: string | null
  memo: string | null
  active: boolean
  transactionCount: number
}

type EditableAccount = Omit<AccountRow, 'id'> & { id: number | null; key: string }
const inputClass = 'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

function SaveButton() {
  const { pending } = useFormStatus()
  return <button className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50" disabled={pending} type="submit">{pending ? '저장 중…' : '변경사항 저장'}</button>
}

function move<T>(rows: T[], from: number, to: number) {
  const next = [...rows]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function AccountsManager({ initialRows }: { initialRows: AccountRow[] }) {
  const [rows, setRows] = useState<EditableAccount[]>(() => initialRows.map((row) => ({ ...row, key: `account-${row.id}` })))
  const [nextKey, setNextKey] = useState(1)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const payload = useMemo(() => JSON.stringify(rows.map((row) => ({
    id: row.id,
    name: row.name,
    owner: row.owner ?? '',
    type: row.type ?? 'other',
    memo: row.memo ?? '',
    active: row.active,
  }))), [rows])

  function update(key: string, patch: Partial<EditableAccount>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  }

  function addRow() {
    const key = `new-account-${nextKey}`
    setNextKey((value) => value + 1)
    setRows((current) => [...current, { id: null, key, name: '', owner: 'DJ', type: 'card', memo: '', active: true, transactionCount: 0 }])
  }

  function dropOn(targetKey: string) {
    if (!draggingKey || draggingKey === targetKey) return
    setRows((current) => move(current, current.findIndex((row) => row.key === draggingKey), current.findIndex((row) => row.key === targetKey)))
    setDraggingKey(null)
  }

  return (
    <form action={bulkSaveAccounts} className="mt-6">
      <input name="accounts" type="hidden" value={payload} />
      <datalist id="account-owners"><option value="DJ" /><option value="YJ" /><option value="공용" /></datalist>
      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold text-zinc-900">결제수단</h2><p className="mt-1 text-xs text-zinc-500">끌어서 순서를 바꾸고 한 번에 저장합니다. 과거 거래 연결은 그대로 유지됩니다.</p></div>
          <div className="flex gap-2"><button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50" onClick={addRow} type="button">+ 결제수단 추가</button><SaveButton /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="w-10 px-2 py-2.5"><span className="sr-only">순서</span></th><th className="px-2 py-2.5 font-medium">이름</th><th className="px-2 py-2.5 font-medium">소유자</th><th className="px-2 py-2.5 font-medium">종류</th><th className="px-2 py-2.5 font-medium">메모</th><th className="px-2 py-2.5 text-center font-medium">사용</th><th className="px-3 py-2.5 text-right font-medium">거래</th><th className="w-12 px-2 py-2.5"><span className="sr-only">관리</span></th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, index) => (
                <tr className={`${draggingKey === row.key ? 'opacity-40' : ''} ${row.active ? '' : 'bg-zinc-50 text-zinc-400'}`} key={row.key} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(row.key)}>
                  <td className="px-3 py-2 text-center text-zinc-400"><span className="cursor-grab" draggable onDragEnd={() => setDraggingKey(null)} onDragStart={() => setDraggingKey(row.key)} title="끌어서 순서 변경">⠿</span></td>
                  <td className="px-2 py-2"><input aria-label={`${index + 1}번째 결제수단 이름`} autoFocus={row.id === null && index === rows.length - 1} className={inputClass} onChange={(event) => update(row.key, { name: event.target.value })} required value={row.name} /></td>
                  <td className="px-2 py-2"><input aria-label={`${row.name || index + 1} 소유자`} className={inputClass} list="account-owners" onChange={(event) => update(row.key, { owner: event.target.value })} required value={row.owner ?? ''} /></td>
                  <td className="px-2 py-2"><select aria-label={`${row.name || index + 1} 종류`} className={inputClass} onChange={(event) => update(row.key, { type: event.target.value })} value={row.type ?? 'other'}><option value="card">카드</option><option value="cash">현금/계좌</option><option value="bank">은행</option><option value="other">기타</option></select></td>
                  <td className="px-2 py-2"><input aria-label={`${row.name || index + 1} 메모`} className={inputClass} onChange={(event) => update(row.key, { memo: event.target.value })} value={row.memo ?? ''} /></td>
                  <td className="px-2 py-2 text-center"><input aria-label={`${row.name || index + 1} 사용`} checked={row.active} onChange={(event) => update(row.key, { active: event.target.checked })} type="checkbox" /></td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{row.transactionCount.toLocaleString('ko-KR')}건</td>
                  <td className="px-2 py-2 text-center">{row.id === null && <button aria-label="새 결제수단 제거" className="rounded px-2 py-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-700" onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))} type="button">×</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="mt-3 text-xs leading-5 text-zinc-500">사용하지 않는 항목은 ‘사용’을 꺼 주세요. 거래가 연결된 결제수단은 삭제하지 않아 기록이 깨지지 않습니다.</p>
    </form>
  )
}

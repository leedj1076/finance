'use client'

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import { bulkSaveCategories } from './actions'
import type { ManageFlow } from './manage-input'

type CategoryRow = { id: number; kind: ManageFlow; major: string; sub: string; hidden: boolean; transactionCount: number; recurringCount: number }
type EditableSub = { key: string; id: number | null; sub: string; hidden: boolean; deleted: boolean; usage: number }
type EditableGroup = { key: string; kind: ManageFlow; major: string; rows: EditableSub[] }
const labels = { expense: '지출', income: '수입', saving: '저축' } as const
const tones = { expense: 'border-l-rose-400', income: 'border-l-blue-400', saving: 'border-l-emerald-500' } as const
const inputClass = 'w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

function SaveButton() {
  const { pending } = useFormStatus()
  return <button className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50" disabled={pending} type="submit">{pending ? '저장 중…' : '변경사항 저장'}</button>
}

function initialGroups(rows: CategoryRow[]) {
  const groups: EditableGroup[] = []
  for (const row of rows) {
    let group = groups.find((candidate) => candidate.kind === row.kind && candidate.major === row.major)
    if (!group) {
      group = { key: `group-${row.kind}-${row.id}`, kind: row.kind, major: row.major, rows: [] }
      groups.push(group)
    }
    group.rows.push({ key: `category-${row.id}`, id: row.id, sub: row.sub, hidden: row.hidden, deleted: false, usage: row.transactionCount + row.recurringCount })
  }
  return groups
}

function move<T>(rows: T[], from: number, to: number) {
  const next = [...rows]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function CategoriesManager({ initialRows }: { initialRows: CategoryRow[] }) {
  const [groups, setGroups] = useState<EditableGroup[]>(() => initialGroups(initialRows))
  const [nextKey, setNextKey] = useState(1)
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null)
  const [draggingSub, setDraggingSub] = useState<{ group: string; row: string } | null>(null)
  const payload = useMemo(() => JSON.stringify(groups.flatMap((group) => group.rows.map((row) => ({ id: row.id, kind: group.kind, major: group.major, sub: row.sub, hidden: row.hidden, deleted: row.deleted })))), [groups])

  function updateGroup(key: string, updater: (group: EditableGroup) => EditableGroup) {
    setGroups((current) => current.map((group) => group.key === key ? updater(group) : group))
  }

  function addGroup(kind: ManageFlow) {
    const suffix = nextKey
    setNextKey((value) => value + 1)
    setGroups((current) => [...current, { key: `new-group-${suffix}`, kind, major: '', rows: [{ key: `new-category-${suffix}`, id: null, sub: '', hidden: false, deleted: false, usage: 0 }] }])
  }

  function addSub(groupKey: string) {
    const suffix = nextKey
    setNextKey((value) => value + 1)
    updateGroup(groupKey, (group) => ({ ...group, rows: [...group.rows, { key: `new-category-${suffix}`, id: null, sub: '', hidden: false, deleted: false, usage: 0 }] }))
  }

  function dropGroup(target: EditableGroup) {
    if (!draggingGroup || draggingGroup === target.key) return
    setGroups((current) => {
      const source = current.find((group) => group.key === draggingGroup)
      if (!source || source.kind !== target.kind) return current
      return move(current, current.indexOf(source), current.indexOf(target))
    })
    setDraggingGroup(null)
  }

  function dropSub(groupKey: string, targetKey: string) {
    if (!draggingSub || draggingSub.group !== groupKey || draggingSub.row === targetKey) return
    updateGroup(groupKey, (group) => {
      const from = group.rows.findIndex((row) => row.key === draggingSub.row)
      const to = group.rows.findIndex((row) => row.key === targetKey)
      return from < 0 || to < 0 ? group : { ...group, rows: move(group.rows, from, to) }
    })
    setDraggingSub(null)
  }

  function toggleGroupDeleted(group: EditableGroup) {
    if (group.rows.every((row) => row.id === null)) {
      setGroups((current) => current.filter((candidate) => candidate.key !== group.key))
      return
    }
    const shouldDelete = !group.rows.every((row) => row.deleted)
    updateGroup(group.key, (current) => ({
      ...current,
      rows: current.rows.flatMap((row) => row.id === null && shouldDelete ? [] : [{ ...row, deleted: shouldDelete }]),
    }))
  }

  function removeSub(groupKey: string, row: EditableSub) {
    updateGroup(groupKey, (group) => {
      if (row.id === null) {
        const remaining = group.rows.filter((candidate) => candidate.key !== row.key)
        return { ...group, rows: remaining }
      }
      return { ...group, rows: group.rows.map((candidate) => candidate.key === row.key ? { ...candidate, deleted: !candidate.deleted } : candidate) }
    })
  }

  return (
    <form action={bulkSaveCategories} className="mt-6">
      <input name="categories" type="hidden" value={payload} />
      <div className="sticky top-[54px] z-20 flex flex-col gap-3 border border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-zinc-900">카테고리 구조</h2><p className="mt-1 text-xs text-zinc-500">대분류와 소분류를 같은 화면에서 편집하고 끌어서 순서를 바꿉니다.</p></div>
        <SaveButton />
      </div>
      {(['expense', 'income', 'saving'] as const).map((kind) => {
        const kindGroups = groups.filter((group) => group.kind === kind)
        return (
          <section className="mt-6" key={kind}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-lg font-semibold text-zinc-900">{labels[kind]} <span className="text-sm font-normal text-zinc-400">{kindGroups.reduce((sum, group) => sum + group.rows.length, 0)}개</span></h3><button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50" onClick={() => addGroup(kind)} type="button">+ 대분류 추가</button></div>
            <div className="space-y-3">
              {kindGroups.map((group) => (
                <article className={`overflow-hidden rounded-lg border border-zinc-200 border-l-4 bg-white ${tones[kind]} ${draggingGroup === group.key ? 'opacity-40' : ''}`} key={group.key} onDragOver={(event) => event.preventDefault()} onDrop={() => dropGroup(group)}>
                  <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2.5">
                    <span className="cursor-grab text-zinc-400" draggable onDragEnd={() => setDraggingGroup(null)} onDragStart={() => setDraggingGroup(group.key)} title="끌어서 대분류 순서 변경">⠿</span>
                    <input aria-label={`${labels[kind]} 대분류 이름`} autoFocus={group.key.startsWith('new-group')} className={`${inputClass} max-w-xs font-semibold`} onChange={(event) => updateGroup(group.key, (current) => ({ ...current, major: event.target.value }))} placeholder="대분류 이름" required value={group.major} />
                    <span className="text-xs text-zinc-400">소분류 {group.rows.length}개</span>
                    <button className="ml-auto rounded px-2 py-1 text-xs text-zinc-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => toggleGroupDeleted(group)} type="button">대분류 {group.rows.every((row) => row.deleted) ? '삭제 취소' : '삭제'}</button>
                  </div>
                  <div className="divide-y divide-zinc-100">
                    {group.rows.map((row, index) => (
                      <div className={`grid grid-cols-[28px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2 ${row.deleted ? 'bg-rose-50 opacity-60' : ''}`} key={row.key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropSub(group.key, row.key) }}>
                        <span className="cursor-grab text-center text-zinc-300" draggable onDragEnd={() => setDraggingSub(null)} onDragStart={(event) => { event.stopPropagation(); setDraggingSub({ group: group.key, row: row.key }) }}>⠿</span>
                        <input aria-label={`${group.major || labels[kind]} ${index + 1}번째 소분류`} className={`${inputClass} ${row.deleted ? 'line-through' : ''}`} onChange={(event) => updateGroup(group.key, (current) => ({ ...current, rows: current.rows.map((candidate) => candidate.key === row.key ? { ...candidate, sub: event.target.value } : candidate) }))} placeholder="소분류 이름" required value={row.sub} />
                        <span className="min-w-16 text-right text-xs text-zinc-400">사용 {row.usage.toLocaleString('ko-KR')}건</span>
                        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600"><input checked={row.hidden} onChange={(event) => updateGroup(group.key, (current) => ({ ...current, rows: current.rows.map((candidate) => candidate.key === row.key ? { ...candidate, hidden: event.target.checked } : candidate) }))} type="checkbox" /> 숨김</label>
                        <button aria-label={`${row.sub || '새 소분류'} ${row.deleted ? '삭제 취소' : '삭제'}`} className={`rounded px-2 py-1 text-sm ${row.deleted ? 'text-rose-700' : 'text-zinc-400 hover:bg-rose-50 hover:text-rose-700'}`} onClick={() => removeSub(group.key, row)} type="button">{row.deleted ? '↶' : '×'}</button>
                      </div>
                    ))}
                  </div>
                  <button className="m-2 rounded-md px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50" onClick={() => addSub(group.key)} type="button">+ 소분류 추가</button>
                </article>
              ))}
            </div>
          </section>
        )
      })}
      <p className="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">사용 이력이 없는 항목은 삭제되고, 거래나 정기거래가 연결된 항목은 기록 보존을 위해 숨김 처리됩니다.</p>
    </form>
  )
}

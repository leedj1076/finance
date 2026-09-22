'use client'

import { useRef, useState, useTransition } from 'react'
import { formatWon } from '@/lib/finance'
import { applySelectedRecurringMonth, loadPendingRecurringMonth } from './actions'
import type { PendingRecurringPosting } from './posting'

export function RecurringPostingDialog({ month, formId }: { month: string; formId: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [rows, setRows] = useState<PendingRecurringPosting[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [phase, setPhase] = useState<'loading' | 'posting' | null>(null)
  const [transitionPending, startTransition] = useTransition()
  const busy = phase !== null || transitionPending
  const selectedRows = rows?.filter(row => selected.has(row.id)) ?? []

  function open() {
    if (inFlight.current) return
    inFlight.current = true
    setError(''); setNotice(''); setRows(null); setSelected(new Set()); setPhase('loading')
    setIsOpen(true)
    dialog.current?.showModal()
    startTransition(async () => {
      try {
        const result = await loadPendingRecurringMonth(month)
        if (result.error) setError(result.error)
        else setRows(result.rows ?? [])
      } catch {
        setError('미반영 정기거래를 불러오지 못했습니다. 다시 시도해 주세요.')
      } finally {
        inFlight.current = false; setPhase(null)
      }
    })
  }

  function postSelection() {
    if (inFlight.current || busy || selectedRows.length === 0) return
    inFlight.current = true
    setError(''); setNotice(''); setPhase('posting')
    startTransition(async () => {
      try {
        const result = await applySelectedRecurringMonth(month, selectedRows.map(row => row.id))
        if (!result.ok) {
          setError(result.error ?? '반영하지 못했습니다. 다시 시도해 주세요.')
          return
        }
        const pendingIds = new Set(result.pendingIds)
        setRows(current => current?.filter(row => pendingIds.has(row.id)) ?? [])
        setSelected(new Set())
        setNotice(`${result.added}건 반영${result.skipped ? ` · 이미 반영된 ${result.skipped}건 건너뜀` : ''} · 미반영 ${result.remaining}건${result.notice ?? ''}`)
        // Revalidation updates the ledger in place; keep this stable dialog mounted.
      } catch {
        setError('반영 결과를 확인하지 못했습니다. 다시 시도해 주세요. 이미 반영된 항목은 중복 저장되지 않습니다.')
      } finally {
        inFlight.current = false; setPhase(null)
      }
    })
  }

  return <>
    {/* Both server-rendered entry points submit to this one stable dialog host. */}
    <form id={formId} onSubmit={event => { event.preventDefault(); open() }} />
    {!isOpen && notice && <p role="status" className="mt-3 t-caption text-finance-green">{notice}</p>}
    <dialog ref={dialog} id={`${formId}-dialog`} aria-labelledby={`${formId}-title`}
      className="m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-3xl overflow-y-auto border border-finance-ink bg-white p-5 text-finance-ink shadow-xl backdrop:bg-black/40 sm:p-7"
      onCancel={event => { if (busy || inFlight.current) event.preventDefault() }} onClose={() => setIsOpen(false)}>
      <div className="flex items-start justify-between gap-4">
        <div><p className="t-label text-finance-blue">반영할 항목 확인</p><h2 className="mt-2 t-section" id={`${formId}-title`}>{month} 정기거래 선택 반영</h2></div>
        <button aria-label="정기거래 창 닫기" disabled={busy} type="button" className="min-h-9 min-w-9 text-finance-muted disabled:opacity-40" onClick={() => dialog.current?.close()}>✕</button>
      </div>
      <p className="mt-3 t-caption leading-relaxed text-finance-muted">현재 내역 필터와 무관한 이 달의 미반영 정기거래입니다. 선택하지 않은 항목은 미반영으로 남습니다.</p>
      {phase === 'loading' && <p role="status" className="py-8 t-body text-finance-muted">미반영 정기거래를 불러오는 중…</p>}
      {rows && <>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-finance-ink pb-3">
          <p className="t-body-strong">미반영 {rows.length}건 · 선택 {selectedRows.length}건</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !rows.length} className="min-h-9 border border-finance-border px-3 t-caption disabled:opacity-40" onClick={() => setSelected(new Set(rows.map(row => row.id)))}>전체 선택</button>
            <button type="button" disabled={busy || !selected.size} className="min-h-9 border border-finance-border px-3 t-caption disabled:opacity-40" onClick={() => setSelected(new Set())}>전체 해제</button>
          </div>
        </div>
        <fieldset disabled={busy}>
          <legend className="sr-only">반영할 정기거래</legend>
          <ul className="divide-y divide-finance-hairline">{rows.map(row => <li key={row.id}>
            <label className={`flex cursor-pointer items-start gap-3 px-2 py-4 ${selected.has(row.id) ? 'bg-finance-blue-tint' : 'hover:bg-finance-panel'}`}>
              <input type="checkbox" aria-label={row.memo} className="mt-1 h-4 w-4 shrink-0" checked={selected.has(row.id)} onChange={event => {
                const next = new Set(selected)
                if (event.target.checked) next.add(row.id); else next.delete(row.id)
                setSelected(next)
              }} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap justify-between gap-x-4 gap-y-1"><strong className="break-words t-body-strong">{row.memo || '제목 없음'}</strong><strong className="shrink-0 t-body-strong tabular-nums">{formatWon(row.amount)}원</strong></span>
                <span className="mt-1 block break-words t-caption text-finance-muted">{row.date} · {row.flow === 'income' ? '수입' : row.flow === 'saving' ? '저축' : '지출'}</span>
                <span className="mt-1 block break-words t-caption text-finance-muted">{row.category} · {row.account}</span>
              </span>
            </label>
          </li>)}</ul>
        </fieldset>
        {rows.length === 0 && <p className="py-8 t-body text-finance-muted">미반영 정기거래가 없습니다.</p>}
      </>}
      {notice && <p role="status" className="mt-4 t-caption text-finance-green">{notice}</p>}
      {error && <p role="alert" className="mt-4 t-caption text-finance-red">{error}</p>}
      <div className="sticky bottom-0 mt-5 flex flex-wrap justify-end gap-2 border-t border-finance-hairline bg-white pt-4">
        <button type="button" disabled={busy} className="min-h-10 border border-finance-border px-4 t-caption disabled:opacity-40" onClick={() => dialog.current?.close()}>닫기</button>
        {rows === null && !busy ? <button type="button" className="min-h-10 border border-finance-ink px-4 t-caption" onClick={open}>다시 불러오기</button>
          : <button type="button" disabled={busy || selectedRows.length === 0} className="min-h-10 bg-finance-blue px-4 t-caption-strong text-white disabled:opacity-40" onClick={postSelection}>{phase === 'posting' ? '반영 중…' : `선택한 ${selectedRows.length}건 반영`}</button>}
      </div>
    </dialog>
  </>
}

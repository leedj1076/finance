'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'

import { loadInboxHistoryItems, restoreInboxItems } from './history-actions'
import type { InboxHistoryEntry, InboxHistoryFilter, InboxHistoryPage } from './history-types'

const statuses = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '검토 대기' },
  { value: 'done', label: '반영 완료' },
  { value: 'dismissed', label: '선택 제외' },
] as const
const statusClass = { pending: 'text-finance-amber', done: 'text-finance-green', dismissed: 'text-finance-muted' }
const flowLabel = { expense: '지출', income: '수입', saving: '저축' }

function HistoryDetails({ entry }: { entry: InboxHistoryEntry }) {
  const [filter, setFilter] = useState<InboxHistoryFilter>('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InboxHistoryPage | null>(null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [restoring, startRestoring] = useTransition()
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    loadInboxHistoryItems({ source: entry.source, processedOn: entry.processedOn, status: filter, page })
      .then((result) => {
        if (!active) return
        if (result.error !== undefined) setLoadError(result.error)
        else {
          setData(result.data)
          const restorable = new Set(result.data.items.filter((item) => item.canRestore).map((item) => item.id))
          setSelected((current) => new Set([...current].filter((id) => restorable.has(id))))
        }
      })
      .catch(() => { if (active) setLoadError('항목을 불러오지 못했습니다. 다시 시도해 주세요.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [entry.source, entry.processedOn, entry.pending, entry.done, entry.dismissed, filter, page, refresh])

  const restore = (ids: number[]) => {
    if (inFlight.current || ids.length === 0) return
    inFlight.current = true
    setMessage(null)
    startRestoring(async () => {
      try {
        const result = await restoreInboxItems(ids)
        if (result.error !== undefined) setMessage({ text: result.error, error: true })
        else {
          setMessage({ text: result.message })
          setSelected(new Set())
        }
      } catch {
        setMessage({ text: '복원 결과를 확인하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.', error: true })
      } finally {
        inFlight.current = false
        setRefresh((current) => current + 1)
      }
    })
  }

  const disabled = loading || restoring
  const restorable = data?.items.filter((item) => item.canRestore) ?? []
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)))

  return (
    <section aria-label="가져온 항목" aria-busy={disabled} className="border-t border-finance-border bg-finance-panel px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-label="처리 상태 필터" className="flex flex-wrap gap-1" role="group">
          {statuses.map((status) => (
            <button aria-pressed={filter === status.value} className={`px-3 py-2 t-caption ${filter === status.value ? 'bg-finance-ink text-white' : 'text-finance-muted hover:bg-finance-track'}`} disabled={restoring} key={status.value}
              onClick={() => {
                if (filter === status.value) return
                setFilter(status.value)
                setPage(1)
                setData(null)
                setSelected(new Set())
              }} type="button">
              {status.label}
            </button>
          ))}
        </div>
        <button className="border border-finance-border px-3 py-2 t-caption font-semibold text-finance-blue disabled:opacity-40" disabled={disabled || selected.size === 0} onClick={() => restore([...selected])} type="button">
          선택 항목 검토 대기로 보내기
        </button>
      </div>
      {message && <p className={`mt-3 t-caption ${message.error ? 'text-finance-red' : 'text-finance-green'}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      {loadError ? <div className="mt-4 t-caption text-finance-red" role="alert">{loadError} <button className="underline" onClick={() => setRefresh((value) => value + 1)} type="button">다시 시도</button></div> : (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 t-caption text-finance-muted">
            <label className="flex items-center gap-2">
              <input aria-label="이 페이지 복원 가능 항목 전체 선택" checked={restorable.length > 0 && restorable.every((item) => selected.has(item.id))} className="h-4 w-4 accent-finance-ink" disabled={disabled || restorable.length === 0}
                onChange={(event) => setSelected(event.target.checked ? new Set(restorable.map((item) => item.id)) : new Set())} type="checkbox" />
              이 페이지 선택 · {selected.size}건
            </label>
            <span>{loading ? '목록 불러오는 중…' : `전체 ${data?.total.toLocaleString('ko-KR') ?? 0}건`}</span>
          </div>
          <ul className="mt-3 divide-y divide-finance-border border-y border-finance-border">
            {data?.items.map((item) => (
              <li className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 py-3 sm:grid-cols-[20px_95px_minmax(0,1fr)_110px_110px_160px] sm:items-center sm:gap-3" key={item.id}>
                <input aria-label={`${item.merchant || '거래'} 복원 선택`} checked={selected.has(item.id)} className="mt-1 h-4 w-4 accent-finance-ink sm:mt-0" disabled={disabled || !item.canRestore}
                  onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} type="checkbox" />
                <time className="t-caption text-finance-muted">{item.date}</time>
                <div className="col-start-2 min-w-0 sm:col-start-auto">
                  <p className="break-words t-body-strong text-finance-ink">{item.merchant || '사용내역 없음'}</p>
                  <p className="mt-1 break-words t-caption text-finance-muted">{item.owner} · {item.accountName || '결제수단 미지정'} · {item.categoryMajor ? `${item.categoryMajor} · ${item.categorySub ?? ''}` : '미분류'}</p>
                  {item.dupNote && <p className="mt-1 break-words t-caption text-finance-amber">중복 의심: {item.dupNote}</p>}
                </div>
                <p className="col-start-2 t-body-strong tabular-nums text-finance-ink sm:col-start-auto sm:text-right"><span className="mr-1 t-caption font-normal text-finance-muted">{flowLabel[item.flow]}</span>{item.amount.toLocaleString('ko-KR')}원</p>
                <span className={`col-start-2 t-caption font-semibold sm:col-start-auto sm:text-center ${statusClass[item.status]}`}>{statuses.find((status) => status.value === item.status)?.label}</span>
                <div className="col-start-2 sm:col-start-auto sm:text-right">
                  {item.canRestore ? <button aria-label={`${item.merchant || '거래'} 검토 대기로 보내기`} className="border border-finance-border px-2 py-1.5 t-caption text-finance-blue disabled:opacity-40" disabled={disabled} onClick={() => restore([item.id])} type="button">검토 대기로 보내기</button>
                    : item.status === 'dismissed' && <span className="t-caption text-finance-muted">이미 원장에 반영됨</span>}
                </div>
              </li>
            ))}
          </ul>
          {!loading && data?.items.length === 0 && <p className="py-6 text-center t-caption text-finance-muted">이 상태의 항목이 없습니다.</p>}
          {pages > 1 && <nav aria-label="처리 기록 항목 페이지" className="mt-3 flex items-center justify-center gap-4 t-caption text-finance-muted">
            <button disabled={disabled || (data?.page ?? 1) <= 1} onClick={() => { setPage((data?.page ?? 1) - 1); setSelected(new Set()) }} type="button" className="px-2 py-1 disabled:opacity-40">이전</button>
            <span>{data?.page ?? 1} / {pages}</span>
            <button disabled={disabled || (data?.page ?? 1) >= pages} onClick={() => { setPage((data?.page ?? 1) + 1); setSelected(new Set()) }} type="button" className="px-2 py-1 disabled:opacity-40">다음</button>
          </nav>}
        </>
      )}
    </section>
  )
}

function HistoryRecord({ entry }: { entry: InboxHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  return <article>
    <div className="grid gap-3 py-4 t-body sm:grid-cols-[120px_minmax(160px,1fr)_auto_auto_auto_auto] sm:items-center">
      <time className="text-finance-muted">{entry.processedOn}</time>
      <div><strong className="text-finance-ink">{entry.label}</strong><p className="mt-1 t-caption text-finance-faint">거래 기간 {entry.earliestMonth}~{entry.latestMonth}</p></div>
      <span>대기 <strong className="text-finance-amber">{entry.pending}건</strong></span>
      <span>반영 <strong className="text-finance-green">{entry.done}건</strong></span>
      <span>제외 <strong className="text-finance-muted">{entry.dismissed}건</strong></span>
      <button aria-controls={detailsId} aria-expanded={open} className="justify-self-start t-caption font-semibold text-finance-blue" onClick={() => setOpen((current) => !current)} type="button">{open ? '거래 접기' : '거래 보기'}</button>
    </div>
    <div id={detailsId}>{open && <HistoryDetails entry={entry} />}</div>
  </article>
}

export function InboxHistoryList({ history }: { history: InboxHistoryEntry[] }) {
  return <div className="divide-y divide-finance-track">{history.map((entry) => <HistoryRecord entry={entry} key={`${entry.source}:${entry.processedOn}`} />)}</div>
}

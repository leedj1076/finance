'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { formatWon } from '@/lib/finance'
import { closeLedgerMonth, loadMonthCloseSummary, reopenLedgerMonth } from './actions'
import { MonthStatusLabel } from './month-status-label'
import { type MonthCloseSummary, type MonthStatus } from './state'

export function MonthCloseControl({ month, status, pendingCount = 0 }: { month: string; status: MonthStatus; pendingCount?: number }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [summary, setSummary] = useState<MonthCloseSummary | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)
  const [acknowledgeEmpty, setAcknowledgeEmpty] = useState(false)
  const [pending, startTransition] = useTransition()

  async function refreshSummary() {
    const result = await loadMonthCloseSummary(month)
    setAcknowledgeWarnings(false); setAcknowledgeEmpty(false)
    setSummary(result.summary ?? null)
    if (result.error) setError(result.error)
  }

  function open() {
    setError(''); setNotice(''); setSummary(null)
    dialog.current?.showModal()
    startTransition(async () => {
      try { await refreshSummary() } catch { setError('요약을 불러오지 못했습니다. 다시 시도해 주세요.') }
    })
  }

  function submit(reopen = false) {
    if (!summary) return
    setError('')
    startTransition(async () => {
      try {
        const result = reopen ? await reopenLedgerMonth(month) : await closeLedgerMonth({ month, revision: summary.revision, acknowledgeWarnings, acknowledgeEmpty })
        if (!result.ok) {
          await refreshSummary()
          setError(result.error ?? '최신 요약을 다시 확인해 주세요.')
          return
        }
        setNotice(reopen ? `${month} 마감을 해제했습니다. 통계에서 제외됩니다.` : `${month} 전체를 마감했습니다. 통계에 반영됩니다.`)
        dialog.current?.close()
        // The action revalidates the current RSC tree without navigating or
        // remounting the ledger, so inline drafts and scroll remain intact.
      } catch { setError('처리 결과를 확인하지 못했습니다. 창을 다시 열어 상태를 확인해 주세요.') }
    })
  }

  return (
    <section className="mt-4 border-b border-finance-hairline pb-4 print:hidden" aria-label="월 마감 상태">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthStatusLabel status={status} />
        <button type="button" className="border border-finance-ink px-3 py-2 t-caption font-semibold text-finance-ink hover:bg-finance-panel" onClick={open}>{month} {status.state === 'closed' ? '마감 확인 · 해제' : '월 마감'}</button>
      </div>
      {status.state === 'closed' && pendingCount > 0 && <p className="mt-2 t-caption text-finance-amber">이 달 가져오기 대기 {pendingCount}건이 있습니다. <Link className="underline" href="/inbox">가져오기에서 검토</Link> · 내역에 반영하면 마감이 해제됩니다.</p>}
      {notice && <p role="status" className="mt-2 t-caption text-finance-green">{notice}</p>}
      <dialog ref={dialog} className="m-auto max-h-[85dvh] w-[calc(100%-32px)] max-w-lg overflow-y-auto border border-finance-ink bg-white p-5 text-finance-ink shadow-xl backdrop:bg-black/40 sm:p-7" aria-labelledby="month-close-title">
        <div className="flex items-start justify-between gap-4">
          <div><p className="t-label text-finance-blue">월 전체 확인</p><h2 className="mt-2 t-section" id="month-close-title">{month} 전체 마감</h2></div>
          <button type="button" className="px-2 py-1 text-finance-muted" aria-label="마감 창 닫기" onClick={() => dialog.current?.close()}>✕</button>
        </div>
        <p className="mt-3 t-caption leading-relaxed text-finance-muted">현재 탭·필터와 무관한 한 달 전체 거래입니다. 마감한 월만 통계에 포함되고, 이후 내역이 바뀌면 다시 확인해야 합니다.</p>
        {!summary && pending && <p role="status" className="py-8 t-body text-finance-muted">전체 월 요약을 불러오는 중…</p>}
        {summary && <>
          <p className="mt-5 t-body-strong">전체 거래 {summary.count.toLocaleString('ko-KR')}건</p>
          <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-finance-hairline py-4 t-caption">
            {([['수입', summary.income], ['지출', summary.expense], ['저축 납입', summary.saving]] as const).map(([label, value]) => <div key={label}><dt className="text-finance-muted">{label}</dt><dd className="mt-1 break-all font-semibold tabular-nums">{formatWon(value)}원</dd></div>)}
          </dl>
          <ul className="mt-4 space-y-1 t-caption text-finance-muted">
            <li>가져오기 대기 {summary.pendingCount}건</li>
            <li>미분류 거래 {summary.unclassifiedCount}건</li>
            <li>미반영 정기거래 {summary.unpostedRecurringCount}건</li>
          </ul>
          {!summary.closable && <p className="mt-4 t-caption text-finance-amber">한국 시간 기준으로 끝난 월만 마감할 수 있습니다.</p>}
          {summary.state === 'closed' ? <p className="mt-4 t-caption text-finance-muted">마감 해제 시 이 달은 통계에서 제외됩니다. 거래 내역은 그대로 유지됩니다.</p> : <>
            {summary.requiresAcknowledgment && <label className="mt-4 flex items-start gap-2 t-caption leading-relaxed"><input className="mt-1" type="checkbox" checked={acknowledgeWarnings} onChange={event => setAcknowledgeWarnings(event.target.checked)} />대기·미분류·미반영 항목과 누락 가능성을 확인했습니다.</label>}
            {summary.count === 0 && <label className="mt-3 flex items-start gap-2 t-caption"><input type="checkbox" checked={acknowledgeEmpty} onChange={event => setAcknowledgeEmpty(event.target.checked)} />거래 없는 월로 마감합니다.</label>}
          </>}
        </>}
        {error && <p className="mt-4 t-caption text-finance-red" role="alert">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className="border border-finance-border px-4 py-2 t-caption" onClick={() => dialog.current?.close()}>닫기</button>
          {!summary && !pending && <button type="button" className="border border-finance-ink px-4 py-2 t-caption" onClick={open}>다시 불러오기</button>}
          {summary?.state === 'closed' ? <button type="button" disabled={pending} className="bg-finance-ink px-4 py-2 t-caption text-white disabled:opacity-40" onClick={() => submit(true)}>{pending ? '처리 중…' : '마감 해제'}</button> : <button type="button" disabled={!summary?.closable || pending || (summary.requiresAcknowledgment && !acknowledgeWarnings) || (summary.count === 0 && !acknowledgeEmpty)} className="bg-finance-green px-4 py-2 t-caption text-white disabled:opacity-40" onClick={() => submit()}>{pending ? '처리 중…' : '월 전체 마감'}</button>}
        </div>
      </dialog>
    </section>
  )
}

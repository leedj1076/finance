'use client'

import { startTransition, useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { deleteManualTransaction, updateTransactionMemo, type ActionState } from './actions'

export function TransactionRowControls({ id, memo, editable, description }: { id: number; memo: string | null; editable: boolean; description: string }) {
  const [open, setOpen] = useState(false)
  const [draftMemo, setDraftMemo] = useState(memo ?? '')
  const [memoState, memoAction, pending] = useActionState<ActionState, FormData>(updateTransactionMemo, {})
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteManualTransaction, {})
  if (!open) {
    return (
      <span className="inline-flex gap-2 whitespace-nowrap">
        <button className="min-h-[30px] t-caption-strong text-finance-blue" onClick={() => { setDraftMemo(memo ?? ''); setOpen(true) }} type="button">메모</button>
        {editable && (
          <form action={deleteAction} className="inline" onSubmit={event => {
            if (!window.confirm(`${description}\n이 거래를 삭제할까요? 삭제한 거래는 복구할 수 없습니다.`)) event.preventDefault()
          }}>
            <input name="id" type="hidden" value={id} />
            <SubmitButton className="min-h-[30px] t-caption-strong text-finance-red" pendingLabel="삭제 중…">삭제</SubmitButton>
          </form>
        )}
        {deleteState.error && <span className="t-caption text-finance-red" role="alert">{deleteState.error}</span>}
      </span>
    )
  }
  return (
    <form action={memoAction} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => memoAction(form)) }} className="flex flex-wrap items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <input aria-label="거래 메모" className="h-[30px] w-[160px] border border-finance-border bg-white px-2 t-body-normal" value={draftMemo} onChange={event => setDraftMemo(event.target.value)} disabled={pending} maxLength={200} name="memo" />
      <SubmitButton className="h-[30px] border border-finance-ink px-2 t-caption-strong" pendingLabel="…">저장</SubmitButton>
      <button className="min-h-[30px] t-caption text-finance-muted" disabled={pending} onClick={() => setOpen(false)} type="button">닫기</button>
      {memoState.error && <span className="t-caption text-finance-red" role="alert">{memoState.error}</span>}
      {memoState.message && !memoState.error && <span className="t-caption text-finance-green" role="status">{memoState.message}</span>}
    </form>
  )
}

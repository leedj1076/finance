'use client'

import { startTransition, useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveHoldingMemo, type ActionState } from './actions'
import type { WeightBasis } from './types'

type Memo = { id: number; thesis: string | null; horizonYears: number | null; fundsNeededAt: string | null; lossLimitPct: number | null; weightBasis: WeightBasis }
const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const row = 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 t-caption text-finance-muted'

export function HoldingMemoForm({ security }: { security: Memo }) {
  const [draft, setDraft] = useState({ thesis: security.thesis ?? '', horizonYears: String(security.horizonYears ?? ''), fundsNeededAt: security.fundsNeededAt ?? '', lossLimitPct: String(security.lossLimitPct ?? ''), weightBasis: security.weightBasis })
  const [state, action, pending] = useActionState<ActionState, FormData>(saveHoldingMemo, {})
  return (
    <form action={action} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)) }} className="grid gap-2 border border-finance-border p-3">
      <fieldset className="contents" disabled={pending}>
        <input name="securityId" type="hidden" value={security.id} />
        <label className={row}>매수 논지<input className={control} value={draft.thesis} onChange={event => setDraft({ ...draft, thesis: event.target.value })} maxLength={300} name="thesis" placeholder="예: AI 서버용 HBM 수요로 3년간 매출 20%+ 성장" /></label>
        <label className={row}>투자 기간<input className={control} value={draft.horizonYears} onChange={event => setDraft({ ...draft, horizonYears: event.target.value })} inputMode="decimal" name="horizonYears" placeholder="년" /></label>
        <label className={row}>자금 사용 시점<input className={control} value={draft.fundsNeededAt} onChange={event => setDraft({ ...draft, fundsNeededAt: event.target.value })} maxLength={100} name="fundsNeededAt" placeholder="예: 2031 이후 · 정해진 용처 없음" /></label>
        <label className={row}>손실 한도<input className={control} value={draft.lossLimitPct} onChange={event => setDraft({ ...draft, lossLimitPct: event.target.value })} inputMode="decimal" name="lossLimitPct" placeholder="없음 (리포트가 임의로 만들지 않음)" /></label>
        <label className={row}>비중 분모
          <select className={control} value={draft.weightBasis} onChange={event => setDraft({ ...draft, weightBasis: event.target.value as WeightBasis })} name="weightBasis"><option value="stock_accounts">주식 계좌</option><option value="total_assets">전체 투자자산</option></select>
        </label>
        <div className="flex items-center justify-end gap-3">
          {state.error && <span className="t-caption text-finance-red" role="alert">{state.error}</span>}
          {state.message && !state.error && <span className="t-caption text-finance-green" role="status">{state.message}</span>}
          <SubmitButton className="h-[34px] bg-finance-ink px-3 t-caption-strong text-white" pendingLabel="저장 중…">저장</SubmitButton>
        </div>
      </fieldset>
    </form>
  )
}

'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveHoldingMemo, type ActionState } from './actions'
import type { WeightBasis } from './types'

type Memo = { id: number; thesis: string | null; horizonYears: number | null; fundsNeededAt: string | null; lossLimitPct: number | null; weightBasis: WeightBasis }
const control = 'h-[34px] min-w-0 w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const row = 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 t-caption text-finance-muted'

export function HoldingMemoForm({ security }: { security: Memo }) {
  const [state, action] = useActionState<ActionState, FormData>(saveHoldingMemo, {})
  return (
    <form action={action} className="grid gap-2 border border-finance-border p-3">
      <input name="securityId" type="hidden" value={security.id} />
      <label className={row}>매수 논지<input className={control} defaultValue={security.thesis ?? ''} maxLength={300} name="thesis" placeholder="예: AI 서버용 HBM 수요로 3년간 매출 20%+ 성장" /></label>
      <label className={row}>투자 기간<input className={control} defaultValue={security.horizonYears ?? ''} inputMode="decimal" name="horizonYears" placeholder="년" /></label>
      <label className={row}>자금 사용 시점<input className={control} defaultValue={security.fundsNeededAt ?? ''} maxLength={100} name="fundsNeededAt" placeholder="예: 2031 이후 · 정해진 용처 없음" /></label>
      <label className={row}>손실 한도<input className={control} defaultValue={security.lossLimitPct ?? ''} inputMode="decimal" name="lossLimitPct" placeholder="없음 (리포트가 임의로 만들지 않음)" /></label>
      <label className={row}>비중 분모
        <select className={control} defaultValue={security.weightBasis} name="weightBasis"><option value="stock_accounts">주식 계좌</option><option value="total_assets">전체 투자자산</option></select>
      </label>
      <div className="flex items-center justify-end gap-3">
        {state.error && <span className="t-caption text-finance-red" role="alert">{state.error}</span>}
        {state.message && !state.error && <span className="t-caption text-finance-green" role="status">{state.message}</span>}
        <SubmitButton className="h-[34px] bg-finance-ink px-3 t-caption-strong text-white" pendingLabel="저장 중…">저장</SubmitButton>
      </div>
    </form>
  )
}

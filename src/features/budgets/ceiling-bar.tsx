'use client'

import { formatRate, formatWon, savingsRate, shiftMonth } from '@/lib/finance'

export type CeilingBarBasis = {
  averageIncome: number
  incomeStart: string
  incomeEnd: string
  incomeMonthCount: number
}

export type CeilingBarProps = {
  target: number
  basis: CeilingBarBasis
  total: number | null
  ceiling: number
  dirty: boolean
  pending: boolean
  disabled: boolean
  onTargetChange: (target: number) => void
}

function compactWon(amount: number) {
  const absolute = Math.abs(amount)
  const formatted = absolute >= 10_000
    ? `${Math.trunc(absolute / 10_000).toLocaleString('ko-KR')}만`
    : formatWon(absolute)
  return amount < 0 ? `−${formatted}` : formatted
}

function incomeMonth(value: string) {
  return value.slice(0, 7)
}

export function CeilingBar({
  target,
  basis,
  total,
  ceiling,
  dirty,
  pending,
  disabled,
  onTargetChange,
}: CeilingBarProps) {
  const balance = total === null ? null : ceiling - total
  const balanceLabel = balance === null
    ? '입력 확인 필요'
    : balance < 0
      ? `초과 ${formatWon(Math.abs(balance))}`
      : `여유 ${formatWon(balance)}`
  const compactBalanceLabel = balance === null
    ? '입력 확인 필요'
    : balance < 0
      ? `초과 ${compactWon(Math.abs(balance))}`
      : `여유 ${compactWon(balance)}`
  const expectedRate = total === null ? null : savingsRate(basis.averageIncome, total)
  const popoverId = 'savings-target-popover'
  const saveLabel = pending ? '저장 중…' : dirty ? '변경사항 저장' : '저장됨'
  const mobileSaveLabel = pending ? '저장 중…' : dirty ? '저장' : '저장됨'
  const startMonth = incomeMonth(basis.incomeStart)
  const exclusiveEnd = incomeMonth(basis.incomeEnd)
  const includedEnd = shiftMonth(exclusiveEnd, -1)

  const targetButton = (mobile = false) => (
    <button
      aria-haspopup="dialog"
      className={mobile ? 'ceiling-bar__target ceiling-bar__target--mobile t-caption' : 'ceiling-bar__target t-body'}
      popoverTarget={popoverId}
      type="button"
    >
      목표 저축률 {target}%
      <svg aria-hidden="true" className="ceiling-bar__chevron" viewBox="0 0 12 12">
        <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.25" />
      </svg>
    </button>
  )

  return (
    <section aria-label="예산 지출 상한" className="ceiling-bar">
      <div className="ceiling-bar__desktop">
        {targetButton()}
        <p className="ceiling-bar__metric t-caption"><span>목표 지출 상한</span><strong className="t-section">{formatWon(ceiling)}</strong></p>
        <p className="ceiling-bar__metric t-caption"><span>편집안 합계</span><strong className={`t-section ${total === null ? 'text-finance-amber' : ''}`}>{total === null ? '입력 확인 필요' : formatWon(total)}</strong></p>
        <p aria-live="polite" className={`ceiling-bar__balance t-section ${balance === null ? 'text-finance-amber' : balance < 0 ? 'text-finance-red' : 'text-finance-green'}`}>{balanceLabel}</p>
      </div>

      <div className="ceiling-bar__mobile">
        <p className={`ceiling-bar__compact-summary t-caption ${balance === null ? 'text-finance-amber' : ''}`}>
          상한 {compactWon(ceiling)} · 합계 {total === null ? '입력 확인 필요' : compactWon(total)}{balance !== null && <> · <span className={balance < 0 ? 'text-finance-red' : 'text-finance-green'}>{compactBalanceLabel}</span></>}
        </p>
        {targetButton(true)}
      </div>

      <div className="ceiling-bar__actions">
        {dirty && <span className="ceiling-bar__dirty t-caption text-finance-amber">아직 저장하지 않은 편집안</span>}
        <button aria-label={saveLabel} className={`ceiling-bar__save t-body-strong ${dirty ? 'is-dirty' : ''}`} disabled={pending || disabled || !dirty} type="submit">
          <span className="ceiling-bar__save-desktop">{saveLabel}</span>
          <span className="ceiling-bar__save-mobile">{mobileSaveLabel}</span>
        </button>
      </div>

      <div aria-label="목표 저축률 설정" className="ceiling-bar__popover" id={popoverId} popover="auto" role="dialog">
        <p className="t-body-strong">목표 저축률</p>
        <div className="ceiling-bar__slider-row">
          <input
            aria-label="목표 저축률"
            id="savings-target"
            max={80}
            min={0}
            onChange={event => onTargetChange(Number(event.target.value))}
            step={1}
            type="range"
            value={target}
          />
          <output className="t-section" htmlFor="savings-target">{target}%</output>
        </div>
        <p className="ceiling-bar__formula t-caption text-finance-muted">
          월평균 수입 {formatWon(basis.averageIncome)} × (1 − {target}%) = <strong className="text-finance-ink">상한 {formatWon(ceiling)}</strong><br />
          {basis.incomeMonthCount}개월 수입 기준 ({startMonth} ~ {includedEnd})
        </p>
        <p className="ceiling-bar__expected t-caption">
          <span className="text-finance-muted">편집안대로면 예상 순저축률</span>
          <strong className={expectedRate !== null && expectedRate >= target ? 'text-finance-green' : 'text-finance-red'}>{expectedRate === null ? '입력 확인 필요' : `${formatRate(expectedRate)}%`}</strong>
        </p>
        <p className="ceiling-bar__notice t-label text-finance-faint">저축률 변경도 저장 버튼으로 함께 저장됩니다.</p>
      </div>
    </section>
  )
}

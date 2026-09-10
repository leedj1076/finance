import type { AiPromptInput } from '@/features/ai-settings/types'
import type {
  BudgetReference,
  BudgetRecommendationReport,
  BudgetRecommendationSnapshot,
  BudgetSourceRow,
} from '@/features/budget-recommendations/types'
import { formatWon } from '@/lib/finance'

import type { BudgetDraftRow } from './draft'
import type { BudgetBaseline } from './save-contract'

export type RecommendationRowContext = {
  jobId: string
  recommendation: BudgetRecommendationReport['rows'][number]
  snapshot: Pick<BudgetRecommendationSnapshot, 'month' | 'input' | 'evidence' | 'recurring'>
  promptInput: AiPromptInput | null
}

export type BudgetRowProps = {
  row: BudgetDraftRow
  baseline: BudgetBaseline
  source: BudgetSourceRow | null
  actual: number
  month: string
  period: 'past' | 'current' | 'future'
  recommendation: RecommendationRowContext | null
  origin: RecommendationRowContext | null
  selected: boolean
  onSelect: (selected: boolean) => void
  onEdit: (amount: string) => void
  onManual: () => void
}

function amount(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function won(value: number) {
  return `${formatWon(value)}원`
}

function signedExpense(value: number) {
  if (value > 0) return `−${won(value)}`
  if (value < 0) return `+${won(Math.abs(value))}`
  return '0원'
}

function ledgerLink(context: RecommendationRowContext, reference: Extract<BudgetReference, { kind: 'transaction' }>) {
  const evidence = context.snapshot.evidence.find((row) => row.id === reference.id)
  if (!evidence) return null
  const params = new URLSearchParams({ month: context.snapshot.month, tab: 'list', flow: evidence.flow })
  if (evidence.major) params.set('major', evidence.major)
  return {
    href: `/ledger?${params.toString()}`,
    label: `${evidence.date} · ${evidence.merchant || '가맹점 미입력'} · ${won(evidence.amount)}`,
  }
}

function Reference({ context, reference }: {
  context: RecommendationRowContext
  reference: BudgetReference
}) {
  if (reference.kind === 'transaction') {
    const link = ledgerLink(context, reference)
    return link ? <a className="font-medium text-finance-blue hover:text-finance-ink" href={link.href}>{link.label} →</a> : null
  }
  if (reference.kind === 'recurring') {
    const recurring = context.snapshot.recurring.find((row) => row.id === reference.id)
    return recurring ? <a className="font-medium text-finance-blue hover:text-finance-ink" href="/recurring">{recurring.date} · {recurring.memo || '정기 지출'} · {won(recurring.amount)} →</a> : null
  }
  if (reference.kind === 'planned') {
    const planned = context.snapshot.input.plannedExpenses.find((row) => row.id === reference.id)
    return planned ? <span>사용자 제공 · {planned.note || planned.major} · {won(planned.amount)}</span> : null
  }
  if (reference.kind === 'notes') return <span>사용자 제공 · {reference.quote}</span>
  const instruction = context.promptInput?.instructions[reference.scope]
  return instruction?.includes(reference.quote)
    ? <span>설정에서 제공한 정보 · {reference.quote}</span>
    : null
}

function ReasonDetails({ context, label, saved = false }: {
  context: RecommendationRowContext
  label: string
  saved?: boolean
}) {
  const row = context.recommendation
  const findingList = (title: string, findings: typeof row.exceptional) => findings.length > 0 && (
    <section>
      <h4 className="font-semibold text-finance-ink">{title}</h4>
      <ul className="mt-1 space-y-2">{findings.map((finding, index) => (
        <li key={`${finding.certainty}:${index}`}>
          <p>
            <strong className="text-finance-ink">{finding.certainty === 'hypothesis' ? '추정 · 확인 필요' : finding.certainty === 'user_provided' ? '사용자 제공' : '기록 확인'}</strong>
            {' '}{finding.text}
          </p>
          {finding.references.length > 0 && <ul className="mt-1 space-y-1">{finding.references.map((reference, referenceIndex) => (
            <li key={`${reference.kind}:${referenceIndex}`}><Reference context={context} reference={reference} /></li>
          ))}</ul>}
        </li>
      ))}</ul>
    </section>
  )
  return (
    <details className="border-t border-finance-hairline py-2">
      <summary aria-label={label} className="cursor-pointer t-caption font-semibold text-finance-blue" role="button">
        {saved ? '저장된 추천 이유' : '추천 이유'}
      </summary>
      <div className="mt-2 space-y-2 t-caption leading-6 text-finance-muted">
        <p>{row.reason}</p>
        {findingList('일회성 후보', row.exceptional)}
        {findingList('조정 후보', row.reducible)}
        {row.references.length > 0 && <ul className="space-y-1">{row.references.map((reference, index) => (
          <li key={`${reference.kind}:${index}`}><Reference context={context} reference={reference} /></li>
        ))}</ul>}
      </div>
    </details>
  )
}

export function BudgetRow({
  row,
  baseline,
  actual,
  month,
  period,
  recommendation,
  origin,
  selected,
  onSelect,
  onEdit,
  onManual,
}: BudgetRowProps) {
  const draftAmount = amount(row.amount)
  const invalidAmount = draftAmount === null
  const currentRecommendation = recommendation?.recommendation.major === row.major ? recommendation : null
  const savedOrigin = origin?.jobId === row.recommendationJobId && origin.recommendation.major === row.major ? origin : null
  const missingOrigin = row.recommendationJobId !== null && savedOrigin === null
  const remaining = draftAmount === null ? null : draftAmount - actual
  const invalidId = `budget-amount-error:${month}:${row.major}`

  return (
    <article className="grid min-w-0 gap-4 border-b border-finance-hairline py-4 md:grid-cols-[minmax(9rem,1fr)_minmax(10rem,0.8fr)_minmax(11rem,0.9fr)_minmax(12rem,1fr)]">
      <div className="min-w-0">
        <h3 className="t-body font-semibold text-finance-ink">{row.major}</h3>
        <p className="mt-1 t-caption text-finance-muted">저장된 예산 {won(baseline.amount)}</p>
        {period === 'current' && <>
          <p className="mt-1 t-caption text-finance-muted">실제 지출 {signedExpense(actual)}</p>
          {remaining !== null && <p className={`mt-1 t-caption ${remaining < 0 ? 'text-finance-red' : 'text-finance-green'}`}>앞으로 배정한 금액 {won(remaining)}</p>}
        </>}
        {period !== 'current' && draftAmount !== null && <p className="mt-1 t-caption text-finance-muted">월 전체 예산 {won(draftAmount)}</p>}
      </div>

      <div className="min-w-0">
        <label className="block t-caption text-finance-muted">
          <span className="sr-only">{row.major} 예산</span>
          <span className="flex items-center gap-2">
            <input
              aria-describedby={invalidAmount ? invalidId : undefined}
              aria-invalid={invalidAmount || undefined}
              aria-label={`${row.major} 예산`}
              className="h-[34px] min-w-0 flex-1 border border-finance-hairline bg-white px-3 text-right t-body tabular-nums text-finance-ink outline-none focus:border-finance-blue"
              min={0}
              onChange={(event) => onEdit(event.target.value)}
              step={1}
              type="number"
              value={row.amount}
            />
            <span>원</span>
          </span>
        </label>
        {invalidAmount && <p className="mt-1 t-caption text-finance-red" id={invalidId}>원 단위의 0 이상 정수를 입력해 주세요.</p>}
      </div>

      <div className="min-w-0 space-y-2">
        {currentRecommendation ? <>
          <label className="flex items-start gap-2 t-body text-finance-ink">
            <input
              aria-label={`${row.major} 추천 선택`}
              checked={selected}
              className="mt-1 accent-emerald-700"
              onChange={(event) => onSelect(event.target.checked)}
              type="checkbox"
            />
            <span className="font-medium tabular-nums">현재 AI 추천 {won(currentRecommendation.recommendation.amount)}</span>
          </label>
          <ReasonDetails context={currentRecommendation} label={`${row.major} 추천 이유`} />
        </> : <p className="t-caption text-finance-faint">현재 AI 추천 없음</p>}
      </div>

      <div className="min-w-0 space-y-2">
        {savedOrigin ? <>
          <p className="t-caption font-medium tabular-nums text-finance-muted">원래 AI 추천 {won(savedOrigin.recommendation.amount)}</p>
          {draftAmount !== null && draftAmount !== savedOrigin.recommendation.amount && <p className="t-caption font-semibold tabular-nums text-finance-violet">사용자 조정 {won(draftAmount)}</p>}
          {savedOrigin.jobId !== currentRecommendation?.jobId && <ReasonDetails context={savedOrigin} label={`${row.major} ${currentRecommendation ? '저장된 ' : ''}추천 이유`} saved={Boolean(currentRecommendation)} />}
          <button aria-label={`${row.major} 수동 초안으로 전환`} className="t-caption font-semibold text-finance-blue hover:text-finance-ink" onClick={onManual} type="button">수동 초안으로 전환</button>
        </> : missingOrigin ? <>
          <p className="t-caption leading-6 text-finance-amber">이 추천의 근거를 확인할 수 없습니다.</p>
          <button aria-label={`${row.major} 수동 초안으로 전환`} className="t-caption font-semibold text-finance-blue hover:text-finance-ink" onClick={onManual} type="button">수동 초안으로 전환</button>
        </> : <p className="t-caption text-finance-faint">수동 예산</p>}
      </div>
    </article>
  )
}

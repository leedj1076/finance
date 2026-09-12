'use client'

import { type CSSProperties, type ReactNode, useEffect, useId, useRef } from 'react'

import { AiPromptViewer } from '@/features/ai-settings/prompt-viewer'
import type { AiJobPromptView, AiPromptInput } from '@/features/ai-settings/types'
import type {
  BudgetFinding,
  BudgetRecommendationReport,
  BudgetRecommendationSnapshot,
  BudgetReference,
  CompletedBudgetRecommendation,
} from '@/features/budget-recommendations/types'
import { formatWon } from '@/lib/finance'

export type AiEvidenceContext = {
  jobId: string
  completedAt: string
  recommendation: BudgetRecommendationReport['rows'][number]
  snapshot: Pick<BudgetRecommendationSnapshot, 'month' | 'input' | 'evidence' | 'recurring'>
  promptInput: AiPromptInput | null
}

type AnchoredPopoverProps = {
  ariaLabel: string
  children: (close: () => void) => ReactNode
  open?: boolean
  onClose: () => void
  trigger: ReactNode
}

function AnchoredPopover({ ariaLabel, children, open, onClose, trigger }: AnchoredPopoverProps) {
  const generatedId = useId().replace(/:/g, '')
  const popoverId = `ai-popover-${generatedId}`
  const anchor = `--${popoverId}`
  const popoverRef = useRef<HTMLDivElement>(null)
  const ownerClosingRef = useRef(false)

  function close() {
    const popover = popoverRef.current
    if (popover?.matches(':popover-open')) {
      ownerClosingRef.current = true
      popover.hidePopover()
    }
    onClose()
  }

  useEffect(() => {
    if (open === undefined) return
    const popover = popoverRef.current
    if (!popover) return
    if (open) {
      if (!popover.matches(':popover-open')) popover.showPopover()
    } else if (popover.matches(':popover-open')) {
      ownerClosingRef.current = true
      popover.hidePopover()
    }
  }, [open])

  return (
    <span className="inline-flex min-w-0 items-baseline">
      <button
        className="t-caption font-semibold text-finance-blue"
        popoverTarget={popoverId}
        style={{ anchorName: anchor } as CSSProperties}
        type="button"
      >{trigger}</button>
      <div
        aria-label={ariaLabel}
        className="ai-anchored-popover"
        id={popoverId}
        onToggle={event => {
          if ((event.currentTarget as HTMLElement).matches(':popover-open')) return
          if (ownerClosingRef.current) ownerClosingRef.current = false
          else onClose()
        }}
        popover="auto"
        ref={popoverRef}
        role="dialog"
        style={{ positionAnchor: anchor } as CSSProperties}
      >
        {children(close)}
      </div>
    </span>
  )
}

function completedTime(value: string) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('month')}월 ${part('day')}일 ${part('hour')}:${part('minute')}`
}

function won(value: number) {
  return `${formatWon(value)}원`
}

function Reference({ context, reference }: { context: AiEvidenceContext; reference: BudgetReference }) {
  if (reference.kind === 'transaction') {
    const evidence = context.snapshot.evidence.find(row => row.id === reference.id)
    if (!evidence) return null
    const params = new URLSearchParams({ month: evidence.date.slice(0, 7), tab: 'list', flow: evidence.flow })
    if (evidence.major) params.set('major', evidence.major)
    return <a className="font-medium text-finance-blue" href={`/ledger?${params.toString()}`}>{evidence.date} · {evidence.merchant || '가맹점 미입력'} · {won(evidence.amount)} →</a>
  }
  if (reference.kind === 'recurring') {
    const recurring = context.snapshot.recurring.find(row => row.id === reference.id)
    return recurring
      ? <a className="font-medium text-finance-blue" href="/recurring">{recurring.date} · {recurring.memo || '정기 지출'} · {won(recurring.amount)} →</a>
      : null
  }
  if (reference.kind === 'planned') {
    const planned = context.snapshot.input.plannedExpenses.find(row => row.id === reference.id)
    return planned ? <span>사용자 제공 · {planned.note || planned.major} · {won(planned.amount)}</span> : null
  }
  if (reference.kind === 'notes') return <span>사용자 제공 · {reference.quote}</span>
  const instruction = context.promptInput?.instructions[reference.scope]
  return instruction?.includes(reference.quote)
    ? <span>설정에서 제공한 정보 · {reference.quote}</span>
    : null
}

function certaintyLabel(certainty: BudgetFinding['certainty']) {
  if (certainty === 'hypothesis') return '추정 · 확인 필요'
  if (certainty === 'user_provided') return '사용자 제공'
  return '기록 확인'
}

function FindingList({
  title,
  findings,
  context,
}: {
  title: string
  findings: BudgetFinding[]
  context: AiEvidenceContext
}) {
  if (findings.length === 0) return null
  return (
    <section className="mt-4">
      <h3 className="t-body-strong">{title}</h3>
      <ul className="mt-2 space-y-3 t-caption text-finance-muted">
        {findings.map((finding, index) => (
          <li key={`${finding.certainty}:${index}`}>
            <p><strong className="text-finance-ink">{certaintyLabel(finding.certainty)}</strong> {finding.text}</p>
            {finding.references.length > 0 && (
              <ul className="mt-1 space-y-1">
                {finding.references.map((reference, referenceIndex) => (
                  <li key={`${reference.kind}:${referenceIndex}`}><Reference context={context} reference={reference} /></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function AiEvidencePopover({
  context,
  open,
  onClose,
  onApplyChecked,
  trigger = '더 보기',
}: {
  context: AiEvidenceContext
  open?: boolean
  onClose: () => void
  onApplyChecked: (request: { major: string; jobId: string }) => void | Promise<void>
  trigger?: ReactNode
}) {
  const row = context.recommendation
  return (
    <AnchoredPopover ariaLabel={`${row.major} AI 추천 근거`} onClose={onClose} open={open} trigger={trigger}>{close => <>
      <header className="border-b border-finance-ink pb-3">
        <h2 className="t-body-strong">{row.major} · AI 추천 {won(row.amount)}</h2>
        <p className="mt-1 t-caption text-finance-muted">{completedTime(context.completedAt)} 완료</p>
      </header>
      <p className="mt-4 t-body leading-7">{row.reason}</p>
      <FindingList context={context} findings={row.exceptional} title="일회성 후보" />
      <FindingList context={context} findings={row.reducible} title="조정 후보" />
      {row.references.length > 0 && (
        <section className="mt-4">
          <h3 className="t-body-strong">참조</h3>
          <ul className="mt-2 space-y-1 t-caption text-finance-muted">
            {row.references.map((reference, index) => (
              <li key={`${reference.kind}:${index}`}><Reference context={context} reference={reference} /></li>
            ))}
          </ul>
        </section>
      )}
      <footer className="mt-5 flex items-center gap-2 border-t border-finance-hairline pt-3">
        <button className="ml-auto px-3 t-caption font-semibold text-finance-muted" onClick={close} type="button">닫기</button>
        <button
          className="min-h-9 border border-finance-ink bg-finance-ink px-4 t-caption font-semibold text-white"
          onClick={() => void onApplyChecked({ major: row.major, jobId: context.jobId })}
          type="button"
        >{won(row.amount)} 넣기</button>
      </footer>
    </>}</AnchoredPopover>
  )
}

export function AiSummaryPopover({
  completed,
  open,
  onClose,
  onShowPrompt,
  promptView,
  promptLoading = false,
  promptError = null,
  trigger = '요약',
}: {
  completed: CompletedBudgetRecommendation
  open?: boolean
  onClose: () => void
  onShowPrompt: (jobId: string) => void | Promise<void>
  promptView?: AiJobPromptView | null
  promptLoading?: boolean
  promptError?: string | null
  trigger?: ReactNode
}) {
  const context: AiEvidenceContext = {
    jobId: completed.id,
    completedAt: completed.completedAt,
    recommendation: completed.report.rows[0] ?? {
      major: '', amount: 0, reason: '', references: [], exceptional: [], reducible: [],
    },
    snapshot: completed.snapshot,
    promptInput: completed.promptInput,
  }
  return (
    <AnchoredPopover ariaLabel="AI 예산 추천 요약" onClose={onClose} open={open} trigger={trigger}>{close => <>
      <header className="border-b border-finance-ink pb-3">
        <h2 className="t-body-strong">AI 예산 추천 요약</h2>
        <p className="mt-1 t-caption text-finance-muted">{completedTime(completed.completedAt)} 완료</p>
      </header>
      <p className="mt-4 t-body leading-7">{completed.report.summary}</p>
      <dl className="mt-4 grid grid-cols-2 gap-px bg-finance-hairline">
        <div className="bg-background p-3"><dt className="t-label text-finance-muted">미분류 실제 지출</dt><dd className="mt-1 t-body-strong">{won(completed.snapshot.current.unallocatedActual)}</dd></div>
        <div className="bg-background p-3"><dt className="t-label text-finance-muted">미배정 정기 지출</dt><dd className="mt-1 t-body-strong">{won(completed.snapshot.current.unallocatedRecurring)}</dd></div>
        <div className="bg-background p-3"><dt className="t-label text-finance-muted">근거 제공</dt><dd className="mt-1 t-body-strong">{completed.snapshot.evidenceCount.provided} / {completed.snapshot.evidenceCount.total}</dd></div>
        <div className="bg-background p-3"><dt className="t-label text-finance-muted">처리 대기·미분류</dt><dd className="mt-1 t-body-strong">{completed.snapshot.pendingCount}건 · {completed.snapshot.unclassifiedCount}건</dd></div>
      </dl>
      {completed.report.limitations.length > 0 && (
        <section className="mt-4">
          <h3 className="t-body-strong">한계</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 t-caption text-finance-muted">
            {completed.report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}
          </ul>
        </section>
      )}
      {completed.report.overCeilingReason && (
        <section className="mt-4">
          <h3 className="t-body-strong">상한 초과 이유</h3>
          <p className="mt-2 t-caption text-finance-muted">{completed.report.overCeilingReason}</p>
        </section>
      )}
      <FindingList context={context} findings={completed.report.adjustments} title="상한 조정 후보" />
      {promptError && <p className="mt-4 border-l-2 border-finance-red bg-finance-red-tint px-3 py-2 t-caption" role="alert">{promptError}</p>}
      {promptView && <div className="mt-4"><AiPromptViewer view={promptView} /></div>}
      <footer className="mt-5 flex items-center gap-2 border-t border-finance-hairline pt-3">
        <button
          className="t-caption font-semibold text-finance-blue disabled:text-finance-faint"
          disabled={promptLoading}
          onClick={() => void onShowPrompt(completed.id)}
          type="button"
        >{promptLoading ? '프롬프트 확인 중…' : '사용한 프롬프트'}</button>
        <button className="ml-auto px-3 t-caption font-semibold text-finance-muted" onClick={close} type="button">닫기</button>
      </footer>
    </>}</AnchoredPopover>
  )
}

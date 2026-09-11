'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import { checkRecommendationForApply } from '@/features/budget-recommendations/client'
import { BudgetRecommendationPanel } from '@/features/budget-recommendations/panel'
import type { BudgetRecommendationData, BudgetRecommendationSnapshot, CompletedBudgetRecommendation } from '@/features/budget-recommendations/types'
import { currentMonthInKorea, formatRate, formatWon, savingsRate } from '@/lib/finance'

import { saveBudgetPlan, type BudgetActionState } from './actions'
import { BudgetRow, type RecommendationRowContext } from './budget-row'
import { budgetDraftReducer, createBudgetDraft, draftBudgetAmounts, draftBudgetChanges, type BudgetDraftChoice } from './draft'
import { spendingCeilingForTarget } from './simulator-calculations'
import { VariableSpendSimulator } from './simulator'
import type { getBudgetReviewData } from './review-queries'
import type { BudgetBaseline, BudgetSaveRequest } from './save-contract'

type CanonicalBudgetRow = {
  major: string
  group: string
  budget: number
  previousBudget: number
  actual: number
  average: number
  remaining: number
  percent: number | null
}

type BudgetFormProps = {
  averageExpense: number
  averageIncome: number
  baselines: BudgetBaseline[]
  currentSavingsRate: number
  month: string
  rows: CanonicalBudgetRow[]
  review: Awaited<ReturnType<typeof getBudgetReviewData>>
  savingsTarget: number
  targetVersion: string
  spendCeiling: number
  basis: BudgetRecommendationSnapshot['basis']
  savedRecommendations: CompletedBudgetRecommendation[]
}

const groups = [
  { key: 'fixed', label: '고정비', note: '조절이 어려운 비용' },
  { key: 'variable', label: '변동비', note: '생활하면서 조절할 비용' },
  { key: 'irregular', label: '비정기', note: '여행·경조사 등 월 적립 예산' },
]

const initialState: BudgetActionState = {}

function SaveButton({ dirty, pending, disabled = false }: { dirty: boolean; pending: boolean; disabled?: boolean }) {
  return (
    <button
      className={`h-[34px] px-4 t-body-strong transition-colors disabled:cursor-not-allowed ${dirty
        ? 'bg-finance-ink text-white hover:opacity-80 disabled:opacity-60'
        : 'border border-finance-hairline bg-finance-panel text-finance-muted'}`}
      disabled={pending || !dirty || disabled}
      type="submit"
    >
      {pending ? '저장 중…' : dirty ? '변경사항 저장' : '저장됨'}
    </button>
  )
}

export function BudgetForm(props: BudgetFormProps) {
  // A different month owns a new editor, even if the caller keeps its identity.
  return <BudgetEditor key={props.month} {...props} />
}

function BudgetEditor({
  averageExpense,
  averageIncome,
  baselines,
  currentSavingsRate,
  month,
  rows,
  review,
  savingsTarget,
  targetVersion,
  spendCeiling,
  basis,
  savedRecommendations,
}: BudgetFormProps) {
  const router = useRouter()
  const [draft, dispatch] = useReducer(budgetDraftReducer, baselines, createBudgetDraft)
  const [selected, setSelected] = useState<string[]>([])
  const [targetBaseline, setTargetBaseline] = useState({ savingsTarget, targetVersion })
  const [target, setTarget] = useState(savingsTarget)
  const targetBaselineRef = useRef(targetBaseline)
  const targetRef = useRef(target)
  const [acknowledgeOverage, setAcknowledgeOverage] = useState(false)
  const compareRequested = useRef(false)
  const [compareWaiting, setCompareWaiting] = useState(false)
  const [recommendationState, setRecommendationState] = useState<{ month: string; data: BudgetRecommendationData } | null>(null)
  const recommendationContexts = useRef({ month, items: new Map<string, CompletedBudgetRecommendation>() })
  const completedJobId = useRef<string | null>(null)
  const draftRef = useRef(draft)
  const applyRequest = useRef<AbortController | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [state, setState] = useState<BudgetActionState>(initialState)
  const [pending, setPending] = useState(false)
  const saveRequest = useRef<symbol | null>(null)
  useEffect(() => () => { saveRequest.current = null }, [])
  const [reduction, setReduction] = useState(10)
  const [preview, setPreview] = useState<{ label: string; amounts: Record<string, string>; manualMajors: string[]; source: BudgetDraftChoice['source'] } | null>(null)
  const amounts = useMemo(() => Object.fromEntries(draft.rows.map(row => [row.major, row.amount])), [draft.rows])
  const parsedDraftAmounts = useMemo(() => {
    try { return draftBudgetAmounts(draft) } catch { return null }
  }, [draft])
  const totalBudget = parsedDraftAmounts?.reduce((sum, row) => sum + row.amount, 0) ?? null
  const targetSpendCeiling = spendingCeilingForTarget({
    averageIncome,
    initialSavingsTarget: savingsTarget,
    savingsTarget: target,
    serverSpendCeiling: spendCeiling,
  })
  const targetGap = Math.max(averageExpense - targetSpendCeiling, 0)
  const allocationGap = totalBudget === null ? null : targetSpendCeiling - totalBudget
  const expectedSavingsRate = totalBudget === null ? null : savingsRate(averageIncome, totalBudget)
  let changes: BudgetSaveRequest['changes'] = []
  let invalidDraft = false
  try { changes = draftBudgetChanges(draft) } catch { invalidDraft = true }
  const payload: BudgetSaveRequest = { month, changes,
    targetChange: target === targetBaseline.savingsTarget ? null : { value: target, expectedVersion: targetBaseline.targetVersion }, acknowledgeOverage }
  const isDirty = invalidDraft || payload.targetChange !== null || changes.length > 0

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveRequest.current || applyBusy || compareWaiting || invalidDraft || !isDirty) return
    // Snapshot before controls are disabled; the ref also rejects same-tick submits.
    const formData = new FormData(event.currentTarget)
    const request = Symbol('budget-save')
    saveRequest.current = request
    setPending(true)
    try {
      const result = await saveBudgetPlan(state, formData)
      if (saveRequest.current !== request) return
      if (result.saved) {
        dispatch({ type: 'saved', rows: result.saved.rows })
        setTargetBaseline({ savingsTarget: result.saved.savingsTarget, targetVersion: result.saved.targetVersion })
        setTarget(result.saved.savingsTarget)
        setAcknowledgeOverage(false)
      }
      setState(result)
    } catch {
      if (saveRequest.current !== request) return
      setState({ error: '저장 결과를 확인하지 못했습니다. 입력한 초안을 유지했으니 다시 저장해 주세요.' })
    } finally {
      // Leaving this editor does not cancel the server mutation. Ignore its late result.
      if (saveRequest.current === request) {
        saveRequest.current = null
        setPending(false)
      }
    }
  }

  const baselineByMajor = new Map(draft.baseline.map(row => [row.major, row]))
  const activeMajors = useMemo(() => rows.map(row => row.major), [rows])
  draftRef.current = draft
  targetRef.current = target
  targetBaselineRef.current = targetBaseline
  const recommendationData = recommendationState?.month === month ? recommendationState.data : null
  const currentCompleted = recommendationData?.completed ?? null
  if (recommendationContexts.current.month !== month) {
    recommendationContexts.current = { month, items: new Map() }
  }
  const referencedRecommendationIds = new Set([
    ...draft.rows.map(row => row.recommendationJobId),
    ...(draft.undoRows?.map(row => row.recommendationJobId) ?? []),
    currentCompleted?.id ?? null,
  ].filter((id): id is string => id !== null))
  for (const saved of savedRecommendations) {
    if (referencedRecommendationIds.has(saved.id)) recommendationContexts.current.items.set(saved.id, saved)
  }
  if (currentCompleted) recommendationContexts.current.items.set(currentCompleted.id, currentCompleted)
  for (const id of recommendationContexts.current.items.keys()) {
    if (!referencedRecommendationIds.has(id)) recommendationContexts.current.items.delete(id)
  }
  const recommendationsById = recommendationContexts.current.items
  const recommendedMajors = currentCompleted
    ? currentCompleted.report.rows.map(row => row.major).filter(major => baselineByMajor.has(major))
    : []
  const recommendationActive = recommendationData?.latestJob?.status === 'queued'
    || recommendationData?.latestJob?.status === 'running'
  const period = month < currentMonthInKorea() ? 'past' : month > currentMonthInKorea() ? 'future' : 'current'

  const getDraftAmounts = useCallback(() => draftBudgetAmounts(draftRef.current), [])
  const onRecommendationData = useCallback((next: BudgetRecommendationData) => {
    const nextCompletedId = next.completed?.id ?? null
    if (completedJobId.current !== nextCompletedId) setSelected([])
    completedJobId.current = nextCompletedId
    setRecommendationState({ month, data: next })
    setApplyError(null)
  }, [month])

  useEffect(() => () => applyRequest.current?.abort(), [])

  useEffect(() => {
    if (!compareRequested.current) return
    compareRequested.current = false
    dispatch({ type: 'rebase', rows: baselines })
    if (targetRef.current === targetBaselineRef.current.savingsTarget) setTarget(savingsTarget)
    setTargetBaseline({ savingsTarget, targetVersion })
    setAcknowledgeOverage(false)
    setCompareWaiting(false)
  }, [baselines, savingsTarget, targetVersion])

  function recommendationContext(completed: CompletedBudgetRecommendation | undefined, major: string): RecommendationRowContext | null {
    const recommendation = completed?.report.rows.find(row => row.major === major)
    if (!completed || !recommendation) return null
    return {
      jobId: completed.id,
      recommendation,
      snapshot: completed.snapshot,
      promptInput: completed.promptInput,
    }
  }

  async function applySelectedRecommendations() {
    if (!currentCompleted || selected.length === 0 || applyBusy || recommendationActive
      || payload.targetChange !== null
      || recommendationData?.freshness === 'source_changed'
      || recommendationData?.freshness === 'budgets_changed') return
    applyRequest.current?.abort()
    const controller = new AbortController()
    applyRequest.current = controller
    setApplyBusy(true)
    setApplyError(null)
    try {
      const verified = await checkRecommendationForApply(month, currentCompleted.id, controller.signal)
      if (applyRequest.current !== controller || controller.signal.aborted) return
      const selectedMajors = new Set(selected)
      dispatch({
        type: 'fill',
        choices: verified.report.rows
          .filter((row) => selectedMajors.has(row.major))
          .map((row) => ({
            major: row.major,
            amount: row.amount,
            source: 'ai',
            recommendationJobId: verified.id,
          })),
      })
      setSelected([])
      setRecommendationState(current => current?.month === month
        ? { month, data: { ...current.data, completed: verified } }
        : current)
      setAcknowledgeOverage(false)
    } catch (error) {
      if (applyRequest.current !== controller || controller.signal.aborted) return
      const code = error instanceof Error ? error.message : 'request_failed'
      setApplyError(code === 'source_changed' ? '기록이 변경되어 재추천이 필요합니다.'
        : code === 'budgets_changed' ? '예산이 변경되어 재추천이 필요합니다.'
          : code === 'invalid_result' ? '추천 결과를 안전하게 확인하지 못했습니다.'
            : '추천 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      if (applyRequest.current === controller) {
        applyRequest.current = null
        setApplyBusy(false)
      }
    }
  }

  function previewFill(
    label: string,
    proposed: Record<string, string>,
    manualMajors = Object.keys(proposed),
    source: BudgetDraftChoice['source'] = null,
  ) {
    setPreview({ label, amounts: proposed, manualMajors, source })
  }

  function fillFrom(key: 'average' | 'previousBudget') {
    previewFill(
      key === 'average' ? '월평균으로 채우기' : '지난달 예산 채우기',
      Object.fromEntries(rows.map((row) => [row.major, String(row[key] || '')])),
      rows.map((row) => row.major),
      key === 'previousBudget' ? 'previousBudget' : null,
    )
  }

  function fillFromReview() {
    const reviewByMajor = new Map(review.rows.map((row) => [row.major, row.suggestion]))
    previewFill('기존 리뷰 규칙으로 채우기', Object.fromEntries(rows.map((row) => [
      row.major,
      String(reviewByMajor.get(row.major) || ''),
    ])))
  }

  function reduceReviewVariables() {
    if (!Number.isFinite(reduction) || reduction < 0 || reduction > 50) return
    const reviewByMajor = new Map(review.rows.map((row) => [row.major, row]))
    previewFill('변동비 줄이기', Object.fromEntries(rows.map((row) => {
      const reviewRow = reviewByMajor.get(row.major)
      if (reviewRow?.group !== 'variable' || reviewRow.median <= 0) return [row.major, amounts[row.major]]
      const amount = Math.round((reviewRow.median * (1 - reduction / 100)) / 1_000) * 1_000
      return [row.major, amount > 0 ? String(amount) : '']
    })), review.rows.filter(row => row.group === 'variable' && row.median > 0).map(row => row.major))
  }

  function applySimulator(amountsFromCuts: Record<string, string>) {
    previewFill('절약 시뮬레이션 가져오기', { ...amounts, ...amountsFromCuts }, Object.keys(amountsFromCuts))
  }

  return (
    <form onSubmit={submitBudget} className="mt-6 space-y-6">
      <input name="payload" type="hidden" value={JSON.stringify(payload)} />
      <input name="month" type="hidden" value={month} />
      <fieldset className="min-w-0 space-y-6 border-0 p-0" disabled={pending || applyBusy}>

      <section className="border-y border-finance-ink py-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="t-label uppercase text-finance-blue">지출 상한 배분</p>
            <h2 className="mt-1 t-section text-finance-ink">저축 목표 안에서 카테고리 예산을 나눕니다</h2>
          </div>
          <p className={`t-body-strong tabular-nums ${allocationGap === null ? 'text-finance-amber' : allocationGap < 0 ? 'text-finance-red' : 'text-finance-green'}`} aria-live="polite">
            {allocationGap === null ? '예산 금액을 확인해 주세요.' : allocationGap < 0
              ? `상한보다 ${formatWon(Math.abs(allocationGap))}원 초과`
              : `상한 안에서 ${formatWon(allocationGap)}원 여유`}
          </p>
        </div>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="min-w-64">
            <label className="t-body font-medium text-finance-ink" htmlFor="savings-target">
              목표 저축률
            </label>
            <div className="mt-3 flex items-center gap-4">
              <input
                aria-label="목표 저축률"
                className="w-full accent-emerald-700"
                id="savings-target"
                max={80}
                min={0}
                name="savingsTarget"
                onChange={(event) => { setTarget(Number(event.target.value)); setAcknowledgeOverage(false) }}
                type="range"
                value={target}
              />
              <output className="w-14 text-right t-kpi-sm text-finance-green">
                {target}%
              </output>
            </div>
          </div>
          <div className="grid flex-1 border-y border-finance-hairline sm:grid-cols-4 sm:divide-x sm:divide-finance-hairline">
            <div className="p-4">
              <p className="t-caption text-finance-muted">월평균 수입</p>
              <p className="mt-1 t-kpi-sm text-finance-ink">{formatWon(averageIncome)}원</p>
              <p className="mt-1 t-caption text-finance-faint">{basis.incomeMonthCount}개월 기록 기준</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-muted">카테고리 합계</p>
              <p className="mt-1 t-kpi-sm text-finance-ink">{totalBudget === null ? '입력 확인 필요' : `${formatWon(totalBudget)}원`}</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-green">목표 지출 상한</p>
              <p className="mt-1 t-kpi-sm text-finance-green">{formatWon(targetSpendCeiling)}원</p>
            </div>
            <div className="p-4">
              <p className="t-caption text-finance-muted">예상 순저축률</p>
              <p className={`mt-1 t-kpi-sm ${expectedSavingsRate === null ? 'text-finance-amber' : expectedSavingsRate >= target ? 'text-finance-green' : 'text-finance-red'}`}>
                {expectedSavingsRate === null ? '-' : `${formatRate(expectedSavingsRate)}%`}
              </p>
              <p className="mt-1 t-caption text-finance-muted">현재 실적 {formatRate(currentSavingsRate)}%</p>
            </div>
          </div>
        </div>
        <p className={`mt-4 t-body ${targetGap > 0 ? 'text-finance-red' : 'text-finance-green'}`}>
          {targetGap > 0
            ? `목표 달성을 위해 월평균 지출에서 ${formatWon(targetGap)}원을 줄여야 합니다.`
            : '현재 월평균 지출이 목표 상한 이내입니다.'}
        </p>
      </section>

      <BudgetRecommendationPanel
        basis={basis}
        getDraftAmounts={getDraftAmounts}
        key={`budget-recommendation:${month}`}
        majors={activeMajors}
        month={month}
        onData={onRecommendationData}
        targetDirty={payload.targetChange !== null}
      />

      {currentCompleted && <section aria-label="AI 추천 검토" className="border-t border-finance-ink py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="t-label uppercase text-finance-violet">추천안 검토</p>
            <h2 className="mt-1 t-section text-finance-ink">{currentCompleted.report.summary}</h2>
            {currentCompleted.report.limitations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 t-caption text-finance-muted">{currentCompleted.report.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
          </div>
          <div className="grid min-w-0 gap-px bg-finance-hairline sm:grid-cols-2 lg:min-w-[28rem]">
            <div className="bg-white p-3"><p className="t-caption text-finance-muted">AI 전체 제안 합계</p><p className="mt-1 t-kpi-sm text-finance-violet">{formatWon(currentCompleted.evaluation.total)}원</p></div>
            <div className="bg-white p-3"><p className="t-caption text-finance-muted">현재 편집안 카테고리 합계</p><p className="mt-1 t-kpi-sm text-finance-ink">{totalBudget === null ? '입력 확인 필요' : `${formatWon(totalBudget)}원`}</p></div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 t-caption text-finance-muted sm:grid-cols-2 lg:grid-cols-4">
          <p>미분류 실제 지출 {formatWon(currentCompleted.snapshot.current.unallocatedActual)}원</p>
          <p>미배정 정기 지출 {formatWon(currentCompleted.snapshot.current.unallocatedRecurring)}원</p>
          <p>근거 제공 {currentCompleted.snapshot.evidenceCount.provided}/{currentCompleted.snapshot.evidenceCount.total}건</p>
          <p>처리 대기 {currentCompleted.snapshot.pendingCount}건 · 미분류 {currentCompleted.snapshot.unclassifiedCount}건</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 t-body">
          <span className={currentCompleted.evaluation.overage > 0 ? 'text-finance-red' : 'text-finance-green'}>상한 초과 {formatWon(currentCompleted.evaluation.overage)}원</span>
          <span className="text-finance-muted">제안 예상 저축률 {formatRate(currentCompleted.evaluation.savingsRate)}%</span>
        </div>
        {currentCompleted.report.overCeilingReason && <p className="mt-2 t-caption text-finance-red">{currentCompleted.report.overCeilingReason}</p>}
        {currentCompleted.report.adjustments.length > 0 && <details className="mt-3 border-t border-finance-hairline py-2">
          <summary className="cursor-pointer t-body-strong text-finance-blue">상한 조정 후보</summary>
          <ul className="mt-2 space-y-2 t-caption text-finance-muted">{currentCompleted.report.adjustments.map((adjustment, index) => <li key={index}><strong className="text-finance-ink">{adjustment.certainty === 'hypothesis' ? '추정 · 확인 필요' : adjustment.certainty === 'user_provided' ? '사용자 제공' : '기록 확인'}</strong> {adjustment.text}</li>)}</ul>
        </details>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button className="h-[30px] border border-finance-hairline px-3 t-body-strong" onClick={() => setSelected(recommendedMajors)} type="button">추천 전체 선택</button>
          <button className="h-[30px] border border-finance-hairline px-3 t-body-strong" onClick={() => setSelected([])} type="button">추천 선택 해제</button>
          <button className="h-[34px] bg-finance-violet px-4 t-body-strong text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={selected.length === 0 || applyBusy || recommendationActive || payload.targetChange !== null || recommendationData?.freshness === 'source_changed' || recommendationData?.freshness === 'budgets_changed'} onClick={() => void applySelectedRecommendations()} type="button">
            {applyBusy ? '추천 확인 중…' : '선택한 추천 가져오기'}
          </button>
        </div>
        {applyError && <p className="mt-3 t-body text-finance-red" role="alert">{applyError}</p>}
      </section>}

      <section
        className="overflow-hidden border-t border-finance-ink"
        id="budget-list"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-finance-hairline py-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="t-section text-finance-ink">분류별 월 예산</h2>
            <p className="mt-1 t-caption text-finance-muted">입력 합계 {totalBudget === null ? '확인 필요' : `${formatWon(totalBudget)}원`}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
              onClick={() => fillFrom('previousBudget')}
              type="button"
            >
              지난달 예산 채우기
            </button>
            <button
              className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
              onClick={fillFromReview}
              type="button"
            >
              기존 리뷰 규칙으로 채우기
            </button>
            <button
              className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
              onClick={() => fillFrom('average')}
              type="button"
            >
              월평균으로 채우기
            </button>
            <SaveButton disabled={invalidDraft || applyBusy || compareWaiting} dirty={isDirty} pending={pending} />
          </div>
        </div>

        <div className="border-b border-finance-hairline py-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="t-caption text-finance-muted">리뷰 제안 변동비 감축률
              <input aria-label="리뷰 제안 변동비 감축률" className="ml-2 h-[30px] w-20 border border-finance-hairline px-2 text-right" min="0" max="50" onChange={(event) => setReduction(Number(event.target.value))} step="1" type="number" value={reduction} />%
            </label>
            <button className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel" onClick={reduceReviewVariables} type="button">변동비에 적용</button>
          </div>
        </div>

        {preview && (
          <section aria-label="예산 채우기 미리보기" className="border-b border-finance-hairline bg-finance-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="t-body-strong text-finance-ink">{preview.label} 미리보기</p><p className="t-caption text-finance-muted">확인 전에는 편집안과 저장된 예산이 바뀌지 않습니다. 가져온 항목은 수동 초안으로 전환됩니다.</p></div><div className="flex gap-2"><button className="h-[30px] border border-finance-hairline bg-white px-3 t-body-strong text-finance-muted" onClick={() => setPreview(null)} type="button">취소</button><button className="h-[30px] bg-finance-ink px-3 t-body-strong text-white" onClick={() => { const changed = new Set(preview.manualMajors); dispatch({ type: 'fill', choices: Object.entries(preview.amounts).filter(([major]) => changed.has(major)).map(([major, amount]) => ({ major, amount: Number(amount), source: preview.source, recommendationJobId: null })) }); setAcknowledgeOverage(false); setPreview(null); document.getElementById('budget-list')?.scrollIntoView({ behavior: 'smooth' }) }} type="button">초안에 가져오기</button></div></div>
            <ul className="mt-3 divide-y divide-finance-hairline">{rows.filter((row) => amounts[row.major] !== preview.amounts[row.major]).map((row) => <li className="grid grid-cols-[1fr_auto_auto] gap-3 py-2 t-caption" key={row.major}><span className="font-medium text-finance-ink">{row.major}</span><span className="text-finance-muted">현재 {formatWon(Number(amounts[row.major]) || 0)}원</span><span className="text-finance-blue">제안 {formatWon(Number(preview.amounts[row.major]) || 0)}원</span></li>)}</ul>
          </section>
        )}

        <div className="divide-y divide-finance-hairline">
          {groups.map((group) => {
            const groupRows = rows.filter((row) => row.group === group.key)
            if (groupRows.length === 0) return null
            return (
              <section className="p-5" key={group.key}>
                <div className="mb-4 flex items-baseline gap-2">
                  <h3 className="t-section text-finance-ink">{group.label}</h3>
                  <span className="t-caption text-finance-faint">{group.note}</span>
                </div>
                <div className="space-y-3">
                  {groupRows.map((canonicalRow) => {
                    const row = draft.rows.find(item => item.major === canonicalRow.major)
                    const baseline = baselineByMajor.get(canonicalRow.major)
                    if (!row || !baseline) return null
                    const saved = row.recommendationJobId ? recommendationsById.get(row.recommendationJobId) : undefined
                    const source = currentCompleted?.snapshot.rows.find(item => item.major === row.major) ?? null
                    return <BudgetRow
                      actual={canonicalRow.actual}
                      baseline={baseline}
                      key={canonicalRow.major}
                      month={month}
                      onEdit={(amount) => { dispatch({ type: 'edit', major: row.major, amount }); setAcknowledgeOverage(false) }}
                      onManual={() => { dispatch({ type: 'choose', major: row.major, amount: Number(row.amount), source: null, recommendationJobId: null }); setAcknowledgeOverage(false) }}
                      onSelect={(checked) => setSelected((current) => checked
                        ? [...new Set([...current, row.major])] : current.filter(major => major !== row.major))}
                      origin={recommendationContext(saved, row.major)}
                      period={period}
                      recommendation={recommendationContext(currentCompleted ?? undefined, row.major)}
                      row={row}
                      selected={selected.includes(row.major)}
                      source={source}
                    />
                  })}
                </div>
              </section>
            )
          })}
        </div>
        {draft.undoRows && <div className="border-t border-finance-hairline py-4">
          <button className="h-[30px] border border-finance-hairline px-3 t-body-strong text-finance-muted" onClick={() => { dispatch({ type: 'undo' }); setAcknowledgeOverage(false) }} type="button">최근 초안 변경 실행 취소</button>
        </div>}
      </section>

      <details className="group border-t border-finance-ink">
        <summary className="flex cursor-pointer list-none items-center justify-between py-4 t-section text-finance-ink">
          <span>절약 시뮬레이션 <span className="ml-2 font-normal text-finance-muted">변동비를 줄였을 때 목표 달성 여부를 미리 봅니다</span></span>
          <span className="text-finance-muted group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <VariableSpendSimulator
          averageExpense={averageExpense}
          averageIncome={averageIncome}
          onApply={applySimulator}
          rows={rows
            .filter((row) => row.group === 'variable' && row.average > 0)
            .sort((left, right) => right.average - left.average)
            .map((row) => ({ major: row.major, average: row.average }))}
          savingsTarget={target}
        />
      </details>

      {((allocationGap !== null && allocationGap < 0) || state.code === 'overage_confirmation_required') && <label className="flex items-center gap-2 t-body text-finance-red">
        <input checked={acknowledgeOverage} onChange={event => setAcknowledgeOverage(event.target.checked)} type="checkbox" />
        미분류·정기 지출을 포함한 전체 예산의 상한 초과를 확인하고 저장합니다.
      </label>}

      {invalidDraft && <p className="t-body text-finance-red">원 단위의 0 이상 정수를 입력해 주세요.</p>}
      {isDirty && !invalidDraft && <p aria-live="polite" className="t-body text-finance-amber">아직 저장하지 않은 편집안입니다.</p>}
      {state.saved && !isDirty && <p aria-live="polite" className="t-body text-finance-green">{state.saved.rows.some(row => row.recommendationJobId !== null) ? '적용됨' : '저장됨'}</p>}
      {state.code === 'budget_conflict' && <section aria-label="예산 충돌 비교" className="border-l-2 border-finance-amber bg-finance-amber-tint p-4">
        <p className="t-body-strong text-finance-ink">다른 창의 저장값과 내 편집안을 비교해 주세요.</p>
        <ul className="mt-2 space-y-1 t-caption text-finance-muted">
          {draft.rows.filter(row => {
            const saved = baselineByMajor.get(row.major)
            return saved && (row.amount.trim() !== String(saved.amount) || row.recommendationJobId !== saved.recommendationJobId)
          }).map(row => <li key={row.major}>{row.major} · 현재 화면의 저장값 {formatWon(baselineByMajor.get(row.major)!.amount)}원 / 내 초안 {row.amount || '입력 중'}원</li>)}
        </ul>
        <button className="mt-3 h-[30px] border border-finance-amber px-3 t-body-strong text-finance-ink" disabled={compareWaiting} onClick={() => { compareRequested.current = true; setCompareWaiting(true); router.refresh() }} type="button">
          {compareWaiting ? '최신 예산 불러오는 중…' : '최신 예산 불러와 비교'}
        </button>
      </section>}
      {state.error && <p className="t-body text-finance-red">{state.error}</p>}
      </fieldset>
    </form>
  )
}

'use client'

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { BudgetRecommendationSnapshot, CompletedBudgetRecommendation } from '@/features/budget-recommendations/types'
import { currentMonthInKorea, formatWon } from '@/lib/finance'

import { saveBudgetPlan, type BudgetActionState } from './actions'
import { AiEvidencePopover, AiSummaryPopover } from './ai-evidence'
import { AiRequestDialog } from './ai-request-dialog'
import { CeilingBar } from './ceiling-bar'
import { budgetDraftReducer, createBudgetDraft, draftBudgetAmounts, draftBudgetChanges } from './draft'
import { spendingCeilingForTarget } from './plan-calculations'
import { PlanList } from './plan-list'
import type { BudgetPlanRow } from './plan-sources'
import { budgetRecommendationToolbarModel, PlanToolbar } from './plan-toolbar'
import type { BudgetBaseline, BudgetSaveRequest } from './save-contract'
import { usePlanRecommendations } from './use-plan-recommendations'

type BudgetFormProps = {
  baselines: BudgetBaseline[]
  month: string
  planRows: BudgetPlanRow[]
  savingsTarget: number
  targetVersion: string
  spendCeiling: number
  basis: BudgetRecommendationSnapshot['basis']
  savedRecommendations: CompletedBudgetRecommendation[]
}

const initialState: BudgetActionState = {}

export function BudgetForm(props: BudgetFormProps) {
  return <BudgetEditor key={props.month} {...props} />
}

function BudgetEditor({ baselines, month, planRows, savingsTarget, targetVersion, spendCeiling, basis, savedRecommendations }: BudgetFormProps) {
  const router = useRouter()
  const [draft, dispatch] = useReducer(budgetDraftReducer, undefined, () => createBudgetDraft(baselines, planRows))
  const [targetBaseline, setTargetBaseline] = useState({ savingsTarget, targetVersion })
  const [target, setTarget] = useState(savingsTarget)
  const targetBaselineRef = useRef(targetBaseline)
  const targetRef = useRef(target)
  const [acknowledgeOverage, setAcknowledgeOverage] = useState(false)
  const compareRequested = useRef(false)
  const [compareWaiting, setCompareWaiting] = useState(false)
  const [state, setState] = useState<BudgetActionState>(initialState)
  const [pending, setPending] = useState(false)
  const [summaryPromptJobId, setSummaryPromptJobId] = useState<string | null>(null)
  const saveRequest = useRef<symbol | null>(null)
  useEffect(() => () => { saveRequest.current = null }, [])

  const parsedDraftAmounts = useMemo(() => {
    try { return draftBudgetAmounts(draft) } catch { return null }
  }, [draft])
  const totalBudget = parsedDraftAmounts?.reduce((sum, row) => sum + row.amount, 0) ?? null
  const targetSpendCeiling = spendingCeilingForTarget({
    averageIncome: basis.averageIncome,
    initialSavingsTarget: savingsTarget,
    savingsTarget: target,
    serverSpendCeiling: spendCeiling,
  })
  const allocationGap = totalBudget === null ? null : targetSpendCeiling - totalBudget
  let changes: BudgetSaveRequest['changes'] = []
  let invalidDraft = false
  try { changes = draftBudgetChanges(draft) } catch { invalidDraft = true }
  const payload: BudgetSaveRequest = {
    month,
    changes,
    targetChange: target === targetBaseline.savingsTarget ? null : { value: target, expectedVersion: targetBaseline.targetVersion },
    acknowledgeOverage,
  }
  const isDirty = invalidDraft || payload.targetChange !== null || changes.length > 0
  targetRef.current = target
  targetBaselineRef.current = targetBaseline

  const recommendation = usePlanRecommendations({
    month,
    rows: planRows,
    savedRecommendations,
    basis,
    targetDirty: payload.targetChange !== null,
    draft,
    dispatch,
    onDraftChange: () => setAcknowledgeOverage(false),
  })

  useEffect(() => {
    if (!compareRequested.current) return
    compareRequested.current = false
    dispatch({ type: 'rebase', rows: baselines })
    if (targetRef.current === targetBaselineRef.current.savingsTarget) setTarget(savingsTarget)
    setTargetBaseline({ savingsTarget, targetVersion })
    setAcknowledgeOverage(false)
    setCompareWaiting(false)
  }, [baselines, savingsTarget, targetVersion])

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveRequest.current || recommendation.applyBusy || compareWaiting || invalidDraft || !isDirty) return
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
      if (saveRequest.current === request) {
        saveRequest.current = null
        setPending(false)
      }
    }
  }

  const toolbar = budgetRecommendationToolbarModel({
    data: recommendation.controller.data,
    basis,
    targetDirty: payload.targetChange !== null,
    recovering: recommendation.controller.recovering,
    submitting: recommendation.controller.submitting,
    networkError: recommendation.controller.networkError,
    hasAmbiguousRequest: recommendation.controller.hasAmbiguousRequest,
  })
  const period = month < currentMonthInKorea() ? 'past' : month > currentMonthInKorea() ? 'future' : 'current'
  const evidence = Object.fromEntries(Object.entries(recommendation.currentEvidence).map(([major, context]) => [major,
    <AiEvidencePopover context={context} key={context.jobId} onApplyChecked={recommendation.applyAiChoice} onClose={recommendation.clearApplyError} />,
  ]))
  const savedEvidence = Object.fromEntries(Object.entries(recommendation.savedEvidence).map(([major, context]) => [major,
    <AiEvidencePopover context={context} key={context.jobId} onApplyChecked={recommendation.applyAiChoice} onClose={recommendation.clearApplyError} trigger="근거" />,
  ]))
  const summary = recommendation.currentCompleted ? <AiSummaryPopover
    completed={recommendation.currentCompleted}
    onClose={() => {
      recommendation.controller.clearPrompt()
      setSummaryPromptJobId(null)
    }}
    onShowPrompt={jobId => {
      recommendation.controller.clearPrompt()
      setSummaryPromptJobId(jobId)
      void recommendation.controller.loadPrompt(jobId)
    }}
    promptError={summaryPromptJobId === recommendation.currentCompleted.id ? recommendation.controller.promptError : null}
    promptLoading={summaryPromptJobId === recommendation.currentCompleted.id && recommendation.controller.promptLoading}
    promptView={summaryPromptJobId === recommendation.currentCompleted.id ? recommendation.controller.promptView : null}
  /> : undefined

  return <>
    <form aria-label="예산 편집기" className="mt-6 min-w-0 space-y-6" onSubmit={submitBudget}>
      <input name="payload" type="hidden" value={JSON.stringify(payload)} />
      <input name="month" type="hidden" value={month} />
      <fieldset className="min-w-0 space-y-4 border-0 p-0" disabled={pending || recommendation.applyBusy}>
        <CeilingBar
          basis={basis}
          ceiling={targetSpendCeiling}
          dirty={isDirty}
          disabled={invalidDraft || compareWaiting || recommendation.applyBusy}
          onTargetChange={value => { setTarget(value); setAcknowledgeOverage(false) }}
          pending={pending}
          target={target}
          total={totalBudget}
        />
        <PlanToolbar
          aiActions={[
            ...(toolbar.showRecover ? [{ label: '상태 다시 확인', onClick: () => void recommendation.controller.recover() }] : []),
            { label: toolbar.requestLabel, disabled: toolbar.requestDisabled, onClick: recommendation.openRequest },
          ]}
          aiFillDisabled={toolbar.aiFillDisabled || recommendation.controller.active || recommendation.applyBusy}
          aiInstructionsChanged={toolbar.instructionsChanged}
          aiPopover={toolbar.showSummary ? summary : undefined}
          aiStatus={toolbar.status}
          fillDisabled={{
            previousBudget: !planRows.some(row => row.previousBudget > 0),
            previousActual: !planRows.some(row => row.previousActual.amount > 0),
            average3: !planRows.some(row => row.average3.amount > 0),
            ai: toolbar.aiFillDisabled || recommendation.controller.active || recommendation.applyBusy,
          }}
          onFillRequest={source => void recommendation.requestFill(source)}
        />
        {recommendation.applyError && <p className="t-body text-finance-red" role="alert">{recommendation.applyError}</p>}
        <PlanList
          draft={draft}
          evidence={evidence}
          fillConfirmation={recommendation.fillConfirmation}
          fillNotice={recommendation.fillNotice}
          month={month}
          onCancelFill={recommendation.cancelFill}
          onChoose={recommendation.choose}
          onChooseAi={request => void recommendation.applyAiChoice(request)}
          onConfirmFillAll={() => void recommendation.confirmFill(false)}
          onEdit={recommendation.edit}
          onKeepEdited={() => void recommendation.confirmFill(true)}
          onOpenEvidence={() => {}}
          onUndo={recommendation.undo}
          period={period}
          recommendations={recommendation.recommendations}
          rows={planRows}
          savedEvidence={savedEvidence}
          savedRecommendations={recommendation.savedOrigins}
        />
        {((allocationGap !== null && allocationGap < 0) || state.code === 'overage_confirmation_required') && <label className="flex items-center gap-2 t-body text-finance-red">
          <input checked={acknowledgeOverage} onChange={event => setAcknowledgeOverage(event.target.checked)} type="checkbox" />
          미분류·정기 지출을 포함한 전체 예산의 상한 초과를 확인하고 저장합니다.
        </label>}
        {invalidDraft && <p className="t-body text-finance-red">원 단위의 0 이상 정수를 입력해 주세요.</p>}
        {state.saved && !isDirty && <p aria-live="polite" className="t-body text-finance-green">{state.saved.rows.some(row => row.recommendationJobId !== null) ? '적용됨' : '저장됨'}</p>}
        {state.code === 'budget_conflict' && <section aria-label="예산 충돌 비교" className="border-l-2 border-finance-amber bg-finance-amber-tint p-4">
          <p className="t-body-strong text-finance-ink">다른 창의 저장값과 내 편집안을 비교해 주세요.</p>
          <ul className="mt-2 space-y-1 t-caption text-finance-muted">{draft.rows.filter(row => {
            const saved = draft.baseline.find(item => item.major === row.major)
            return saved && (row.amount.trim() !== String(saved.amount) || row.recommendationJobId !== saved.recommendationJobId)
          }).map(row => <li key={row.major}>{row.major} · 현재 화면의 저장값 {formatWon(draft.baseline.find(item => item.major === row.major)!.amount)}원 / 내 초안 {row.amount || '입력 중'}원</li>)}</ul>
          <button className="mt-3 h-[30px] border border-finance-amber px-3 t-body-strong text-finance-ink" disabled={compareWaiting} onClick={() => { compareRequested.current = true; setCompareWaiting(true); router.refresh() }} type="button">
            {compareWaiting ? '최신 예산 불러오는 중…' : '최신 예산 불러와 비교'}
          </button>
        </section>}
        {state.error && <p className="t-body text-finance-red">{state.error}</p>}
      </fieldset>
    </form>
    <AiRequestDialog controller={recommendation.controller} onClose={recommendation.closeRequest} open={recommendation.requestOpen} />
  </>
}

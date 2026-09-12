'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'

import { checkRecommendationForApply } from '@/features/budget-recommendations/client'
import type {
  BudgetRecommendationData,
  BudgetRecommendationSnapshot,
  CompletedBudgetRecommendation,
} from '@/features/budget-recommendations/types'
import { useBudgetRecommendation } from '@/features/budget-recommendations/use-recommendation'

import type { AiEvidenceContext } from './ai-evidence'
import {
  draftBudgetAmounts,
  type BudgetDraft,
  type BudgetDraftAction,
  type BudgetDraftChoice,
} from './draft'
import { overwrittenDraftRows } from './plan-fill'
import type { PlanFillConfirmation, PlanFillNotice } from './plan-list'
import type { PlanRecommendation } from './plan-item'
import type { BudgetPlanRow, BudgetSource } from './plan-sources'

type ApplyGuard = {
  requestedJobId: string
  data: BudgetRecommendationData | null
  targetDirty: boolean
}

export function verifiedRecommendationChoices(
  verified: CompletedBudgetRecommendation,
  majors: string[],
  guard: ApplyGuard,
): BudgetDraftChoice[] {
  if (guard.targetDirty || guard.data?.latestJob?.status === 'queued' || guard.data?.latestJob?.status === 'running'
    || guard.data?.completed?.id !== guard.requestedJobId) throw new Error('recommendation_unavailable')
  if (guard.data.freshness === 'source_changed') throw new Error('source_changed')
  if (guard.data.freshness === 'budgets_changed') throw new Error('budgets_changed')
  if (verified.id !== guard.requestedJobId) throw new Error('invalid_result')
  const verifiedByMajor = new Map(verified.report.rows.map(row => [row.major, row]))
  return majors.flatMap(major => {
    const row = verifiedByMajor.get(major)
    return row && row.amount > 0
      ? [{ major, amount: row.amount, source: 'ai' as const, recommendationJobId: verified.id }]
      : []
  })
}

export function initialRecommendationSourceChoices(
  draft: BudgetDraft,
  completed: CompletedBudgetRecommendation,
  interacted: ReadonlySet<string>,
): BudgetDraftChoice[] {
  const recommendationByMajor = new Map(completed.report.rows.map(row => [row.major, row.amount]))
  return draft.rows.flatMap(row => {
    const amount = recommendationByMajor.get(row.major)
    if (interacted.has(row.major) || row.recommendationJobId !== completed.id
      || amount === undefined || row.amount.trim() !== String(amount)) return []
    return [{ major: row.major, amount, source: 'ai' as const, recommendationJobId: completed.id }]
  })
}

function applyErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'request_failed'
  if (code === 'source_changed') return '기록이 변경되어 재추천이 필요합니다.'
  if (code === 'budgets_changed') return '예산이 변경되어 재추천이 필요합니다.'
  if (code === 'invalid_result') return '추천 결과를 안전하게 확인하지 못했습니다.'
  if (code === 'recommendation_unavailable') return '추천 상태가 바뀌어 넣지 않았습니다. 현재 추천을 다시 확인해 주세요.'
  return '추천 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function usePlanRecommendations({
  month,
  rows,
  savedRecommendations,
  basis,
  targetDirty,
  draft,
  dispatch,
  onDraftChange,
}: {
  month: string
  rows: BudgetPlanRow[]
  savedRecommendations: CompletedBudgetRecommendation[]
  basis: BudgetRecommendationSnapshot['basis']
  targetDirty: boolean
  draft: BudgetDraft
  dispatch: Dispatch<BudgetDraftAction>
  onDraftChange: () => void
}) {
  const draftRef = useRef(draft)
  const dataRef = useRef<BudgetRecommendationData | null>(null)
  const targetDirtyRef = useRef(targetDirty)
  const interacted = useRef(new Set<string>())
  const initialDataSeen = useRef(false)
  const applyRequest = useRef<AbortController | null>(null)
  const recommendationContexts = useRef(new Map<string, CompletedBudgetRecommendation>())
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [fillConfirmation, setFillConfirmation] = useState<PlanFillConfirmation | null>(null)
  const [fillNotice, setFillNotice] = useState<PlanFillNotice | null>(null)
  draftRef.current = draft
  targetDirtyRef.current = targetDirty

  const onData = useCallback((next: BudgetRecommendationData) => {
    if (!initialDataSeen.current) {
      initialDataSeen.current = true
      if (next.completed) {
        for (const choice of initialRecommendationSourceChoices(draftRef.current, next.completed, interacted.current)) {
          dispatch({ type: 'choose', ...choice })
        }
      }
    }
    setApplyError(null)
  }, [dispatch])

  const getDraftAmounts = useCallback(() => draftBudgetAmounts(draftRef.current), [])
  const controller = useBudgetRecommendation({
    month,
    majors: rows.map(row => row.major),
    basis,
    targetDirty,
    getDraftAmounts,
    onData,
  })
  dataRef.current = controller.data

  useEffect(() => () => applyRequest.current?.abort(), [])

  const currentCompleted = controller.data?.completed ?? null
  const referencedIds = new Set([
    ...draft.rows.map(row => row.recommendationJobId),
    ...(draft.undoRows?.map(row => row.recommendationJobId) ?? []),
    currentCompleted?.id ?? null,
  ].filter((id): id is string => id !== null))
  for (const saved of savedRecommendations) {
    if (referencedIds.has(saved.id)) recommendationContexts.current.set(saved.id, saved)
  }
  if (currentCompleted) recommendationContexts.current.set(currentCompleted.id, currentCompleted)
  for (const id of recommendationContexts.current.keys()) {
    if (!referencedIds.has(id)) recommendationContexts.current.delete(id)
  }

  async function checkedChoices(jobId: string, majors: string[]) {
    if (applyRequest.current) return null
    const request = new AbortController()
    applyRequest.current = request
    setApplyBusy(true)
    setApplyError(null)
    try {
      const verified = await checkRecommendationForApply(month, jobId, request.signal)
      if (applyRequest.current !== request || request.signal.aborted) return null
      const choices = verifiedRecommendationChoices(verified, majors, {
        requestedJobId: jobId,
        data: dataRef.current,
        targetDirty: targetDirtyRef.current,
      })
      if (choices.length === 0) throw new Error('invalid_result')
      return choices
    } catch (error) {
      if (applyRequest.current === request && !request.signal.aborted) setApplyError(applyErrorMessage(error))
      return null
    } finally {
      if (applyRequest.current === request) {
        applyRequest.current = null
        setApplyBusy(false)
      }
    }
  }

  function applyFill(source: BudgetSource, choices: BudgetDraftChoice[]) {
    choices.forEach(choice => interacted.current.add(choice.major))
    dispatch({ type: 'fill', choices })
    setFillConfirmation(null)
    setFillNotice({ source, count: choices.length })
    onDraftChange()
  }

  function prepareFill(source: BudgetSource, choices: BudgetDraftChoice[]) {
    const overwritten = overwrittenDraftRows(draftRef.current, choices)
    if (overwritten.length > 0) setFillConfirmation({ source, choices, overwritten })
    else applyFill(source, choices)
  }

  function historicalChoices(source: Exclude<BudgetSource, 'ai'>) {
    return rows.flatMap(row => {
      const amount = source === 'previousBudget' ? row.previousBudget
        : source === 'previousActual' ? row.previousActual.amount : row.average3.amount
      return amount > 0 ? [{ major: row.major, amount, source, recommendationJobId: null }] : []
    })
  }

  async function requestFill(source: BudgetSource) {
    setApplyError(null)
    if (source !== 'ai') return prepareFill(source, historicalChoices(source))
    if (!currentCompleted) return
    const choices = await checkedChoices(currentCompleted.id, rows.map(row => row.major))
    if (choices) prepareFill('ai', choices)
  }

  async function applyAiChoice({ major, jobId }: { major: string; jobId: string }) {
    const choices = await checkedChoices(jobId, [major])
    const choice = choices?.[0]
    if (!choice) return
    interacted.current.add(major)
    dispatch({ type: 'choose', ...choice })
    onDraftChange()
  }

  async function confirmFill(keepEdited: boolean) {
    const confirmation = fillConfirmation
    if (!confirmation) return
    let choices = confirmation.choices
    if (confirmation.source === 'ai') {
      const jobId = choices[0]?.recommendationJobId
      if (!jobId) return
      const verified = await checkedChoices(jobId, choices.map(choice => choice.major))
      if (!verified) {
        setFillConfirmation(null)
        return
      }
      choices = verified
    }
    if (keepEdited) {
      const excluded = new Set(confirmation.overwritten.map(row => row.major))
      choices = choices.filter(choice => !excluded.has(choice.major))
    }
    applyFill(confirmation.source, choices)
  }

  const recommendations = useMemo(() => Object.fromEntries((currentCompleted?.report.rows ?? []).map(row => [row.major, {
    jobId: currentCompleted!.id,
    amount: row.amount,
    completedAt: currentCompleted!.completedAt,
    reason: row.reason,
    stale: controller.data?.freshness === 'source_changed' || controller.data?.freshness === 'budgets_changed',
  } satisfies PlanRecommendation])), [controller.data?.freshness, currentCompleted])

  function evidenceContext(completed: CompletedBudgetRecommendation | undefined, major: string): AiEvidenceContext | undefined {
    const recommendation = completed?.report.rows.find(row => row.major === major)
    return completed && recommendation ? {
      jobId: completed.id,
      completedAt: completed.completedAt,
      recommendation,
      snapshot: completed.snapshot,
      promptInput: completed.promptInput,
    } : undefined
  }

  const savedOrigins = Object.fromEntries(draft.rows.flatMap(row => {
    const completed = row.recommendationJobId ? recommendationContexts.current.get(row.recommendationJobId) : undefined
    const recommendation = completed?.report.rows.find(item => item.major === row.major)
    return completed && recommendation ? [[row.major, {
      jobId: completed.id, amount: recommendation.amount, completedAt: completed.completedAt,
    }]] : []
  }))
  const currentEvidence = Object.fromEntries(rows.flatMap(row => {
    const context = evidenceContext(currentCompleted ?? undefined, row.major)
    return context ? [[row.major, context]] : []
  }))
  const savedEvidence = Object.fromEntries(draft.rows.flatMap(row => {
    const completed = row.recommendationJobId ? recommendationContexts.current.get(row.recommendationJobId) : undefined
    const context = evidenceContext(completed, row.major)
    return context && completed?.id !== currentCompleted?.id ? [[row.major, context]] : []
  }))

  return {
    controller,
    currentCompleted,
    recommendations,
    savedOrigins,
    currentEvidence,
    savedEvidence,
    applyBusy,
    applyError,
    requestOpen,
    fillConfirmation,
    fillNotice,
    choose(choice: BudgetDraftChoice) {
      interacted.current.add(choice.major)
      dispatch({ type: 'choose', ...choice })
      onDraftChange()
    },
    edit(major: string, amount: string) {
      interacted.current.add(major)
      dispatch({ type: 'edit', major, amount })
      onDraftChange()
    },
    applyAiChoice,
    requestFill,
    confirmFill,
    cancelFill: () => setFillConfirmation(null),
    undo() {
      dispatch({ type: 'undo' })
      setFillNotice(null)
      onDraftChange()
    },
    openRequest() {
      controller.clearPrompt()
      setRequestOpen(true)
    },
    closeRequest: () => setRequestOpen(false),
    clearApplyError: () => setApplyError(null),
  }
}

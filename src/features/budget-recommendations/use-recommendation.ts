'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadAiJobPrompt } from '@/features/ai-settings/client'
import type { AiJobPromptView } from '@/features/ai-settings/types'

import {
  getBudgetRecommendations,
  pollBudgetRecommendations,
  startBudgetRecommendation,
} from './client'
import type {
  BudgetInput,
  BudgetRecommendationData,
  BudgetRecommendationSnapshot,
  BudgetRequest,
} from './types'

export const MAX_PLANNED_EXPENSES = 30
export const MAX_RECOMMENDATION_NOTES = 4_000
export const MAX_PLANNED_EXPENSE_NOTE = 200

export type PlannedExpenseDraft = {
  id: string
  major: string
  amount: string
  note: string
}

export type PlannedExpenseComposer = Omit<PlannedExpenseDraft, 'id'>

export type BudgetRecommendationRequestError = {
  code: string
  message: string
  ambiguous: boolean
}

const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  request_timeout: '요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.',
  request_failed: '요청 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  invalid_input: '입력한 예정 지출과 예산 금액을 확인해 주세요.',
  unauthorized: '로그인이 필요합니다. 다시 로그인해 주세요.',
  forbidden: '이 가계부의 AI 예산 추천을 사용할 권한이 없습니다.',
  body_too_large: '입력 내용이 너무 큽니다. 참고 메모나 예정 지출을 줄여 주세요.',
  active_job_exists: '이미 진행 중인 추천 요청이 있어요. 상태를 다시 확인해 주세요.',
  request_conflict: '같은 요청 ID의 입력이 달라 다시 보낼 수 없어요. 상태를 확인한 뒤 새로 추천해 주세요.',
  past_or_distant_month: 'AI 예산 추천은 이번 달과 다음 달에서만 사용할 수 있어요.',
  missing_income: '기준 수입이 있어야 AI 예산 추천을 시작할 수 있어요.',
  setup_required: 'AI 작업기 설정을 확인한 뒤 다시 시도해 주세요.',
  source_changed: '기록이 변경되어 재추천이 필요합니다.',
  budgets_changed: '예산이 변경되어 재추천이 필요합니다.',
  invalid_result: '추천 결과를 안전하게 확인하지 못했어요.',
}

export const BUDGET_RECOMMENDATION_JOB_ERROR_MESSAGES: Record<string, string> = {
  timeout: '추천 시간이 길어져 중단됐어요.',
  invalid_output: '추천 결과를 완성하지 못했어요.',
  cli_failed: 'Mac에서 추천을 마치지 못했어요.',
  worker_stopped: 'Mac에서 추천 작업이 중단됐어요.',
  lease_expired: 'Mac 연결이 끊겨 추천 작업이 중단됐어요.',
}

function exactWon(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) ? amount : null
}

function isActive(data: BudgetRecommendationData | null): boolean {
  return data?.latestJob?.status === 'queued' || data?.latestJob?.status === 'running'
}

export function classifyBudgetRecommendationRequestError(error: unknown): BudgetRecommendationRequestError {
  const code = error instanceof Error ? error.message : 'request_failed'
  const safeCode = Object.hasOwn(REQUEST_ERROR_MESSAGES, code) ? code : 'request_failed'
  return {
    code: safeCode,
    message: REQUEST_ERROR_MESSAGES[safeCode],
    ambiguous: safeCode === 'request_failed' || safeCode === 'request_timeout',
  }
}

export function createFrozenBudgetRecommendationRequest(
  input: BudgetInput,
  requestId = crypto.randomUUID(),
): BudgetRequest {
  const plannedExpenses = input.plannedExpenses.map(row => Object.freeze({ ...row }))
  const draftAmounts = input.draftAmounts.map(row => Object.freeze({ ...row }))
  Object.freeze(plannedExpenses)
  Object.freeze(draftAmounts)
  return Object.freeze({
    requestId,
    month: input.month,
    notes: input.notes,
    plannedExpenses,
    draftAmounts,
  })
}

export function retryRequestAfterError(
  request: BudgetRequest,
  error: BudgetRecommendationRequestError,
): BudgetRequest | null {
  return error.ambiguous ? request : null
}

export function reconcileBudgetRecommendationData(
  previous: BudgetRecommendationData | null,
  next: BudgetRecommendationData,
  pendingRequestId: string | null,
): { data: BudgetRecommendationData; pendingRequestId: string | null } {
  const accepted = next.latestJob && !next.completed && previous?.completed
    ? { ...next, completed: previous.completed }
    : next
  const acknowledged = pendingRequestId !== null && (
    accepted.latestJob?.requestId === pendingRequestId
    || accepted.completed?.requestId === pendingRequestId
  )
  return { data: accepted, pendingRequestId: acknowledged ? null : pendingRequestId }
}

export function ownsBudgetRecommendationRequest(
  currentController: AbortController | null,
  ownerController: AbortController,
  ownerMonth: string,
  currentMonth: string,
): boolean {
  return currentController === ownerController
    && !ownerController.signal.aborted
    && ownerMonth === currentMonth
}

export type BudgetRecommendationController = {
  month: string
  majors: string[]
  basis: BudgetRecommendationSnapshot['basis']
  data: BudgetRecommendationData | null
  recovering: boolean
  submitting: boolean
  active: boolean
  networkError: string | null
  hasAmbiguousRequest: boolean
  notes: string
  setNotes: (value: string) => void
  planned: PlannedExpenseDraft[]
  composer: PlannedExpenseComposer
  setComposer: (value: PlannedExpenseComposer) => void
  plannedError: string | null
  inputError: string | null
  addPlannedExpense: () => void
  updatePlannedExpense: (id: string, patch: Partial<Omit<PlannedExpenseDraft, 'id'>>) => void
  removePlannedExpense: (id: string) => void
  generate: () => Promise<boolean>
  recover: () => Promise<void>
  promptJobId: string | null
  promptView: AiJobPromptView | null
  promptLoading: boolean
  promptError: string | null
  loadPrompt: (jobId?: string) => Promise<void>
  clearPrompt: () => void
}

export function useBudgetRecommendation({
  month,
  majors,
  basis,
  targetDirty,
  getDraftAmounts,
  onData,
}: {
  month: string
  majors: string[]
  basis: BudgetRecommendationSnapshot['basis']
  targetDirty: boolean
  getDraftAmounts: () => BudgetInput['draftAmounts']
  onData?: (data: BudgetRecommendationData) => void | Promise<void>
}): BudgetRecommendationController {
  const [data, setData] = useState<BudgetRecommendationData | null>(null)
  const [recovering, setRecovering] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [hasAmbiguousRequest, setHasAmbiguousRequest] = useState(false)
  const [notes, setNotesState] = useState('')
  const [planned, setPlanned] = useState<PlannedExpenseDraft[]>([])
  const [composer, setComposerState] = useState<PlannedExpenseComposer>(() => ({
    major: majors[0] ?? '', amount: '', note: '',
  }))
  const [plannedError, setPlannedError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [promptView, setPromptView] = useState<AiJobPromptView | null>(null)
  const [promptLoading, setPromptLoading] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  const dataRef = useRef<BudgetRecommendationData | null>(null)
  const onDataRef = useRef(onData)
  const getDraftAmountsRef = useRef(getDraftAmounts)
  const majorsRef = useRef(majors)
  const monthRef = useRef(month)
  const manualRequestRef = useRef<AbortController | null>(null)
  const submissionRequestRef = useRef<AbortController | null>(null)
  const pollRequestRef = useRef<AbortController | null>(null)
  const promptRequestRef = useRef<{ controller: AbortController; key: string } | null>(null)
  const pendingRequestRef = useRef<BudgetRequest | null>(null)
  onDataRef.current = onData
  getDraftAmountsRef.current = getDraftAmounts
  majorsRef.current = majors
  monthRef.current = month

  const acceptData = useCallback((next: BudgetRecommendationData) => {
    if (next.month !== monthRef.current) return false
    const pendingRequestId = pendingRequestRef.current?.requestId ?? null
    const accepted = reconcileBudgetRecommendationData(dataRef.current, next, pendingRequestId)
    dataRef.current = accepted.data
    setData(accepted.data)
    setNetworkError(null)
    if (pendingRequestId !== null && accepted.pendingRequestId === null) {
      pendingRequestRef.current = null
      setHasAmbiguousRequest(false)
    }
    try {
      void Promise.resolve(onDataRef.current?.(accepted.data)).catch(() => {})
    } catch {
      // Consumer failures do not take ownership away from this request controller.
    }
    return pendingRequestId !== null && accepted.pendingRequestId === null
  }, [])

  const recover = useCallback(async () => {
    const displaced = manualRequestRef.current
    displaced?.abort()
    if (submissionRequestRef.current === displaced) {
      submissionRequestRef.current = null
      setSubmitting(false)
    }
    const controller = new AbortController()
    const ownedMonth = month
    manualRequestRef.current = controller
    setRecovering(true)
    setNetworkError(null)
    try {
      const next = await getBudgetRecommendations(ownedMonth, controller.signal, pendingRequestRef.current?.requestId)
      if (!ownsBudgetRecommendationRequest(manualRequestRef.current, controller, ownedMonth, monthRef.current)) return
      acceptData(next)
    } catch (error) {
      if (!ownsBudgetRecommendationRequest(manualRequestRef.current, controller, ownedMonth, monthRef.current)) return
      setNetworkError(classifyBudgetRecommendationRequestError(error).message)
    } finally {
      if (manualRequestRef.current === controller) {
        manualRequestRef.current = null
        setRecovering(false)
      }
    }
  }, [acceptData, month])

  useEffect(() => {
    manualRequestRef.current?.abort()
    pollRequestRef.current?.abort()
    promptRequestRef.current?.controller.abort()
    manualRequestRef.current = null
    submissionRequestRef.current = null
    pollRequestRef.current = null
    promptRequestRef.current = null
    dataRef.current = null
    pendingRequestRef.current = null
    setData(null)
    setRecovering(true)
    setSubmitting(false)
    setNetworkError(null)
    setHasAmbiguousRequest(false)
    setNotesState('')
    setPlanned([])
    setComposerState({ major: majorsRef.current[0] ?? '', amount: '', note: '' })
    setPlannedError(null)
    setInputError(null)
    setPromptView(null)
    setPromptLoading(false)
    setPromptError(null)
    void recover()
    return () => {
      manualRequestRef.current?.abort()
      pollRequestRef.current?.abort()
      promptRequestRef.current?.controller.abort()
      manualRequestRef.current = null
      submissionRequestRef.current = null
      pollRequestRef.current = null
      promptRequestRef.current = null
    }
  }, [month, recover])

  const active = data?.month === month && isActive(data)
  const activeJobId = active ? data?.latestJob?.id ?? null : null

  useEffect(() => {
    if (!active || !activeJobId) return
    pollRequestRef.current?.abort()
    const controller = new AbortController()
    const ownedMonth = month
    pollRequestRef.current = controller
    void pollBudgetRecommendations(ownedMonth, {
      signal: controller.signal,
      onData: next => {
        if (!ownsBudgetRecommendationRequest(pollRequestRef.current, controller, ownedMonth, monthRef.current)) return
        acceptData(next)
      },
      onError: code => {
        if (!ownsBudgetRecommendationRequest(pollRequestRef.current, controller, ownedMonth, monthRef.current)) return
        setNetworkError(REQUEST_ERROR_MESSAGES[code] ?? REQUEST_ERROR_MESSAGES.request_failed)
      },
    })
    return () => {
      controller.abort()
      if (pollRequestRef.current === controller) pollRequestRef.current = null
    }
  }, [acceptData, active, activeJobId, month])

  const promptJobId = data?.latestJob?.id ?? data?.completed?.id ?? null

  useEffect(() => {
    promptRequestRef.current?.controller.abort()
    promptRequestRef.current = null
    setPromptView(null)
    setPromptError(null)
    setPromptLoading(false)
  }, [month, promptJobId])

  function setNotes(value: string) {
    setNotesState(value)
    setInputError(null)
  }

  function setComposer(value: PlannedExpenseComposer) {
    setComposerState(value)
    setPlannedError(null)
  }

  function addPlannedExpense() {
    if (planned.length >= MAX_PLANNED_EXPENSES || majors.length === 0) return
    const major = majors.includes(composer.major) ? composer.major : majors[0]
    const amount = exactWon(composer.amount)
    if (amount === null) {
      setPlannedError('원 단위의 0 이상 정수를 입력해 주세요.')
      return
    }
    if (composer.note.length > MAX_PLANNED_EXPENSE_NOTE) {
      setPlannedError('예정 지출 메모는 200자 이하로 입력해 주세요.')
      return
    }
    setPlanned(current => [...current, {
      id: crypto.randomUUID(), major, amount: String(amount), note: composer.note,
    }])
    setComposerState({ major, amount: '', note: '' })
    setPlannedError(null)
    setInputError(null)
  }

  function updatePlannedExpense(id: string, patch: Partial<Omit<PlannedExpenseDraft, 'id'>>) {
    setPlanned(current => current.map(row => row.id === id ? { ...row, ...patch } : row))
    setInputError(null)
  }

  function removePlannedExpense(id: string) {
    setPlanned(current => current.filter(row => row.id !== id))
    setInputError(null)
  }

  function prepareRequest(): BudgetRequest | null {
    if (notes.length > MAX_RECOMMENDATION_NOTES || planned.length > MAX_PLANNED_EXPENSES) {
      setInputError('입력한 참고 내용을 확인해 주세요.')
      return null
    }
    const activeMajors = new Set(majors)
    const plannedExpenses: BudgetInput['plannedExpenses'] = []
    for (const row of planned) {
      const amount = exactWon(row.amount)
      if (amount === null || !activeMajors.has(row.major) || row.note.length > MAX_PLANNED_EXPENSE_NOTE) {
        setInputError('예정 지출의 카테고리와 금액을 확인해 주세요.')
        return null
      }
      plannedExpenses.push({ id: row.id, major: row.major, amount, note: row.note })
    }
    let draftAmounts: BudgetInput['draftAmounts']
    try {
      draftAmounts = getDraftAmountsRef.current().map(row => ({ ...row }))
    } catch {
      setInputError('예산 금액에 원 단위의 0 이상 정수를 입력해 주세요.')
      return null
    }
    if (draftAmounts.some(row => !activeMajors.has(row.major)
      || !Number.isSafeInteger(row.amount) || row.amount < 0)) {
      setInputError('예산 금액에 원 단위의 0 이상 정수를 입력해 주세요.')
      return null
    }
    setInputError(null)
    return createFrozenBudgetRecommendationRequest({
      month,
      notes,
      plannedExpenses,
      draftAmounts,
    })
  }

  async function generate(): Promise<boolean> {
    if (submitting || active || targetDirty || basis.averageIncome <= 0
      || !data || data.availability !== 'available'
      || data.worker === 'not_registered' || data.worker === 'upgrade_required') return false
    const request = pendingRequestRef.current ?? prepareRequest()
    if (!request) return false
    pendingRequestRef.current = request
    manualRequestRef.current?.abort()
    const controller = new AbortController()
    const ownedMonth = month
    manualRequestRef.current = controller
    submissionRequestRef.current = controller
    setSubmitting(true)
    setNetworkError(null)
    try {
      const next = await startBudgetRecommendation(request, controller.signal)
      if (!ownsBudgetRecommendationRequest(manualRequestRef.current, controller, ownedMonth, monthRef.current)) return false
      const acknowledged = acceptData(next)
      if (!acknowledged) {
        setHasAmbiguousRequest(true)
        setNetworkError(REQUEST_ERROR_MESSAGES.request_failed)
      }
      return acknowledged
    } catch (error) {
      if (!ownsBudgetRecommendationRequest(manualRequestRef.current, controller, ownedMonth, monthRef.current)) return false
      const safe = classifyBudgetRecommendationRequestError(error)
      setNetworkError(safe.message)
      pendingRequestRef.current = retryRequestAfterError(request, safe)
      setHasAmbiguousRequest(safe.ambiguous)
      if (!safe.ambiguous) return false
      try {
        const recovered = await getBudgetRecommendations(ownedMonth, controller.signal, request.requestId)
        if (!ownsBudgetRecommendationRequest(manualRequestRef.current, controller, ownedMonth, monthRef.current)) return false
        const acknowledged = acceptData(recovered)
        if (!acknowledged) setNetworkError(safe.message)
        return acknowledged
      } catch {
        return false
      }
    } finally {
      if (submissionRequestRef.current === controller) {
        submissionRequestRef.current = null
        setSubmitting(false)
      }
      if (manualRequestRef.current === controller) manualRequestRef.current = null
    }
  }

  async function loadPrompt(jobId = promptJobId ?? '') {
    if (!jobId) return
    promptRequestRef.current?.controller.abort()
    const controller = new AbortController()
    const key = `${month}:budget:${jobId}`
    promptRequestRef.current = { controller, key }
    setPromptLoading(true)
    setPromptError(null)
    try {
      const next = await loadAiJobPrompt('budget', jobId, controller.signal)
      if (promptRequestRef.current?.key !== key || controller.signal.aborted || monthRef.current !== month) return
      setPromptView(next)
    } catch {
      if (promptRequestRef.current?.key !== key || controller.signal.aborted || monthRef.current !== month) return
      setPromptError('이 작업에 사용한 프롬프트를 불러오지 못했습니다.')
    } finally {
      if (promptRequestRef.current?.key === key) setPromptLoading(false)
    }
  }

  function clearPrompt() {
    promptRequestRef.current?.controller.abort()
    promptRequestRef.current = null
    setPromptView(null)
    setPromptLoading(false)
    setPromptError(null)
  }

  return {
    month,
    majors,
    basis,
    data,
    recovering,
    submitting,
    active,
    networkError,
    hasAmbiguousRequest,
    notes,
    setNotes,
    planned,
    composer,
    setComposer,
    plannedError,
    inputError,
    addPlannedExpense,
    updatePlannedExpense,
    removePlannedExpense,
    generate,
    recover,
    promptJobId,
    promptView,
    promptLoading,
    promptError,
    loadPrompt,
    clearPrompt,
  }
}

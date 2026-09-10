'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadAiJobPrompt } from '@/features/ai-settings/client'
import { AiPromptViewer } from '@/features/ai-settings/prompt-viewer'
import type { AiJobPromptView } from '@/features/ai-settings/types'
import { formatWon } from '@/lib/finance'

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

const MAX_PLANNED_EXPENSES = 30

type PlannedExpenseDraft = {
  id: string
  major: string
  amount: string
  note: string
}

type PlannedExpenseComposer = Omit<PlannedExpenseDraft, 'id'>

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

const JOB_ERROR_MESSAGES: Record<string, string> = {
  timeout: '추천 시간이 길어져 중단됐어요.',
  invalid_output: '추천 결과를 완성하지 못했어요.',
  cli_failed: 'Mac에서 추천을 마치지 못했어요.',
  worker_stopped: 'Mac에서 추천 작업이 중단됐어요.',
  lease_expired: 'Mac 연결이 끊겨 추천 작업이 중단됐어요.',
}

function monthTitle(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`
}

function isActive(data: BudgetRecommendationData | null): boolean {
  return data?.latestJob?.status === 'queued' || data?.latestJob?.status === 'running'
}

function exactWon(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) ? amount : null
}

export function classifyBudgetRecommendationRequestError(error: unknown): {
  code: string
  message: string
  ambiguous: boolean
} {
  const code = error instanceof Error ? error.message : 'request_failed'
  const safeCode = Object.hasOwn(REQUEST_ERROR_MESSAGES, code) ? code : 'request_failed'
  return {
    code: safeCode,
    message: REQUEST_ERROR_MESSAGES[safeCode],
    ambiguous: safeCode === 'request_failed' || safeCode === 'request_timeout',
  }
}

function freezeRequest(request: BudgetRequest): BudgetRequest {
  request.plannedExpenses.forEach(Object.freeze)
  request.draftAmounts.forEach(Object.freeze)
  Object.freeze(request.plannedExpenses)
  Object.freeze(request.draftAmounts)
  return Object.freeze(request)
}

export function BudgetRecommendationPanel({
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
  onData: (data: BudgetRecommendationData) => void
}) {
  const [data, setData] = useState<BudgetRecommendationData | null>(null)
  const [recovering, setRecovering] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [hasAmbiguousRequest, setHasAmbiguousRequest] = useState(false)
  const [notes, setNotes] = useState('')
  const [planned, setPlanned] = useState<PlannedExpenseDraft[]>([])
  const [composer, setComposer] = useState<PlannedExpenseComposer>(() => ({
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
  const manualRequestRef = useRef<AbortController | null>(null)
  const pollRequestRef = useRef<AbortController | null>(null)
  const promptRequestRef = useRef<{ controller: AbortController; key: string } | null>(null)
  const pendingRequestRef = useRef<BudgetRequest | null>(null)
  onDataRef.current = onData
  getDraftAmountsRef.current = getDraftAmounts
  majorsRef.current = majors

  const acceptData = useCallback((next: BudgetRecommendationData) => {
    const previous = dataRef.current
    const accepted = next.latestJob && !next.completed && previous?.completed
      ? { ...next, completed: previous.completed }
      : next
    dataRef.current = accepted
    setData(accepted)
    setNetworkError(null)
    if (pendingRequestRef.current && (
      accepted.latestJob?.requestId === pendingRequestRef.current.requestId
      || accepted.completed?.requestId === pendingRequestRef.current.requestId
    )) {
      pendingRequestRef.current = null
      setHasAmbiguousRequest(false)
    }
    try {
      void Promise.resolve(onDataRef.current(accepted)).catch(() => {})
    } catch {
      // Parent callback failures must not interrupt request ownership or polling.
    }
  }, [])

  const recover = useCallback(async () => {
    manualRequestRef.current?.abort()
    const controller = new AbortController()
    manualRequestRef.current = controller
    setRecovering(true)
    setNetworkError(null)
    try {
      const next = await getBudgetRecommendations(month, controller.signal, pendingRequestRef.current?.requestId)
      if (manualRequestRef.current !== controller || controller.signal.aborted) return
      acceptData(next)
    } catch (error) {
      if (manualRequestRef.current !== controller || controller.signal.aborted) return
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
    pollRequestRef.current = null
    promptRequestRef.current = null
    dataRef.current = null
    pendingRequestRef.current = null
    setData(null)
    setRecovering(true)
    setSubmitting(false)
    setNotes('')
    setPlanned([])
    setComposer({ major: majorsRef.current[0] ?? '', amount: '', note: '' })
    setPlannedError(null)
    setInputError(null)
    setPromptView(null)
    setPromptError(null)
    setHasAmbiguousRequest(false)
    void recover()
    return () => {
      manualRequestRef.current?.abort()
      pollRequestRef.current?.abort()
      promptRequestRef.current?.controller.abort()
      manualRequestRef.current = null
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
    pollRequestRef.current = controller
    void pollBudgetRecommendations(month, {
      signal: controller.signal,
      onData: (next) => {
        if (pollRequestRef.current !== controller || controller.signal.aborted) return
        acceptData(next)
      },
      onError: (code) => {
        if (pollRequestRef.current !== controller || controller.signal.aborted) return
        setNetworkError(REQUEST_ERROR_MESSAGES[code] ?? REQUEST_ERROR_MESSAGES.request_failed)
      },
    })
    return () => {
      controller.abort()
      if (pollRequestRef.current === controller) pollRequestRef.current = null
    }
  }, [acceptData, active, activeJobId, month])

  const promptJobId = active ? activeJobId : data?.completed?.id ?? null
  useEffect(() => {
    promptRequestRef.current?.controller.abort()
    promptRequestRef.current = null
    setPromptView(null)
    setPromptError(null)
    setPromptLoading(false)
  }, [month, promptJobId])

  function addPlannedExpense() {
    if (planned.length >= MAX_PLANNED_EXPENSES || majors.length === 0) return
    const major = majors.includes(composer.major) ? composer.major : majors[0]
    const amount = exactWon(composer.amount)
    if (amount === null) {
      setPlannedError('원 단위의 0 이상 정수를 입력해 주세요.')
      return
    }
    if (composer.note.length > 200) {
      setPlannedError('예정 지출 메모는 200자 이하로 입력해 주세요.')
      return
    }
    setPlanned((current) => [...current, {
      id: crypto.randomUUID(), major, amount: String(amount), note: composer.note,
    }])
    setComposer({ major, amount: '', note: '' })
    setPlannedError(null)
    setInputError(null)
  }

  function updatePlanned(id: string, patch: Partial<Omit<PlannedExpenseDraft, 'id'>>) {
    setPlanned((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setInputError(null)
  }

  function removePlanned(id: string) {
    setPlanned((current) => current.filter((row) => row.id !== id))
    setInputError(null)
  }

  function prepareRequest(): BudgetRequest | null {
    if (notes.length > 4000 || planned.length > MAX_PLANNED_EXPENSES) {
      setInputError('입력한 참고 내용을 확인해 주세요.')
      return null
    }
    const activeMajors = new Set(majors)
    const plannedExpenses: BudgetInput['plannedExpenses'] = []
    for (const row of planned) {
      const amount = exactWon(row.amount)
      if (amount === null || !activeMajors.has(row.major) || row.note.length > 200) {
        setInputError('예정 지출의 카테고리와 금액을 확인해 주세요.')
        return null
      }
      plannedExpenses.push({ id: row.id, major: row.major, amount, note: row.note })
    }
    let draftAmounts: BudgetInput['draftAmounts']
    try {
      draftAmounts = getDraftAmountsRef.current().map((row) => ({ ...row }))
    } catch {
      setInputError('예산 금액에 원 단위의 0 이상 정수를 입력해 주세요.')
      return null
    }
    if (draftAmounts.some((row) => !activeMajors.has(row.major)
      || !Number.isSafeInteger(row.amount) || row.amount < 0)) {
      setInputError('예산 금액에 원 단위의 0 이상 정수를 입력해 주세요.')
      return null
    }
    setInputError(null)
    return freezeRequest({
      requestId: crypto.randomUUID(),
      month,
      notes,
      plannedExpenses,
      draftAmounts,
    })
  }

  async function generate() {
    if (submitting || active || targetDirty || basis.averageIncome <= 0
      || !data || data.availability !== 'available') return
    const request = pendingRequestRef.current ?? prepareRequest()
    if (!request) return
    pendingRequestRef.current = request
    manualRequestRef.current?.abort()
    const controller = new AbortController()
    manualRequestRef.current = controller
    setSubmitting(true)
    setNetworkError(null)
    try {
      const next = await startBudgetRecommendation(request, controller.signal)
      if (manualRequestRef.current !== controller || controller.signal.aborted) return
      pendingRequestRef.current = null
      setHasAmbiguousRequest(false)
      acceptData(next)
    } catch (error) {
      if (manualRequestRef.current !== controller || controller.signal.aborted) return
      const safe = classifyBudgetRecommendationRequestError(error)
      setNetworkError(safe.message)
      setHasAmbiguousRequest(safe.ambiguous)
      if (!safe.ambiguous) pendingRequestRef.current = null
      else {
        // A lost POST response does not imply the job was lost. Read the exact
        // original intent once; never acknowledge an unrelated latest job.
        try {
          const recovered = await getBudgetRecommendations(month, controller.signal, request.requestId)
          if (manualRequestRef.current !== controller || controller.signal.aborted) return
          acceptData(recovered)
          if (pendingRequestRef.current) setNetworkError(safe.message)
        } catch {
          // Keep the frozen request and explicit same-UUID retry if unconfirmed.
        }
      }
    } finally {
      if (manualRequestRef.current === controller) {
        manualRequestRef.current = null
        setSubmitting(false)
      }
    }
  }

  async function showPrompt() {
    if (!promptJobId) return
    promptRequestRef.current?.controller.abort()
    const controller = new AbortController()
    const key = `${month}:budget:${promptJobId}`
    promptRequestRef.current = { controller, key }
    setPromptLoading(true)
    setPromptError(null)
    try {
      const next = await loadAiJobPrompt('budget', promptJobId, controller.signal)
      if (promptRequestRef.current?.key !== key || controller.signal.aborted) return
      setPromptView(next)
    } catch {
      if (promptRequestRef.current?.key !== key || controller.signal.aborted) return
      setPromptError('이 작업에 사용한 프롬프트를 불러오지 못했습니다.')
    } finally {
      if (promptRequestRef.current?.key === key) setPromptLoading(false)
    }
  }

  const currentComposerMajor = majors.includes(composer.major) ? composer.major : majors[0] ?? ''
  const unavailable = targetDirty || basis.averageIncome <= 0 || !data
    || data.availability !== 'available'
  const busy = submitting || active
  const requestDisabled = unavailable || busy
  const requestLabel = submitting ? '추천 요청 중…'
    : active && data?.worker === 'offline' ? 'Mac 연결 대기'
      : data?.latestJob?.status === 'queued' ? '추천 대기 중'
        : data?.latestJob?.status === 'running' ? '추천 분석 중…'
          : hasAmbiguousRequest ? '같은 요청 다시 보내기'
            : data?.completed || data?.latestJob?.status === 'failed' ? '다시 추천하기'
              : 'AI 예산 추천'

  return (
    <section className="min-w-0 border-y border-finance-ink py-5 text-finance-ink" aria-labelledby={`budget-recommendation-title-${month}`}>
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="t-label uppercase text-finance-violet">AI BUDGET · {month}</p>
          <h2 className="mt-1 t-section" id={`budget-recommendation-title-${month}`}>{monthTitle(month)} AI 예산 추천</h2>
          <p className="mt-2 max-w-3xl t-caption text-finance-muted">
            저장된 기준과 현재 예산 편집안을 함께 보고 월 전체 예산을 제안합니다.{' '}
            <a className="font-semibold text-finance-violet underline underline-offset-4" href="/settings?section=ai">AI 진단 설정</a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {promptJobId && (
            <button
              className="min-h-9 border border-finance-hairline px-3 t-body-strong disabled:cursor-not-allowed disabled:opacity-60"
              disabled={promptLoading}
              onClick={() => void showPrompt()}
              type="button"
            >
              {promptLoading ? '프롬프트 확인 중…' : '사용한 프롬프트'}
            </button>
          )}
          <button
            className="min-h-9 bg-finance-ink px-4 t-body-strong text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={requestDisabled}
            onClick={() => void generate()}
            type="button"
          >
            {requestLabel}
          </button>
        </div>
      </header>

      <section className="mt-5 border-t border-finance-hairline pt-4" aria-labelledby={`budget-recommendation-basis-${month}`}>
        <h3 className="t-body-strong" id={`budget-recommendation-basis-${month}`}>저장된 추천 기준</h3>
        <dl className="mt-3 grid min-w-0 gap-px bg-finance-hairline sm:grid-cols-3">
          <div className="min-w-0 bg-background p-3"><dt className="t-caption text-finance-muted">월평균 수입</dt><dd className="mt-1 t-body-strong tabular-nums">{formatWon(basis.averageIncome)}원</dd></div>
          <div className="min-w-0 bg-background p-3"><dt className="t-caption text-finance-muted">목표 저축률</dt><dd className="mt-1 t-body-strong tabular-nums">목표 저축률 {basis.savingsTarget}%</dd></div>
          <div className="min-w-0 bg-background p-3"><dt className="t-caption text-finance-muted">지출 상한</dt><dd className="mt-1 t-body-strong tabular-nums">지출 상한 {formatWon(basis.spendCeiling)}원</dd></div>
        </dl>
        <p className="mt-2 t-caption text-finance-muted">수입 기준 {basis.incomeStart}~{basis.incomeEnd} · {basis.incomeMonthCount}개월</p>
      </section>

      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <label className="min-w-0 t-body-strong">
          추천에 전달할 참고 메모 <span className="font-normal text-finance-muted">(선택)</span>
          <textarea
            aria-label="추천에 전달할 참고 메모"
            className="mt-2 min-h-28 w-full resize-y border border-finance-hairline bg-background p-3 t-body text-finance-ink outline-none focus:border-finance-violet"
            maxLength={4000}
            onChange={(event) => { setNotes(event.target.value); setInputError(null) }}
            placeholder="이번 달에 중요한 계획이나 우선순위를 적어 주세요."
            value={notes}
          />
          <span className="mt-1 block text-right t-caption font-normal text-finance-muted">{notes.length.toLocaleString('ko-KR')} / 4,000자</span>
        </label>

        <section className="min-w-0" aria-labelledby={`planned-expenses-title-${month}`}>
          <h3 className="t-body-strong" id={`planned-expenses-title-${month}`}>예정 지출 <span className="font-normal text-finance-muted">(선택 · 최대 30개)</span></h3>
          <p className="mt-1 t-caption text-finance-muted">예정 지출은 이미 기록된 지출이나 반복 지출에 포함되지 않은 추가 금액입니다.</p>

          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(7rem,0.8fr)_minmax(8rem,0.8fr)_minmax(10rem,1.4fr)_auto]">
            <select
              aria-label="예정 지출 카테고리"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
              disabled={majors.length === 0 || planned.length >= MAX_PLANNED_EXPENSES}
              onChange={(event) => setComposer((current) => ({ ...current, major: event.target.value }))}
              value={currentComposerMajor}
            >
              {majors.length === 0 && <option value="">카테고리 없음</option>}
              {majors.map((major) => <option key={major} value={major}>{major}</option>)}
            </select>
            <input
              aria-label="예정 지출 금액"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 text-right t-body tabular-nums"
              inputMode="numeric"
              onChange={(event) => { setComposer((current) => ({ ...current, amount: event.target.value })); setPlannedError(null) }}
              placeholder="원"
              type="text"
              value={composer.amount}
            />
            <input
              aria-label="예정 지출 메모"
              className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body"
              maxLength={200}
              onChange={(event) => { setComposer((current) => ({ ...current, note: event.target.value })); setPlannedError(null) }}
              placeholder="예: 가족 생일 식사"
              type="text"
              value={composer.note}
            />
            <button
              className="min-h-10 border border-finance-ink px-3 t-body-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={majors.length === 0 || planned.length >= MAX_PLANNED_EXPENSES}
              onClick={addPlannedExpense}
              type="button"
            >예정 지출 추가</button>
          </div>
          {majors.length === 0 && <p className="mt-2 t-caption text-finance-amber">사용할 수 있는 카테고리가 없어 예정 지출을 추가할 수 없어요.</p>}
          {plannedError && <p className="mt-2 t-caption text-finance-red" role="alert">{plannedError}</p>}

          {planned.length > 0 && (
            <ul className="mt-3 space-y-2">
              {planned.map((row, index) => {
                const invalidAmount = exactWon(row.amount) === null
                return (
                  <li className="grid min-w-0 gap-2 border-t border-finance-hairline pt-2 sm:grid-cols-[minmax(7rem,0.8fr)_minmax(8rem,0.8fr)_minmax(10rem,1.4fr)_auto]" key={row.id}>
                    <select aria-label={`예정 지출 ${index + 1} 카테고리`} className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body" onChange={(event) => updatePlanned(row.id, { major: event.target.value })} value={row.major}>
                      {majors.map((major) => <option key={major} value={major}>{major}</option>)}
                    </select>
                    <input aria-invalid={invalidAmount} aria-label={`예정 지출 ${index + 1} 금액`} className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 text-right t-body tabular-nums" inputMode="numeric" onChange={(event) => updatePlanned(row.id, { amount: event.target.value })} type="text" value={row.amount} />
                    <input aria-label={`예정 지출 ${index + 1} 메모`} className="min-h-10 min-w-0 border border-finance-hairline bg-background px-3 t-body" maxLength={200} onChange={(event) => updatePlanned(row.id, { note: event.target.value })} type="text" value={row.note} />
                    <button aria-label={`예정 지출 ${index + 1} 삭제`} className="min-h-10 border border-finance-hairline px-3 t-body-strong text-finance-red" onClick={() => removePlanned(row.id)} type="button">삭제</button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 space-y-2" aria-live="polite">
        {targetDirty && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body text-finance-ink">저축 목표를 먼저 저장해 주세요.</p>}
        {!targetDirty && basis.averageIncome <= 0 && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body text-finance-ink">기준 수입이 있어야 AI 예산 추천을 시작할 수 있어요.</p>}
        {recovering && !data && <p className="t-body text-finance-muted" role="status">연결 상태 확인 중…</p>}
        {networkError && <div className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert"><p>{networkError}</p><button className="font-semibold underline underline-offset-4" onClick={() => void recover()} type="button">상태 다시 확인</button></div>}
        {inputError && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert">{inputError}</p>}
        {data?.availability === 'past_or_distant_month' && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">AI 예산 추천은 이번 달과 다음 달에서만 사용할 수 있어요. 지난 예산은 계속 수동으로 편집할 수 있습니다.</p>}
        {data?.availability === 'missing_income' && basis.averageIncome > 0 && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">기준 수입이 있어야 AI 예산 추천을 시작할 수 있어요.</p>}
        {data?.availability === 'setup_required' && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">AI 작업기를 연결하거나 업데이트해 주세요. 예산은 계속 수동으로 편집할 수 있습니다.</p>}
        {data?.worker === 'offline' && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">Mac이 오프라인입니다. 요청은 저장되며 Mac이 다시 연결되면 자동으로 시작합니다.</p>}
        {data?.worker === 'upgrade_required' && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">Mac의 AI 작업기 업데이트가 필요합니다.</p>}
        {data?.worker === 'not_registered' && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">Mac AI 작업기가 아직 연결되지 않았습니다.</p>}
        {active && <div className="border-l-2 border-finance-violet bg-finance-violet-tint px-4 py-3 t-body" role="status"><strong>{data?.latestJob?.status === 'running' ? '예산 추천을 분석하고 있어요.' : data?.worker === 'offline' ? 'Mac 연결을 기다리고 있어요.' : '예산 추천이 대기 중입니다.'}</strong><p className="mt-1 text-finance-muted">완료되면 아래 예산 편집기에서 확인할 수 있습니다.{data?.completed && ' 기다리는 동안 이전 추천은 그대로 남아 있습니다.'}</p></div>}
        {data?.latestJob?.status === 'failed' && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="status"><strong>{JOB_ERROR_MESSAGES[data.latestJob.errorCode ?? 'cli_failed']}</strong> {data.completed ? '이전 추천은 그대로 남아 있어요.' : '입력을 확인한 뒤 다시 추천할 수 있어요.'}</p>}
        {data?.completed && !active && <p className="border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 t-body" role="status"><strong>추천 완료</strong> 아래 예산 편집기에서 필요한 항목을 골라 가져올 수 있어요.</p>}
        {data?.freshness === 'source_changed' && data.completed && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">기록이 변경되어 재추천이 필요합니다.</p>}
        {data?.freshness === 'budgets_changed' && data.completed && <p className="border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 t-body">예산이 변경되어 재추천이 필요합니다.</p>}
        {data?.instructionsChanged && data.completed && <p className="border-l-2 border-finance-violet bg-finance-violet-tint px-4 py-3 t-body">이전 지침으로 만든 추천입니다. 최신 지침을 반영하려면 다시 추천해 주세요.</p>}
        {promptError && <p className="border-l-2 border-finance-red bg-finance-red-tint px-4 py-3 t-body" role="alert">{promptError}</p>}
      </div>

      {promptView && <div className="mt-5 min-w-0"><AiPromptViewer view={promptView} /></div>}
    </section>
  )
}

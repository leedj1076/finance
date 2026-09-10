'use client'

import { useEffect, useRef, useState } from 'react'

import { AiSettingsConflictError, loadAiSettings, requestAiPromptPreview, submitAiSettings } from './client'
import { AiPromptViewer } from './prompt-viewer'
import type { AiKind, AiPromptPreview, AiSettingsPageData, AiSettingsState, AiSettingsValues, AiWorkerView } from './types'

const FIELDS: Array<{ key: keyof AiSettingsValues; label: string; description: string; maxLength: number }> = [
  { key: 'commonInstructions', label: '공통 분석 지침', description: '두 진단에 함께 적용할 우리집 상황, 중점 항목, 말투와 설명 분량', maxLength: 4_000 },
  { key: 'ledgerInstructions', label: '내역 진단 지침', description: '지출 변화, 이상 지출, 전월 비교와 다음 달 행동을 읽는 관점', maxLength: 6_000 },
  { key: 'budgetInstructions', label: '예산 추천 지침', description: '예외 지출, 유지할 비용, 줄일 항목과 추천 이유를 읽는 관점', maxLength: 6_000 },
]

function sameValue(left: string | null, right: string | null) {
  return left === right
}

function stateValues(state: AiSettingsState): AiSettingsValues {
  return { commonInstructions: state.commonInstructions, ledgerInstructions: state.ledgerInstructions, budgetInstructions: state.budgetInstructions }
}

function updatedLabel(value: string | null) {
  if (!value) return '아직 저장된 변경 없음'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

function workerStatus(worker: AiWorkerView) {
  if (worker.state === 'ready') return '연결됨'
  if (worker.state === 'upgrade_required') return '업데이트 필요'
  return '오프라인'
}

function seenLabel(value: string | null) {
  return value ? updatedLabel(value) : '확인 기록 없음'
}

export function AiSettingsForm({ initial }: { initial: AiSettingsPageData }) {
  const [server, setServer] = useState(initial.settings)
  const [draft, setDraft] = useState<AiSettingsValues>(() => stateValues(initial.settings))
  const [workers, setWorkers] = useState(initial.workers)
  const [budgetPreviewAvailable, setBudgetPreviewAvailable] = useState(initial.budgetPreviewAvailable)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [conflict, setConflict] = useState<AiSettingsState | null>(null)
  const [previewKind, setPreviewKind] = useState<AiKind>('ledger')
  const [previewMonth, setPreviewMonth] = useState(() => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date()))
  const [preview, setPreview] = useState<AiPromptPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewMessage, setPreviewMessage] = useState<string | null>(null)
  const previewRequest = useRef<{ controller: AbortController; generation: number } | null>(null)
  const generation = useRef(0)

  useEffect(() => () => previewRequest.current?.controller.abort(), [])

  async function save() {
    if (saving) return
    const submitted = { ...draft }
    setSaving(true)
    setMessage(null)
    setConflict(null)
    try {
      const saved = await submitAiSettings({ ...submitted, expectedRevision: server.revision })
      setServer(saved)
      setDraft(current => ({
        commonInstructions: sameValue(current.commonInstructions, submitted.commonInstructions) ? saved.commonInstructions : current.commonInstructions,
        ledgerInstructions: sameValue(current.ledgerInstructions, submitted.ledgerInstructions) ? saved.ledgerInstructions : current.ledgerInstructions,
        budgetInstructions: sameValue(current.budgetInstructions, submitted.budgetInstructions) ? saved.budgetInstructions : current.budgetInstructions,
      }))
      setMessage('AI 설정을 저장했습니다.')
    } catch (error) {
      if (error instanceof AiSettingsConflictError) {
        setConflict(error.current)
        setServer(error.current)
        setMessage('다른 창에서 AI 설정을 먼저 저장했습니다. 서버의 현재 값과 내 편집안을 확인한 뒤 다시 저장해 주세요.')
      } else {
        setMessage(error instanceof Error ? error.message : 'AI 설정을 저장하지 못했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function refreshWorkers() {
    if (refreshing) return
    setRefreshing(true)
    try {
      const next = await loadAiSettings()
      setWorkers(next.workers)
      setBudgetPreviewAvailable(next.budgetPreviewAvailable)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '실행 정보를 새로 불러오지 못했습니다.')
    } finally {
      setRefreshing(false)
    }
  }

  async function showPreview() {
    previewRequest.current?.controller.abort()
    const controller = new AbortController()
    const selected = { kind: previewKind, month: previewMonth, generation: generation.current + 1 }
    generation.current = selected.generation
    previewRequest.current = { controller, generation: selected.generation }
    setPreviewing(true)
    setPreviewMessage(null)
    try {
      const next = await requestAiPromptPreview({ kind: selected.kind, month: selected.month, values: draft }, controller.signal)
      if (generation.current !== selected.generation || previewKind !== selected.kind || previewMonth !== selected.month) return
      setPreview(next)
    } catch (error) {
      if (controller.signal.aborted || generation.current !== selected.generation) return
      setPreviewMessage(error instanceof Error ? error.message : '프롬프트를 미리 보지 못했습니다.')
    } finally {
      if (generation.current === selected.generation) setPreviewing(false)
    }
  }

  return (
    <form className="mt-7 min-w-0" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="border-t border-finance-ink pt-5" aria-labelledby="ai-worker-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="t-section text-finance-ink" id="ai-worker-title">로컬 실행 상태</h2><p className="mt-2 t-caption leading-6 text-finance-muted">워커가 직접 보고한 읽기 전용 정보입니다. 모델과 실행 제한은 웹에서 바꿀 수 없습니다.</p></div>
          <button className="h-[34px] border border-finance-hairline px-4 text-[12px] font-semibold text-finance-muted hover:border-finance-ink hover:text-finance-ink" disabled={refreshing} onClick={() => void refreshWorkers()} type="button">{refreshing ? '새로 확인 중…' : '실행 정보 새로고침'}</button>
        </div>
        {workers.length === 0 ? (
          <p className="mt-4 border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 text-[12px] leading-6 text-finance-ink">연결된 Mac 워커가 없습니다. 설정은 저장하고 프롬프트는 미리 볼 수 있지만 실제 진단 전에 연결이 필요합니다.</p>
        ) : (
          <div className="mt-4 border-t border-finance-hairline">
            {workers.map(worker => <div className="grid min-w-0 gap-3 border-b border-finance-hairline py-4 text-[12px] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]" key={worker.id}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="font-semibold text-finance-ink">{worker.label}</strong><span className={`px-2 py-0.5 text-[10px] font-semibold ${worker.state === 'ready' ? 'bg-finance-green-tint text-finance-green' : 'bg-finance-amber-tint text-finance-amber'}`}>{workerStatus(worker)}</span></div><p className="mt-1 text-[11px] text-finance-muted">마지막 확인 {seenLabel(worker.lastSeenAt)}</p></div>
              <div className="leading-6 text-finance-muted"><p className={worker.promptProtocolVersion >= 1 ? 'text-finance-green' : 'text-finance-amber'}>내역 지침 {worker.promptProtocolVersion >= 1 ? '지원' : '업데이트 필요'}</p><p className={worker.budgetProtocolVersion >= 1 ? 'text-finance-green' : 'text-finance-amber'}>예산 {worker.budgetProtocolVersion >= 1 ? '지원' : '업데이트 필요'}</p><p>도구 사용 금지</p></div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 leading-6"><dt className="text-finance-muted">모델</dt><dd className="min-w-0 break-words text-finance-ink">{worker.configuredModel ?? 'CLI 기본값'}</dd><dt className="text-finance-muted">제한</dt><dd className="text-finance-ink">{worker.timeoutMs === null ? '보고 없음' : `${worker.timeoutMs / 1000}초`}</dd></dl>
            </div>)}
          </div>
        )}
      </section>

      <div className="mt-8 grid min-w-0 gap-8">
        {FIELDS.map(field => {
          const raw = draft[field.key]
          const displayed = raw ?? initial.defaults[field.key]
          return <section className="min-w-0 border-t border-finance-ink pt-5" key={field.key}>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><label className="t-section text-finance-ink" htmlFor={`ai-${field.key}`}>{field.label}</label><p className="mt-2 t-caption leading-6 text-finance-muted">{field.description}</p></div><span className={`px-2 py-1 text-[10px] font-semibold ${raw === null ? 'bg-finance-blue-tint text-finance-blue' : 'bg-finance-violet-tint text-finance-violet'}`}>{raw === null ? '기본값 사용' : '사용자 지정'}</span></div>
            <textarea className="mt-4 min-h-36 w-full resize-y border border-finance-hairline bg-background p-4 text-[13px] leading-7 text-finance-ink" id={`ai-${field.key}`} maxLength={field.maxLength} onChange={event => { setDraft(current => ({ ...current, [field.key]: event.target.value })); setMessage(null); setConflict(null) }} value={displayed} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-finance-muted"><span>{[...displayed].length.toLocaleString('ko-KR')} / {field.maxLength.toLocaleString('ko-KR')}자</span><button className="font-semibold text-finance-blue hover:underline" onClick={() => { setDraft(current => ({ ...current, [field.key]: null })); setMessage(null); setConflict(null) }} type="button">{field.label} 기본값 복원</button></div>
          </section>
        })}
      </div>

      <p className="mt-7 border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 text-[11px] leading-6 text-finance-muted">계좌번호, 비밀키, 인증정보를 입력하지 마세요. 지침은 분석 관점만 바꾸며 계산, 근거 검증, 결과 형식, 저축 목표를 변경하지 않습니다.</p>

      <section className="mt-8 min-w-0 border-t border-finance-ink pt-5" aria-labelledby="ai-preview-title">
        <h2 className="t-section text-finance-ink" id="ai-preview-title">전달할 프롬프트 미리보기</h2>
        <p className="mt-2 t-caption leading-6 text-finance-muted">현재 편집안과 그 시점의 실제 가계부 자료를 서버의 실행 조합 함수로 읽기 전용 구성합니다.</p>
        <div className="mt-4 flex min-w-0 flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[11px] font-semibold text-finance-muted">진단 종류<select className="h-[38px] min-w-36 border border-finance-hairline bg-background px-3 text-[13px] text-finance-ink" onChange={event => { generation.current += 1; previewRequest.current?.controller.abort(); setPreviewKind(event.target.value as AiKind) }} value={previewKind}><option value="ledger">내역 진단</option><option value="budget" disabled={!budgetPreviewAvailable}>예산 추천</option></select></label>
          <label className="grid gap-1 text-[11px] font-semibold text-finance-muted">대상 월<input className="h-[38px] border border-finance-hairline bg-background px-3 text-[13px] text-finance-ink" onChange={event => { generation.current += 1; previewRequest.current?.controller.abort(); setPreviewMonth(event.target.value) }} type="month" value={previewMonth} /></label>
          <button className="h-[38px] bg-finance-ink px-5 text-[13px] font-semibold text-white disabled:opacity-50" disabled={previewing || (previewKind === 'budget' && !budgetPreviewAvailable)} onClick={() => void showPreview()} type="button">{previewing ? '미리보기 구성 중…' : '프롬프트 미리보기'}</button>
        </div>
        {previewKind === 'budget' && <p className="mt-3 text-[11px] leading-6 text-finance-muted">설정 화면의 예산 미리보기에는 당월 특이사항, 예정 지출, 미저장 예산 초안이 비어 있습니다. 실제 요청의 입력은 해당 작업의 프롬프트에서 확인할 수 있습니다.</p>}
        <div aria-live="polite">{previewMessage && <p className="mt-4 border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-3 text-[12px] text-finance-ink">{previewMessage}</p>}</div>
        {preview && <div className="mt-6"><AiPromptViewer view={{ state: 'preview', preview }} /></div>}
      </section>

      {conflict && <section className="mt-7 border-l-2 border-finance-amber bg-finance-amber-tint px-4 py-4 text-[12px] leading-6" aria-labelledby="ai-conflict-title"><h2 className="font-semibold text-finance-ink" id="ai-conflict-title">다른 창의 현재 값과 내 편집안</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="font-semibold text-finance-muted">서버의 현재 값</p>{FIELDS.map(field => <p className="mt-2 whitespace-pre-wrap break-words" key={field.key}><span className="text-finance-muted">{field.label}</span><br />{conflict[field.key] ?? initial.defaults[field.key]}</p>)}</div><div><p className="font-semibold text-finance-muted">내 편집안</p>{FIELDS.map(field => <p className="mt-2 whitespace-pre-wrap break-words" key={field.key}><span className="text-finance-muted">{field.label}</span><br />{draft[field.key] ?? initial.defaults[field.key]}</p>)}</div></div></section>}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-finance-hairline bg-background py-4">
        <div aria-live="polite"><p className="text-[12px] font-medium text-finance-ink">{message ?? `마지막 저장 ${updatedLabel(server.updatedAt)}`}</p><p className="mt-1 text-[10px] text-finance-muted">저장해도 진단을 자동 실행하거나 기존 결과를 바꾸지 않습니다.</p></div>
        <button className="h-[38px] bg-finance-blue px-5 text-[13px] font-semibold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? '저장 중…' : 'AI 설정 저장'}</button>
      </div>
    </form>
  )
}

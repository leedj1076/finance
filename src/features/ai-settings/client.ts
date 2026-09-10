import type { AiJobPromptView, AiKind, AiPromptPreview, AiSettingsPageData, AiSettingsSave, AiSettingsState, AiSettingsValues } from './types'

const GENERIC_ERROR = 'AI 설정을 처리하지 못했습니다.'
const MESSAGES: Record<string, string> = {
  preview_no_data: '선택한 월에 미리 볼 내역이 없습니다.',
  preview_missing_income: '예산 추천을 미리 보려면 기준 수입이 필요합니다.',
  preview_month_unavailable: '예산 추천은 이번 달과 다음 달만 미리 볼 수 있습니다.',
  prompt_unavailable: '이 작업에 사용한 프롬프트를 안전하게 표시할 수 없습니다.',
  not_found: '이 작업에 사용한 프롬프트를 찾을 수 없습니다.',
  invalid_input: '입력 내용을 확인해 주세요.',
}

export class AiSettingsConflictError extends Error {
  constructor(public current: AiSettingsState) {
    super('다른 창에서 AI 설정을 먼저 저장했습니다.')
  }
}

async function api<T>(method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/ai-settings', {
    method,
    cache: 'no-store',
    signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result: unknown = await response.json().catch(() => { throw new Error(GENERIC_ERROR) })
  if (!result || typeof result !== 'object') throw new Error(GENERIC_ERROR)
  if (!response.ok) {
    const error = 'error' in result && typeof result.error === 'string' ? result.error : ''
    if (error === 'ai_settings_conflict' && 'current' in result && result.current && typeof result.current === 'object') {
      throw new AiSettingsConflictError(result.current as AiSettingsState)
    }
    throw new Error(MESSAGES[error] ?? GENERIC_ERROR)
  }
  return result as T
}

export function loadAiSettings(signal?: AbortSignal): Promise<AiSettingsPageData> {
  return api('GET', undefined, signal)
}

export function submitAiSettings(input: AiSettingsSave, signal?: AbortSignal): Promise<AiSettingsState> {
  return api('POST', { action: 'save', settings: input }, signal)
}

export function requestAiPromptPreview(
  input: { kind: AiKind; month: string; values: AiSettingsValues },
  signal?: AbortSignal,
): Promise<AiPromptPreview> {
  return api('POST', { action: 'preview', ...input }, signal)
}

export function loadAiJobPrompt(kind: AiKind, jobId: string, signal?: AbortSignal): Promise<AiJobPromptView> {
  return api('POST', { action: 'job-prompt', kind, jobId }, signal)
}

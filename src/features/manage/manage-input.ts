export const manageFlows = ['expense', 'income', 'saving'] as const
export type ManageFlow = (typeof manageFlows)[number]

type TextResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function requiredText(value: FormDataEntryValue | null, label: string, maxLength = 100): TextResult<string> {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!text || text.length > maxLength) return { ok: false, error: `${label}은(는) 1~${maxLength}자로 입력해 주세요.` }
  return { ok: true, value: text }
}

export function optionalText(value: FormDataEntryValue | null, maxLength = 200): TextResult<string | null> {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (text.length > maxLength) return { ok: false, error: `메모는 ${maxLength}자 이내로 입력해 주세요.` }
  return { ok: true, value: text || null }
}

export function positiveId(value: FormDataEntryValue | null) {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function optionalId(value: FormDataEntryValue | null) {
  if (value === '' || value === null) return null
  return positiveId(value) ?? undefined
}

export function manageFlow(value: FormDataEntryValue | null): ManageFlow | null {
  return typeof value === 'string' && manageFlows.includes(value as ManageFlow)
    ? value as ManageFlow
    : null
}

export function safePriority(value: FormDataEntryValue | null) {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : null
}

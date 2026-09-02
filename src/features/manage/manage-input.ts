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

export type BulkAccountInput = {
  id: number | null
  name: string
  owner: string
  type: string
  memo: string | null
  active: boolean
}

export type BulkCategoryInput = {
  id: number | null
  kind: ManageFlow
  major: string
  sub: string
  hidden: boolean
  deleted: boolean
}

type BulkResult<T> = { ok: true; value: T[] } | { ok: false; error: string }

function parsedArray(value: FormDataEntryValue | null, label: string): BulkResult<unknown> {
  if (typeof value !== 'string' || value.length > 500_000) return { ok: false, error: `${label} 정보가 올바르지 않습니다.` }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return { ok: false, error: `${label} 정보가 올바르지 않습니다.` }
    if (parsed.length > 500) return { ok: false, error: `${label}은(는) 한 번에 최대 500개까지 저장할 수 있습니다.` }
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, error: `${label} 정보가 올바르지 않습니다.` }
  }
}

function bulkId(value: unknown) {
  if (value === null) return null
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function normalizedBulkText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text && text.length <= maxLength ? text : null
}

export function parseBulkAccounts(value: FormDataEntryValue | null): BulkResult<BulkAccountInput> {
  const parsed = parsedArray(value, '결제수단')
  if (!parsed.ok) return parsed
  const rows: BulkAccountInput[] = []
  for (const candidate of parsed.value) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, error: '결제수단 입력값을 확인해 주세요.' }
    const row = candidate as Record<string, unknown>
    const id = bulkId(row.id)
    const name = normalizedBulkText(row.name, 80)
    const owner = normalizedBulkText(row.owner, 20)
    const type = normalizedBulkText(row.type, 20)
    const memo = typeof row.memo === 'string' ? row.memo.trim().replace(/\s+/g, ' ') : ''
    if (id === undefined || !name || !owner || !type || memo.length > 200 || typeof row.active !== 'boolean') {
      return { ok: false, error: '결제수단 입력값을 확인해 주세요.' }
    }
    rows.push({ id, name, owner, type, memo: memo || null, active: row.active })
  }
  if (rows.length === 0) return { ok: false, error: '결제수단을 한 개 이상 입력해 주세요.' }
  const names = rows.map((row) => row.name.toLocaleLowerCase('ko-KR'))
  if (new Set(names).size !== names.length) return { ok: false, error: '같은 이름의 결제수단이 있습니다.' }
  return { ok: true, value: rows }
}

export function parseBulkCategories(value: FormDataEntryValue | null): BulkResult<BulkCategoryInput> {
  const parsed = parsedArray(value, '카테고리')
  if (!parsed.ok) return parsed
  const rows: BulkCategoryInput[] = []
  for (const candidate of parsed.value) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, error: '카테고리 입력값을 확인해 주세요.' }
    const row = candidate as Record<string, unknown>
    const id = bulkId(row.id)
    const kind = typeof row.kind === 'string' ? manageFlow(row.kind) : null
    const major = normalizedBulkText(row.major, 80)
    const sub = normalizedBulkText(row.sub, 80)
    if (id === undefined || !kind || !major || !sub || typeof row.hidden !== 'boolean' || typeof row.deleted !== 'boolean') {
      return { ok: false, error: '카테고리 입력값을 확인해 주세요.' }
    }
    rows.push({ id, kind, major, sub, hidden: row.hidden, deleted: row.deleted })
  }
  if (rows.length === 0) return { ok: false, error: '카테고리를 한 개 이상 입력해 주세요.' }
  const keys = rows.map((row) => `${row.kind}\u0000${row.major.toLocaleLowerCase('ko-KR')}\u0000${row.sub.toLocaleLowerCase('ko-KR')}`)
  if (new Set(keys).size !== keys.length) return { ok: false, error: '같은 카테고리가 중복되어 있습니다.' }
  return { ok: true, value: rows }
}

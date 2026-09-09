import type { DiagnosisReport, DiagnosisSnapshot } from './types'

const textSchema = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength })
const idsSchema = { type: 'array', maxItems: 8, items: { type: 'integer', minimum: 1 } }
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })

export const DIAGNOSIS_REPORT_SCHEMA = objectSchema({
  version: { type: 'integer', enum: [1] },
  headline: textSchema(160),
  summary: textSchema(1200),
  changes: { type: 'array', maxItems: 3, items: objectSchema({ title: textSchema(120), body: textSchema(800), category: { anyOf: [textSchema(100), { type: 'null' }] }, transactionIds: idsSchema }) },
  trend: objectSchema({ summary: textSchema(800), caveat: textSchema(600) }),
  checks: { type: 'array', maxItems: 2, items: objectSchema({ title: textSchema(120), body: textSchema(600), transactionIds: idsSchema }) },
  actions: { type: 'array', minItems: 1, maxItems: 3, items: objectSchema({ title: textSchema(120), body: textSchema(600) }) },
  positive: { anyOf: [textSchema(400), { type: 'null' }] },
})

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid diagnosis report object')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) throw new Error('Unexpected diagnosis report fields')
  return item
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid diagnosis report text')
  return value
}

function list(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid diagnosis report list')
  return value
}

export function parseDiagnosisReport(value: unknown, snapshot: DiagnosisSnapshot): DiagnosisReport {
  if (typeof value === 'string') {
    if (value.length > 32_000) throw new Error('Diagnosis report exceeds size limit')
    value = JSON.parse(value)
  }
  const data = record(value, ['version', 'headline', 'summary', 'changes', 'trend', 'checks', 'actions', 'positive'])
  if (data.version !== 1) throw new Error('Unsupported diagnosis report version')
  const knownIds = new Set(snapshot.transactions.map(row => row.id))
  const knownCategories = new Set(snapshot.categories.map(row => row.major))
  const ids = (value: unknown) => {
    const result = list(value, 0, 8)
    if (result.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || !knownIds.has(id)) || new Set(result).size !== result.length) throw new Error('Unknown or duplicated diagnosis evidence')
    return result as number[]
  }
  const trend = record(data.trend, ['summary', 'caveat'])
  return {
    version: 1,
    headline: text(data.headline, 160), summary: text(data.summary, 1200),
    changes: list(data.changes, 0, 3).map(value => {
      const item = record(value, ['title', 'body', 'category', 'transactionIds'])
      const category = item.category === null ? null : text(item.category, 100)
      if (category !== null && !knownCategories.has(category)) throw new Error('Unknown diagnosis category')
      return { title: text(item.title, 120), body: text(item.body, 800), category, transactionIds: ids(item.transactionIds) }
    }),
    trend: { summary: text(trend.summary, 800), caveat: text(trend.caveat, 600) },
    checks: list(data.checks, 0, 2).map(value => {
      const item = record(value, ['title', 'body', 'transactionIds'])
      return { title: text(item.title, 120), body: text(item.body, 600), transactionIds: ids(item.transactionIds) }
    }),
    actions: list(data.actions, 1, 3).map(value => {
      const item = record(value, ['title', 'body'])
      return { title: text(item.title, 120), body: text(item.body, 600) }
    }),
    positive: data.positive === null ? null : text(data.positive, 400),
  }
}

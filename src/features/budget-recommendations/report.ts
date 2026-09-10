import { parseAiPromptInput } from '@/features/ai-settings/prompt'
import type { AiPromptInput, ResolvedAiInstructions } from '@/features/ai-settings/types'

import { evaluateBudget, safeBudgetSum } from './calculations'
import type {
  BudgetFinding,
  BudgetRecommendationReport,
  BudgetRecommendationSnapshot,
  BudgetReference,
} from './types'

const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER

const textSchema = (maxLength: number, allowEmpty = false) => ({
  type: 'string',
  ...(allowEmpty ? {} : { minLength: 1 }),
  maxLength,
})
const objectSchema = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
})

const transactionReferenceSchema = objectSchema({
  kind: { type: 'string', enum: ['transaction'] },
  id: { type: 'integer', minimum: 1, maximum: MAX_SAFE_AMOUNT },
})
const recurringReferenceSchema = objectSchema({
  kind: { type: 'string', enum: ['recurring'] },
  id: { type: 'integer', minimum: 1, maximum: MAX_SAFE_AMOUNT },
})
const plannedReferenceSchema = objectSchema({
  kind: { type: 'string', enum: ['planned'] },
  id: textSchema(2_000),
})
const notesReferenceSchema = objectSchema({
  kind: { type: 'string', enum: ['notes'] },
  quote: textSchema(200),
})
const instructionsReferenceSchema = objectSchema({
  kind: { type: 'string', enum: ['instructions'] },
  scope: { type: 'string', enum: ['common', 'task'] },
  quote: textSchema(200),
})
const referenceSchema = {
  anyOf: [
    transactionReferenceSchema,
    recurringReferenceSchema,
    plannedReferenceSchema,
    notesReferenceSchema,
    instructionsReferenceSchema,
  ],
}
const referencesSchema = { type: 'array', maxItems: 30, items: referenceSchema }
const findingSchema = objectSchema({
  text: textSchema(2_000),
  certainty: { type: 'string', enum: ['recorded', 'user_provided', 'hypothesis'] },
  references: referencesSchema,
})

export const budgetRecommendationReportSchema = objectSchema({
  version: { type: 'integer', enum: [1] },
  summary: textSchema(2_000),
  limitations: { type: 'array', maxItems: 20, items: textSchema(500) },
  overCeilingReason: textSchema(2_000, true),
  adjustments: { type: 'array', maxItems: 20, items: findingSchema },
  rows: {
    type: 'array',
    items: objectSchema({
      major: textSchema(2_000),
      amount: { type: 'integer', minimum: 0, maximum: MAX_SAFE_AMOUNT },
      reason: textSchema(2_000),
      references: referencesSchema,
      exceptional: { type: 'array', maxItems: 10, items: findingSchema },
      reducible: { type: 'array', maxItems: 10, items: findingSchema },
    }),
  },
})

function invalid(): never {
  throw new Error('invalid_output')
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  const result = value as Record<string, unknown>
  const actual = Object.keys(result)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) invalid()
  return result
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid()
  return Array.from(value)
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || [...value].length > max || (!allowEmpty && !value.trim())) invalid()
  return value
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid()
  return value as number
}

type EvidenceContext = {
  snapshot: BudgetRecommendationSnapshot
  evidenceIds: Set<number>
  evidenceById: Map<number, BudgetRecommendationSnapshot['evidence'][number]>
  recurringIds: Set<number>
  recurringById: Map<number, BudgetRecommendationSnapshot['recurring'][number]>
  plannedIds: Set<string>
  plannedById: Map<string, BudgetRecommendationSnapshot['input']['plannedExpenses'][number]>
  promptInput?: AiPromptInput | null
  instructions?: ResolvedAiInstructions
}

function reference(
  value: unknown,
  context: EvidenceContext,
  major?: string,
): BudgetReference {
  const base = record(value, ['kind', ...(value && typeof value === 'object' && 'kind' in value
    ? value.kind === 'instructions' ? ['scope', 'quote']
      : value.kind === 'notes' ? ['quote'] : ['id']
    : [])])

  if (base.kind === 'transaction') {
    const id = positiveInteger(base.id)
    const source = context.evidenceById.get(id)
    if (!context.evidenceIds.has(id) || !source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'transaction', id }
  }
  if (base.kind === 'recurring') {
    const id = positiveInteger(base.id)
    const source = context.recurringById.get(id)
    if (!context.recurringIds.has(id) || !source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'recurring', id }
  }
  if (base.kind === 'planned') {
    const id = text(base.id, 2_000)
    const source = context.plannedById.get(id)
    if (!context.plannedIds.has(id) || !source || (major !== undefined && source.major !== major)) invalid()
    return { kind: 'planned', id }
  }
  if (base.kind === 'notes') {
    const quote = text(base.quote, 200)
    if (!context.snapshot.input.notes.includes(quote)) invalid()
    return { kind: 'notes', quote }
  }
  if (base.kind === 'instructions') {
    if (base.scope !== 'common' && base.scope !== 'task') invalid()
    const quote = text(base.quote, 200)
    if (!context.instructions) {
      if (!context.promptInput) invalid()
      context.instructions = parseAiPromptInput(context.promptInput, 'budget', context.snapshot).instructions
    }
    if (!context.instructions[base.scope].includes(quote)) invalid()
    return { kind: 'instructions', scope: base.scope, quote }
  }
  invalid()
}

function references(value: unknown, context: EvidenceContext, major?: string): BudgetReference[] {
  return list(value, 30).map((item) => reference(item, context, major))
}

function finding(
  value: unknown,
  context: EvidenceContext,
  options: { major?: string; allowEmptyHypothesis: boolean },
): BudgetFinding {
  const item = record(value, ['text', 'certainty', 'references'])
  const parsedReferences = references(item.references, context, options.major)
  if (item.certainty !== 'recorded' && item.certainty !== 'user_provided' && item.certainty !== 'hypothesis') invalid()

  const hasRecordedEvidence = parsedReferences.some((item) => item.kind === 'transaction' || item.kind === 'recurring')
  const hasUserEvidence = parsedReferences.some((item) => item.kind === 'notes'
    || item.kind === 'planned' || item.kind === 'instructions')
  if (item.certainty === 'recorded' && !hasRecordedEvidence) invalid()
  if (item.certainty === 'user_provided' && !hasUserEvidence) invalid()
  if (!parsedReferences.length && (item.certainty !== 'hypothesis' || !options.allowEmptyHypothesis)) invalid()

  return {
    text: text(item.text, 2_000),
    certainty: item.certainty,
    references: parsedReferences,
  }
}

function uniqueIdMap<T extends { id: number }>(items: T[]): Map<number, T> {
  const result = new Map<number, T>()
  for (const item of items) {
    const id = positiveInteger(item.id)
    if (result.has(id)) invalid()
    result.set(id, item)
  }
  return result
}

function parseReport(
  value: unknown,
  snapshot: BudgetRecommendationSnapshot,
  promptInput?: AiPromptInput | null,
): BudgetRecommendationReport {
  const report = record(value, ['version', 'summary', 'limitations', 'overCeilingReason', 'adjustments', 'rows'])
  if (report.version !== 1) invalid()

  const sourceByMajor = new Map<string, BudgetRecommendationSnapshot['rows'][number]>()
  for (const source of snapshot.rows) {
    if (!source.major || sourceByMajor.has(source.major) || !Number.isSafeInteger(source.floor) || source.floor < 0) invalid()
    sourceByMajor.set(source.major, source)
  }
  const plannedById = new Map<string, BudgetRecommendationSnapshot['input']['plannedExpenses'][number]>()
  for (const planned of snapshot.input.plannedExpenses) {
    if (!planned.id || plannedById.has(planned.id)) invalid()
    plannedById.set(planned.id, planned)
  }
  const evidenceById = uniqueIdMap(snapshot.evidence)
  const recurringById = uniqueIdMap(snapshot.recurring)
  const context: EvidenceContext = {
    snapshot,
    evidenceIds: new Set(evidenceById.keys()),
    evidenceById,
    recurringIds: new Set(recurringById.keys()),
    recurringById,
    plannedIds: new Set(plannedById.keys()),
    plannedById,
    promptInput,
  }

  const parsedRows = new Map<string, BudgetRecommendationReport['rows'][number]>()
  const seen = new Set<string>()
  for (const value of list(report.rows, snapshot.rows.length)) {
    const row = record(value, ['major', 'amount', 'reason', 'references', 'exceptional', 'reducible'])
    const major = text(row.major, 2_000)
    const source = sourceByMajor.get(major)
    if (!source || seen.has(major) || !Number.isSafeInteger(row.amount) || (row.amount as number) < source.floor) invalid()
    seen.add(major)
    parsedRows.set(major, {
      major,
      amount: row.amount as number,
      reason: text(row.reason, 2_000),
      references: references(row.references, context, major),
      exceptional: list(row.exceptional, 10).map((item) => finding(item, context, {
        major,
        allowEmptyHypothesis: false,
      })),
      reducible: list(row.reducible, 10).map((item) => finding(item, context, {
        major,
        allowEmptyHypothesis: true,
      })),
    })
  }
  if (seen.size !== snapshot.rows.length) invalid()
  const rows = snapshot.rows.map((source) => parsedRows.get(source.major)!)
  safeBudgetSum(rows.map((row) => row.amount))
  const evaluation = evaluateBudget(snapshot, rows)

  const adjustments = list(report.adjustments, 20).map((item) => finding(item, context, {
    allowEmptyHypothesis: true,
  }))
  const overCeilingReason = text(report.overCeilingReason, 2_000, true)
  if (evaluation.overage > 0 && (!overCeilingReason.trim() || !adjustments.length)) invalid()

  return {
    version: 1,
    summary: text(report.summary, 2_000),
    limitations: list(report.limitations, 20).map((item) => text(item, 500)),
    overCeilingReason,
    adjustments,
    rows,
  }
}

export function parseBudgetRecommendationReport(
  value: unknown,
  snapshot: BudgetRecommendationSnapshot,
  promptInput?: AiPromptInput | null,
): BudgetRecommendationReport {
  try {
    return parseReport(value, snapshot, promptInput)
  } catch {
    throw new Error('invalid_output')
  }
}

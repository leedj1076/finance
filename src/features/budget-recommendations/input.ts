import { isMonthKey } from '@/lib/finance'

import { safeBudgetSum } from './calculations'
import type { BudgetInput, BudgetRequest } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROOT_KEYS = ['requestId', 'month', 'notes', 'plannedExpenses', 'draftAmounts']
const PLANNED_KEYS = ['id', 'major', 'amount', 'note']
const DRAFT_KEYS = ['major', 'amount']

export class BudgetInputError extends Error {
  constructor() {
    super('예산 입력을 확인해주세요.')
    this.name = 'BudgetInputError'
  }
}

function isExactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function parseBudgetRequest(value: unknown): BudgetRequest {
  if (!isExactObject(value, ROOT_KEYS)
    || typeof value.requestId !== 'string' || !UUID_PATTERN.test(value.requestId)
    || typeof value.month !== 'string' || !isMonthKey(value.month)
    || typeof value.notes !== 'string' || value.notes.length > 4000
    || !Array.isArray(value.plannedExpenses) || value.plannedExpenses.length > 30
    || !Array.isArray(value.draftAmounts) || value.draftAmounts.length > 500) {
    throw new BudgetInputError()
  }

  const plannedIds = new Set<string>()
  const plannedExpenses = value.plannedExpenses.map((item) => {
    if (!isExactObject(item, PLANNED_KEYS)
      || typeof item.id !== 'string' || !UUID_PATTERN.test(item.id) || plannedIds.has(item.id)
      || !isNonemptyString(item.major)
      || !isAmount(item.amount)
      || typeof item.note !== 'string' || item.note.length > 200) {
      throw new BudgetInputError()
    }
    plannedIds.add(item.id)
    return { id: item.id, major: item.major, amount: item.amount, note: item.note }
  }).sort((left, right) => compareText(left.id, right.id))

  const draftMajors = new Set<string>()
  const draftAmounts = value.draftAmounts.map((item) => {
    if (!isExactObject(item, DRAFT_KEYS)
      || !isNonemptyString(item.major) || draftMajors.has(item.major)
      || !isAmount(item.amount)) {
      throw new BudgetInputError()
    }
    draftMajors.add(item.major)
    return { major: item.major, amount: item.amount }
  }).sort((left, right) => compareText(left.major, right.major))

  try {
    safeBudgetSum(plannedExpenses.map((item) => item.amount))
    safeBudgetSum(draftAmounts.map((item) => item.amount))
  } catch {
    throw new BudgetInputError()
  }

  return {
    requestId: value.requestId,
    month: value.month,
    notes: value.notes,
    plannedExpenses,
    draftAmounts,
  }
}

export function assertBudgetMajors(input: BudgetInput, allowedMajors: string[]): void {
  const allowed = new Set(allowedMajors)
  const draftMajors = new Set<string>()
  const plannedIds = new Set<string>()

  for (const row of input.draftAmounts) {
    if (!allowed.has(row.major) || draftMajors.has(row.major)) throw new BudgetInputError()
    draftMajors.add(row.major)
  }
  for (const row of input.plannedExpenses) {
    if (!allowed.has(row.major) || plannedIds.has(row.id)) throw new BudgetInputError()
    plannedIds.add(row.id)
  }
}

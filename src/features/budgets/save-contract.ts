import { isMonthKey } from '@/lib/finance'

export type BudgetBaseline = {
  major: string
  amount: number
  recommendationJobId: string | null
  version: string
}

export type BudgetSaveRequest = {
  month: string
  changes: {
    major: string
    amount: number
    recommendationJobId: string | null
    expectedVersion: string
  }[]
  targetChange: { value: number; expectedVersion: string } | null
  acknowledgeOverage: boolean
}

export type BudgetSaveResult = {
  rows: BudgetBaseline[]
  savingsTarget: number
  targetVersion: string
  total: number
  overage: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROOT_KEYS = ['month', 'changes', 'targetChange', 'acknowledgeOverage']
const CHANGE_KEYS = ['major', 'amount', 'recommendationJobId', 'expectedVersion']
const TARGET_KEYS = ['value', 'expectedVersion']

function invalid(): never {
  throw new Error('invalid_input')
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

export function parseBudgetSaveRequest(value: unknown): BudgetSaveRequest {
  if (!isExactObject(value, ROOT_KEYS)
    || typeof value.month !== 'string' || !isMonthKey(value.month)
    || !Array.isArray(value.changes) || value.changes.length > 500
    || typeof value.acknowledgeOverage !== 'boolean') {
    invalid()
  }

  const majors = new Set<string>()
  const changes = value.changes.map((item) => {
    if (!isExactObject(item, CHANGE_KEYS)
      || !isNonemptyString(item.major) || majors.has(item.major)
      || !isAmount(item.amount)
      || (item.recommendationJobId !== null
        && (typeof item.recommendationJobId !== 'string' || !UUID_PATTERN.test(item.recommendationJobId)))
      || !isNonemptyString(item.expectedVersion)) {
      invalid()
    }
    majors.add(item.major)
    return {
      major: item.major,
      amount: item.amount,
      recommendationJobId: item.recommendationJobId,
      expectedVersion: item.expectedVersion,
    }
  })

  let targetChange: BudgetSaveRequest['targetChange'] = null
  if (value.targetChange !== null) {
    if (!isExactObject(value.targetChange, TARGET_KEYS)
      || !Number.isInteger(value.targetChange.value)
      || (value.targetChange.value as number) < 0
      || (value.targetChange.value as number) > 80
      || !isNonemptyString(value.targetChange.expectedVersion)) {
      invalid()
    }
    targetChange = {
      value: value.targetChange.value as number,
      expectedVersion: value.targetChange.expectedVersion,
    }
  }

  return {
    month: value.month,
    changes,
    targetChange,
    acknowledgeOverage: value.acknowledgeOverage,
  }
}

export type BulkClassificationFlow = 'expense' | 'income' | 'saving'
export type BulkClassificationToken = 'exp_var' | 'exp_fix' | 'income' | 'saving'

export function classificationToken(
  flow: BulkClassificationFlow,
  fixed: boolean,
): BulkClassificationToken {
  if (flow === 'expense') return fixed ? 'exp_fix' : 'exp_var'
  return flow
}

export function classificationFromToken(value: unknown): {
  flow: BulkClassificationFlow
  fixed: boolean
} | null {
  if (value === 'exp_var') return { flow: 'expense', fixed: false }
  if (value === 'exp_fix') return { flow: 'expense', fixed: true }
  if (value === 'income') return { flow: 'income', fixed: false }
  if (value === 'saving') return { flow: 'saving', fixed: false }
  return null
}

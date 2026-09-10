import type { BudgetActionState } from '@/features/budgets/actions'
import type { BudgetSaveRequest } from '@/features/budgets/save-contract'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export const saves: {
  previous: BudgetActionState
  payload: BudgetSaveRequest
  response: ReturnType<typeof deferred<BudgetActionState>>
}[] = []

// Only the server-action transport is replaced. Real form/reducer/React execute.
export function saveBudgetPlan(previous: BudgetActionState, formData: FormData) {
  const response = deferred<BudgetActionState>()
  saves.push({ previous, payload: JSON.parse(String(formData.get('payload'))), response })
  return response.promise
}

export const navigation = { refreshes: 0 }
const router = { refresh: () => { navigation.refreshes++ } }
export function useRouter() { return router }

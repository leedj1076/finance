import type { TransactionActionState } from '@/features/ledger/actions'

// Replace only the server-action transport; the actual table, form and React run.
export async function saveTransaction(_state: TransactionActionState, form: FormData): Promise<TransactionActionState> {
  const response = await fetch('/test-save', { method: 'POST', body: form })
  if (!response.ok) throw new Error('connection lost')
  return response.json()
}

export async function deleteTransaction(form: FormData) {
  await fetch('/test-delete', { method: 'POST', body: form })
}

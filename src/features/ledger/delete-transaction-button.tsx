'use client'

import { deleteTransaction } from './actions'
import type { LedgerFilters } from './filters'

export function DeleteTransactionButton({
  filters,
  id,
  month,
}: {
  filters: LedgerFilters
  id: number
  month: string
}) {
  return (
    <form
      action={deleteTransaction}
      onSubmit={(event) => {
        if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault()
      }}
    >
      <input name="transactionId" type="hidden" value={id} />
      <input name="month" type="hidden" value={month} />
      <input name="returnAccount" type="hidden" value={filters.account} />
      <input name="returnFlow" type="hidden" value={filters.flow} />
      <input name="returnMajor" type="hidden" value={filters.major} />
      <input name="returnQ" type="hidden" value={filters.q} />
      <button className="t-caption text-finance-faint hover:text-finance-red" type="submit">
        삭제
      </button>
    </form>
  )
}

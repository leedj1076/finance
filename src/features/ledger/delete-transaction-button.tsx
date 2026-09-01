'use client'

import { deleteTransaction } from './actions'

export function DeleteTransactionButton({ id, month }: { id: number; month: string }) {
  return (
    <form
      action={deleteTransaction}
      onSubmit={(event) => {
        if (!window.confirm('이 거래를 삭제할까요?')) event.preventDefault()
      }}
    >
      <input name="transactionId" type="hidden" value={id} />
      <input name="month" type="hidden" value={month} />
      <button className="text-xs text-zinc-400 hover:text-red-700" type="submit">
        삭제
      </button>
    </form>
  )
}

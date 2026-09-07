import { and, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import { transactions } from '@/db/schema'
import { monthBounds } from '@/lib/finance'

/** Match the posting month, even if the transaction date has since moved. */
export function recurringPostingInMonth(month: string) {
  const { start, end } = monthBounds(month)
  return and(
    isNotNull(transactions.recurringId),
    or(
      eq(transactions.importUid, sql`'recurring:' || ${transactions.recurringId}::text || ':' || ${month}`),
      // Older postings have no identity until their first edit.
      and(isNull(transactions.importUid), gte(transactions.date, start), lt(transactions.date, end)),
    ),
  )
}

/** Used in the same UPDATE as date edits: SQL reads the original row's date. */
export function preservedPostingUid() {
  return sql<string | null>`coalesce(${transactions.importUid}, case
    when ${transactions.recurringId} is not null then
      'recurring:' || ${transactions.recurringId}::text || ':' || to_char(${transactions.date}, 'YYYY-MM')
    else null end)`
}

export function isPostingIdentityConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505'
    && 'constraint_name' in error && error.constraint_name === 'tx_household_import_uid') return true
  return 'cause' in error && isPostingIdentityConflict(error.cause)
}

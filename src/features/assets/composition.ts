/**
 * The allocation bars used to divide by the largest row, so the top group was
 * always a full bar and "비중" meant nothing. Divide by the total instead.
 */
export function compositionShares<T extends { amount: number }>(rows: T[]): Array<T & { share: number }> {
  const positive = (amount: number) => (amount > 0 ? amount : 0)
  const total = rows.reduce((sum, row) => sum + positive(row.amount), 0)
  return rows.map((row) => ({ ...row, share: total > 0 ? (positive(row.amount) / total) * 100 : 0 }))
}

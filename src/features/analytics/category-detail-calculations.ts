export function categoryDetailMonthlyAverage(
  total: number,
  currentMonthAmount: number,
  divisor: number,
) {
  return Math.round((total - currentMonthAmount) / divisor)
}

export function toggleCategoryDetailCell(
  excluded: ReadonlySet<string>,
  key: string,
) {
  const next = new Set(excluded)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

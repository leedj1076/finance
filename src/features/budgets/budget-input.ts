export function parseBudgetAmount(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) return 0
  const amount = Number(value.replace(/[\s,원]/g, ''))
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

export function parseSavingsTarget(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return null
  const target = Number(value)
  return Number.isInteger(target) && target >= 0 && target <= 80 ? target : null
}

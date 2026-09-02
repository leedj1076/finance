export function normalizeMerchant(value: string | null | undefined) {
  return (value ?? '').replace(/[\s\d]+/g, '').toLowerCase()
}

export type LedgerFlowFilter = '' | 'expense' | 'income' | 'saving'

export type LedgerFilters = {
  account: string
  flow: LedgerFlowFilter
  major: string
  q: string
}

type SearchParamValue = string | string[] | undefined

function firstString(value: SearchParamValue) {
  return typeof value === 'string' ? value : ''
}

export function parseLedgerAccountId(value: string) {
  if (!/^\d+$/.test(value)) return null
  const accountId = Number(value)
  return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null
}

export function parseLedgerFilters(params: {
  account?: SearchParamValue
  fflow?: SearchParamValue
  fmajor?: SearchParamValue
  flow?: SearchParamValue
  major?: SearchParamValue
  q?: SearchParamValue
}): LedgerFilters {
  const flow = firstString(params.flow !== undefined ? params.flow : params.fflow)
  const major = firstString(params.major !== undefined ? params.major : params.fmajor)
  const account = firstString(params.account)
  const accountId = parseLedgerAccountId(account)

  return {
    account: accountId === null ? '' : String(accountId),
    flow: flow === 'expense' || flow === 'income' || flow === 'saving' ? flow : '',
    major,
    q: firstString(params.q).trim(),
  }
}

export function ledgerFiltersFromFormData(formData: FormData): LedgerFilters {
  return parseLedgerFilters({
    account: String(formData.get('returnAccount') ?? ''),
    flow: String(formData.get('returnFlow') ?? ''),
    major: String(formData.get('returnMajor') ?? ''),
    q: String(formData.get('returnQ') ?? ''),
  })
}

export function hasLedgerFilters(filters: LedgerFilters) {
  return Boolean(filters.account || filters.flow || filters.major || filters.q)
}

export function ledgerUrl(
  month: string,
  filters: LedgerFilters,
  extras: Record<string, string | number | undefined> = {},
) {
  const params = new URLSearchParams({ month })
  if (filters.account) params.set('account', filters.account)
  if (filters.flow) params.set('flow', filters.flow)
  if (filters.major) params.set('major', filters.major)
  if (filters.q) params.set('q', filters.q)
  Object.entries(extras).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value))
  })
  return `/ledger?${params.toString()}`
}

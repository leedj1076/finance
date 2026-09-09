export type LedgerFlowFilter = '' | 'expense' | 'income' | 'saving'
export type LedgerSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'

export type LedgerFilters = {
  account: string
  flow: LedgerFlowFilter
  major: string
  q: string
  sort?: LedgerSort
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
  sort?: SearchParamValue
}): LedgerFilters {
  const flow = firstString(params.flow !== undefined ? params.flow : params.fflow)
  const major = firstString(params.major !== undefined ? params.major : params.fmajor)
  const account = firstString(params.account)
  const accountId = parseLedgerAccountId(account)
  const sort = firstString(params.sort)

  return {
    account: accountId === null ? '' : String(accountId),
    flow: flow === 'expense' || flow === 'income' || flow === 'saving' ? flow : '',
    major,
    q: firstString(params.q).trim(),
    ...(sort === 'date-asc' || sort === 'amount-desc' || sort === 'amount-asc' ? { sort } : {}),
  }
}

export function ledgerFiltersFromFormData(formData: FormData): LedgerFilters {
  return parseLedgerFilters({
    account: String(formData.get('returnAccount') ?? ''),
    flow: String(formData.get('returnFlow') ?? ''),
    major: String(formData.get('returnMajor') ?? ''),
    q: String(formData.get('returnQ') ?? ''),
    sort: String(formData.get('returnSort') ?? ''),
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
  if (filters.sort && filters.sort !== 'date-desc') params.set('sort', filters.sort)
  Object.entries(extras).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value))
  })
  return `/ledger?${params.toString()}`
}

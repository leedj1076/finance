import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, transactions } from '@/db/schema'
import { currentMonthInKorea, isMonthKey, monthBounds } from '@/lib/finance'

import {
  normalizeAnalyticsMerchant,
  type AnalyticsFlow,
} from './calculations'

export type CategoryPageSearchParams = Record<string, string | string[] | undefined>

export type CategoryPageParams = {
  period: 'month' | 'year'
  month: string
  year: number
  start: string
  end: string
  label: string
  flow: AnalyticsFlow
  major: string
  accountId: number | null
}

export type CategoryPageRow = {
  id: number
  date: string
  flow: AnalyticsFlow
  fixed: boolean
  amount: number
  major: string | null
  sub: string | null
  memo: string | null
  rawMerchant: string | null
  accountId: number | null
  accountName: string | null
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parsePositiveSafeInteger(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseYear(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null
}

export function parseCategoryPageParams(
  searchParams: CategoryPageSearchParams,
  currentMonth = currentMonthInKorea(),
): CategoryPageParams {
  const rawFlow = firstParam(searchParams.flow)
  const flow: AnalyticsFlow = rawFlow === 'income' || rawFlow === 'saving'
    ? rawFlow
    : 'expense'
  const rawMajor = firstParam(searchParams.major)?.trim() ?? ''
  const major = rawMajor.length <= 100 ? rawMajor : ''
  const monthCandidate = firstParam(searchParams.month) ?? firstParam(searchParams.ym)
  const selectedMonth = isMonthKey(monthCandidate) ? monthCandidate : null
  const selectedYear = parseYear(firstParam(searchParams.year))
  const explicitPeriod = firstParam(searchParams.period)
  const period = explicitPeriod === 'year'
    || (explicitPeriod !== 'month' && selectedMonth === null && selectedYear !== null)
    ? 'year'
    : 'month'
  const fallbackYear = Number(currentMonth.slice(0, 4))

  if (period === 'year') {
    const year = selectedYear ?? fallbackYear
    return {
      period,
      month: `${year}-01`,
      year,
      start: `${year}-01-01`,
      end: `${year + 1}-01-01`,
      label: `${year}년`,
      flow,
      major,
      accountId: parsePositiveSafeInteger(firstParam(searchParams.account)),
    }
  }

  const month = selectedMonth ?? currentMonth
  const bounds = monthBounds(month)
  return {
    period,
    month,
    year: Number(month.slice(0, 4)),
    start: bounds.start,
    end: bounds.end,
    label: month,
    flow,
    major,
    accountId: parsePositiveSafeInteger(firstParam(searchParams.account)),
  }
}

function normalizedMajor(row: CategoryPageRow) {
  return row.major ?? '미분류'
}

function normalizedSub(row: CategoryPageRow) {
  return row.sub ?? '미분류'
}

/** Match Python round(value, 1): exact .05 ties go to the nearest even tenth. */
export function roundOneDecimalLikePython(value: number) {
  const shifted = value * 10
  const lower = Math.floor(shifted)
  const fraction = shifted - lower
  const rounded = fraction === 0.5
    ? (lower % 2 === 0 ? lower : lower + 1)
    : Math.round(shifted)
  return rounded / 10
}

export function buildCategoryPageData(
  rows: CategoryPageRow[],
  major: string,
) {
  const periodTotal = rows.reduce((sum, row) => sum + row.amount, 0)
  const selectedRows = rows.filter((row) => normalizedMajor(row) === major)
  const categoryTotal = selectedRows.reduce((sum, row) => sum + row.amount, 0)
  const subMap = new Map<string, { sub: string; amount: number; count: number }>()
  const merchantMap = new Map<string, { name: string; amount: number; count: number }>()

  for (const row of selectedRows) {
    const sub = normalizedSub(row)
    const subValue = subMap.get(sub) ?? { sub, amount: 0, count: 0 }
    subValue.amount += row.amount
    subValue.count += 1
    subMap.set(sub, subValue)

    const merchant = row.rawMerchant !== null && row.rawMerchant !== ''
      ? row.rawMerchant
      : row.memo ?? ''
    const merchantKey = normalizeAnalyticsMerchant(merchant)
    if (!merchantKey) continue
    const merchantValue = merchantMap.get(merchantKey) ?? {
      name: merchant,
      amount: 0,
      count: 0,
    }
    merchantValue.amount += row.amount
    merchantValue.count += 1
    merchantMap.set(merchantKey, merchantValue)
  }

  const subs = [...subMap.values()].sort(
    (left, right) => right.amount - left.amount
      || right.count - left.count
      || left.sub.localeCompare(right.sub, 'ko'),
  )
  const merchants = [...merchantMap.values()]
    .sort(
      (left, right) => right.amount - left.amount
        || right.count - left.count
        || left.name.localeCompare(right.name, 'ko'),
    )
    .slice(0, 10)
  const categoryRows = [...selectedRows]
    .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id)
    .map((row) => ({
      id: row.id,
      date: row.date,
      flow: row.flow,
      fixed: row.fixed,
      sub: normalizedSub(row),
      memo: row.memo ?? '',
      amount: row.amount,
      accountId: row.accountId,
      accountName: row.accountName ?? '',
    }))

  return {
    categoryTotal,
    periodTotal,
    percent: periodTotal > 0
      ? roundOneDecimalLikePython((categoryTotal / periodTotal) * 100)
      : 0,
    subs,
    merchants,
    transactions: categoryRows,
  }
}

export async function getCategoryPageData(
  householdId: string,
  params: CategoryPageParams,
) {
  let selectedAccount: { id: number; name: string } | null = null
  if (params.accountId !== null) {
    const [account] = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.id, params.accountId)))
      .limit(1)
    selectedAccount = account ?? null
  }

  const filters: SQL[] = [
    eq(transactions.householdId, householdId),
    eq(transactions.flow, params.flow),
    gte(transactions.date, params.start),
    lt(transactions.date, params.end),
  ]
  if (selectedAccount) filters.push(eq(transactions.accountId, selectedAccount.id))

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      flow: transactions.flow,
      fixed: transactions.fixed,
      amount: transactions.amount,
      major: categories.major,
      sub: categories.sub,
      memo: transactions.memo,
      rawMerchant: transactions.rawMerchant,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .leftJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
      ),
    )
    .leftJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.householdId, householdId),
      ),
    )
    .where(and(...filters))
    .orderBy(desc(transactions.date), desc(transactions.id))

  return {
    ...params,
    accountId: selectedAccount?.id ?? null,
    selectedAccount,
    ...buildCategoryPageData(rows, params.major),
  }
}

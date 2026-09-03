import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  assetAccounts,
  balanceSnapshots,
  categories,
  transactions,
} from '@/db/schema'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'

import { normalizeAnalyticsMerchant } from './calculations'

export type ReportFlow = 'expense' | 'income' | 'saving'

export type ReportTransactionRow = {
  id: number
  date: string
  flow: ReportFlow
  amount: number
  major: string
  memo: string | null
  rawMerchant?: string | null
}

export type ReportAssetBalanceRow = {
  accountId: number
  kind: string
  major: string
  month: string
  amount: number
}

type FlowTotals = {
  income: number
  expense: number
  saving: number
  netSaving: number
  savingsRate: number
}

type Yoy = {
  delta: number
  pct: number | null
  previous: number
}

const CASH_MAJORS = ['현금', '저축·투자']

/** Match Python round(): exact .5 ties go to the nearest even integer. */
export function roundLikePython(value: number) {
  const lower = Math.floor(value)
  const fraction = value - lower
  if (fraction !== 0.5) return Math.round(value)
  return lower % 2 === 0 ? lower : lower + 1
}

function roundOneDecimal(value: number) {
  return roundLikePython(value * 10) / 10
}

function savingsRate(income: number, expense: number) {
  return income > 0 ? roundOneDecimal(((income - expense) / income) * 100) : 0
}

function flowTotals(rows: ReportTransactionRow[]): FlowTotals {
  let income = 0
  let expense = 0
  let saving = 0
  for (const row of rows) {
    if (row.flow === 'income') income += row.amount
    else if (row.flow === 'expense') expense += row.amount
    else saving += row.amount
  }
  return {
    income,
    expense,
    saving,
    netSaving: income - expense,
    savingsRate: savingsRate(income, expense),
  }
}

function yoy(current: number, previous: number): Yoy {
  return {
    delta: current - previous,
    pct: previous > 0
      ? roundLikePython(((current - previous) / previous) * 100)
      : null,
    previous,
  }
}

function latestCashBalance(rows: ReportAssetBalanceRow[]) {
  const latest = new Map<number, ReportAssetBalanceRow>()
  for (const row of rows) {
    if (row.kind !== 'asset' || !CASH_MAJORS.includes(row.major)) continue
    const existing = latest.get(row.accountId)
    if (!existing || row.month > existing.month) latest.set(row.accountId, row)
  }
  return [...latest.values()].reduce((sum, row) => sum + row.amount, 0)
}

export function buildAnnualReport({
  year,
  currentMonthKey,
  transactions: transactionRows,
  assetBalances,
}: {
  year: number
  currentMonthKey: string
  transactions: ReportTransactionRow[]
  assetBalances: ReportAssetBalanceRow[]
}) {
  const selectedPrefix = `${year}-`
  const previousPrefix = `${year - 1}-`
  const selectedRows = transactionRows.filter((row) => row.date.startsWith(selectedPrefix))
  const currentYear = Number(currentMonthKey.slice(0, 4))
  const comparisonThroughMonth = year < currentYear
    ? 12
    : year === currentYear
      ? Number(currentMonthKey.slice(5, 7))
      : 0
  const previousRows = transactionRows.filter((row) => (
    row.date.startsWith(previousPrefix)
    && Number(row.date.slice(5, 7)) <= comparisonThroughMonth
  ))
  const annual = flowTotals(selectedRows)
  const previous = flowTotals(previousRows)
  const hasPrevious = previous.income + previous.expense > 0

  const expenseByMajor = new Map<string, number>()
  for (const row of selectedRows) {
    if (row.flow !== 'expense') continue
    expenseByMajor.set(row.major, (expenseByMajor.get(row.major) ?? 0) + row.amount)
  }
  const previousExpenseByMajor = new Map<string, number>()
  for (const row of previousRows) {
    if (row.flow !== 'expense') continue
    previousExpenseByMajor.set(row.major, (previousExpenseByMajor.get(row.major) ?? 0) + row.amount)
  }
  const topExpenses = [...expenseByMajor.entries()]
    .map(([major, amount]) => {
      const previousAmount = previousExpenseByMajor.get(major) ?? 0
      return {
        major,
        amount,
        percent: annual.expense > 0 ? roundOneDecimal((amount / annual.expense) * 100) : 0,
        previous: previousAmount,
        delta: amount - previousAmount,
      }
    })
    .sort((left, right) => right.amount - left.amount || left.major.localeCompare(right.major, 'ko'))
    .slice(0, 6)

  const merchantMap = new Map<string, { name: string; amount: number; count: number }>()
  for (const row of selectedRows) {
    if (row.flow !== 'expense') continue
    const merchant = row.rawMerchant || row.memo || ''
    const key = normalizeAnalyticsMerchant(merchant)
    if (!key) continue
    const value = merchantMap.get(key) ?? { name: merchant, amount: 0, count: 0 }
    value.amount += row.amount
    value.count += 1
    merchantMap.set(key, value)
  }
  const previousMerchantMap = new Map<string, number>()
  for (const row of previousRows) {
    if (row.flow !== 'expense') continue
    const merchant = row.rawMerchant || row.memo || ''
    const key = normalizeAnalyticsMerchant(merchant)
    if (!key) continue
    previousMerchantMap.set(key, (previousMerchantMap.get(key) ?? 0) + row.amount)
  }
  const topMerchants = [...merchantMap.values()]
    .map((merchant) => {
      const key = normalizeAnalyticsMerchant(merchant.name)
      const previousAmount = previousMerchantMap.get(key) ?? 0
      return {
        ...merchant,
        previous: previousAmount,
        delta: merchant.amount - previousAmount,
      }
    })
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.name.localeCompare(right.name, 'ko'))
    .slice(0, 8)

  const expenseRows = selectedRows
    .filter((row) => row.flow === 'expense')
    .sort((left, right) => right.amount - left.amount || left.date.localeCompare(right.date) || left.id - right.id)
  const largestExpense = expenseRows[0] ?? null

  const monthlyRows = new Map<number, ReportTransactionRow[]>()
  for (const row of selectedRows) {
    const month = Number(row.date.slice(5, 7))
    const rows = monthlyRows.get(month) ?? []
    rows.push(row)
    monthlyRows.set(month, rows)
  }
  const monthlyRates = [...monthlyRows.entries()]
    .map(([month, rows]) => ({ month, ...flowTotals(rows) }))
    .filter((row) => row.income > 0)
    .sort((left, right) => left.month - right.month)
    .map((row) => ({ month: row.month, savingsRate: row.savingsRate }))
  const bestMonth = monthlyRates.reduce<(typeof monthlyRates)[number] | null>(
    (best, row) => best === null || row.savingsRate > best.savingsRate ? row : best,
    null,
  )
  const worstMonth = monthlyRates.reduce<(typeof monthlyRates)[number] | null>(
    (worst, row) => worst === null || row.savingsRate < worst.savingsRate ? row : worst,
    null,
  )

  const completedRows = selectedRows.filter(
    (row) => year !== currentYear || row.date.slice(0, 7) < currentMonthKey,
  )
  const completedMonths = new Set(completedRows.map((row) => row.date.slice(0, 7)))
  const completedMonthDivisor = completedMonths.size || 1
  const completedTotals = flowTotals(completedRows)
  const monthlyNet = roundLikePython(
    (completedTotals.income - completedTotals.expense) / completedMonthDivisor,
  )
  const startCash = latestCashBalance(assetBalances)
  let balance = startCash
  const forecast = Array.from({ length: 6 }, (_, index) => {
    balance += monthlyNet
    return {
      month: shiftMonth(currentMonthKey, index + 1),
      net: monthlyNet,
      balance,
    }
  })

  return {
    year,
    previousYear: year - 1,
    nextYear: year + 1,
    annual,
    previous,
    hasPrevious,
    yoy: {
      income: yoy(annual.income, previous.income),
      expense: yoy(annual.expense, previous.expense),
      netSaving: yoy(annual.netSaving, previous.netSaving),
      saving: yoy(annual.saving, previous.saving),
    },
    savingsRateDelta: roundOneDecimal(annual.savingsRate - previous.savingsRate),
    topExpenses,
    topMerchants,
    largestExpense,
    bestMonth,
    worstMonth,
    cashflow: {
      startCash,
      completedMonthDivisor,
      monthlyNet,
      forecast,
    },
  }
}

function validYear(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && value! >= 2000 && value! <= 2100 ? value! : fallback
}

export async function getReportData(householdId: string, requestedYear?: number) {
  const currentMonthKey = currentMonthInKorea()
  const year = validYear(requestedYear, Number(currentMonthKey.slice(0, 4)))
  const transactionStart = `${year - 1}-01-01`
  const transactionEnd = `${year + 1}-01-01`

  const [transactionRows, balanceRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        flow: transactions.flow,
        amount: transactions.amount,
        major: sql<string>`coalesce(${categories.major}, '미분류')`,
        memo: transactions.memo,
        rawMerchant: transactions.rawMerchant,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(
          eq(categories.id, transactions.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, transactionStart),
          lt(transactions.date, transactionEnd),
        ),
      )
      .orderBy(asc(transactions.date), asc(transactions.id)),
    db
      .select({
        accountId: assetAccounts.id,
        kind: assetAccounts.kind,
        major: assetAccounts.major,
        month: balanceSnapshots.month,
        amount: balanceSnapshots.amount,
      })
      .from(assetAccounts)
      .innerJoin(
        balanceSnapshots,
        and(
          eq(balanceSnapshots.accountId, assetAccounts.id),
          eq(balanceSnapshots.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(assetAccounts.householdId, householdId),
          eq(assetAccounts.kind, 'asset'),
          inArray(assetAccounts.major, CASH_MAJORS),
        ),
      )
      .orderBy(asc(assetAccounts.id), asc(balanceSnapshots.month)),
  ])

  return buildAnnualReport({
    year,
    currentMonthKey,
    transactions: transactionRows,
    assetBalances: balanceRows,
  })
}

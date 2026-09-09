import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { accounts, assetAccounts, balanceSnapshots, categories, settings, transactions } from '@/db/schema'
import { readMonthStatuses } from '@/features/month-close/queries'
import { currentMonthInKorea } from '@/lib/finance'
import { buildAccountMonthly, type AccountMonthlyData } from './account-monthly'
import { monthlySummaries } from './calculations'
import { buildCategoryDetails } from './category-detail'
import { buildAnnualReport, type ReportFlow } from './report'

const FLOWS: ReportFlow[] = ['expense', 'income', 'saving']

/** Annual statistics are read from one snapshot, never stitched to the live home loader. */
export async function getStatsReportData(householdId: string, requestedYear?: number) {
  const currentMonthKey = currentMonthInKorea()
  const year = Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100
    ? requestedYear! : Number(currentMonthKey.slice(0, 4))
  return db.transaction(async tx => {
    const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    const statuses = await readMonthStatuses(tx, householdId, [...monthKeys, ...monthKeys.map(key => `${year - 1}${key.slice(4)}`)])
    const months = statuses.slice(0, 12)
    const eligibleMonths = months.filter(row => row.state === 'closed' && row.month < currentMonthKey).map(row => Number(row.month.slice(5)))
    const eligible = new Set(eligibleMonths)
    const previousClosed = new Set(statuses.slice(12).filter(row => row.state === 'closed').map(row => Number(row.month.slice(5))))
    const previousComparable = eligibleMonths.length > 0 && eligibleMonths.every(month => previousClosed.has(month))
    const rows = await tx.select({
      id: transactions.id, date: transactions.date, flow: transactions.flow, fixed: transactions.fixed, amount: transactions.amount,
      major: sql<string>`coalesce(${categories.major}, '미분류')`, sub: sql<string>`coalesce(${categories.sub}, '미분류')`,
      merchant: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), ${transactions.memo}, '')`,
      memo: transactions.memo, rawMerchant: transactions.rawMerchant,
      accountId: transactions.accountId, accountName: sql<string>`coalesce(${accounts.name}, '(미지정)')`,
    }).from(transactions)
      .leftJoin(categories, and(eq(categories.householdId, householdId), eq(categories.id, transactions.categoryId)))
      .leftJoin(accounts, and(eq(accounts.householdId, householdId), eq(accounts.id, transactions.accountId)))
      .where(and(eq(transactions.householdId, householdId), gte(transactions.date, `${year - 1}-01-01`), lt(transactions.date, `${year + 1}-01-01`)))
      .orderBy(asc(transactions.date), asc(transactions.id))
    const balances = await tx.select({ accountId: assetAccounts.id, kind: assetAccounts.kind, major: assetAccounts.major, month: balanceSnapshots.month, amount: balanceSnapshots.amount })
      .from(assetAccounts).innerJoin(balanceSnapshots, and(eq(balanceSnapshots.householdId, householdId), eq(balanceSnapshots.accountId, assetAccounts.id)))
      .where(and(eq(assetAccounts.householdId, householdId), eq(assetAccounts.kind, 'asset'), inArray(assetAccounts.major, ['현금', '저축·투자'])))
    const taxonomy = await tx.select({ kind: categories.kind, major: categories.major, sub: categories.sub, sortOrder: categories.sortOrder })
      .from(categories).where(and(eq(categories.householdId, householdId), eq(categories.hidden, false))).orderBy(categories.sortOrder, categories.id)
    const [target] = await tx.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, 'savings_target')))
    const parsedTarget = Number(target?.value ?? 30)
    const savingsTarget = Number.isFinite(parsedTarget) ? Math.min(Math.max(parsedTarget, 0), 80) : 30
    const selectedRows = rows.filter(row => row.date.startsWith(`${year}-`) && eligible.has(Number(row.date.slice(5, 7))))
    const monthly = monthlySummaries(selectedRows, year).map((row, index) => ({ ...row, active: eligible.has(index + 1) }))
    const details = buildCategoryDetails({ year, currentMonthKey, taxonomy, transactions: selectedRows })
    const monthRevisions = Object.fromEntries(months.filter(row => row.state === 'closed').map(row => [Number(row.month.slice(5)), row.revision]))
    const accountMonthly = {} as Record<ReportFlow, AccountMonthlyData>
    for (const flow of FLOWS) {
      Object.assign(details[flow], { months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: eligible.size, closedMonths: eligibleMonths, monthRevisions })
      const account = buildAccountMonthly(selectedRows, flow, { fold: false })
      for (const name of account.accounts) {
        account.series[name] = account.series[name].map((value, i) => eligible.has(i + 1) ? value ?? 0 : null)
      }
      accountMonthly[flow] = account
    }
    return {
      report: buildAnnualReport({ year, currentMonthKey, transactions: rows, assetBalances: balances, eligibleMonths, previousComparable }),
      monthly, accountMonthly, details, savingsTarget, months, eligibleMonths, previousComparable,
      targetHitMonths: monthly.filter(row => row.active && row.income > 0 && row.savingsRate >= savingsTarget).length,
      assetBasisMonth: balances.map(row => row.month).sort().at(-1) ?? null,
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

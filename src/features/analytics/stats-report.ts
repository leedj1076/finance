import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { accounts, assetAccounts, balanceSnapshots, categories, settings, transactions } from '@/db/schema'
import { readMonthStatuses } from '@/features/month-close/queries'
import { currentMonthInKorea } from '@/lib/finance'
import { buildAccountMonthly, type AccountMonthlyData } from './account-monthly'
import { monthlySummaries } from './calculations'
import { buildCategoryDetails, type StatsMonthState } from './category-detail'
import { buildAnnualReport, type ReportFlow } from './report'

const FLOWS: ReportFlow[] = ['expense', 'income', 'saving']

/** Annual statistics are read from one snapshot, never stitched to the live home loader. */
export async function getStatsReportData(
  householdId: string,
  requestedYear?: number,
  options: { currentMonthKey?: string } = {},
) {
  const currentMonthKey = options.currentMonthKey ?? currentMonthInKorea()
  const year = Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100
    ? requestedYear! : Number(currentMonthKey.slice(0, 4))
  return db.transaction(async tx => {
    const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    const statuses = await readMonthStatuses(tx, householdId, [...monthKeys, ...monthKeys.map(key => `${year - 1}${key.slice(4)}`)])
    const months = statuses.slice(0, 12)
    const previous = statuses.slice(12)
    const monthStates: StatsMonthState[] = months.map(row => (
      row.month > currentMonthKey ? 'future' : row.month === currentMonthKey ? 'current' : row.state
    ))
    const closedMonths = months
      .filter((_, index) => monthStates[index] === 'closed')
      .map(row => Number(row.month.slice(5)))
    const endedMonths = months
      .filter((_, index) => monthStates[index] !== 'current' && monthStates[index] !== 'future')
      .map(row => Number(row.month.slice(5)))
    const closed = new Set(closedMonths)
    const ended = new Set(endedMonths)
    const previousClosed = new Set(previous.filter(row => row.state === 'closed').map(row => Number(row.month.slice(5))))

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

    const yearRows = rows.filter(row => row.date.startsWith(`${year}-`))
    const recorded = new Set(yearRows.map(row => Number(row.date.slice(5, 7))))
    const recordedMonths = [...recorded].sort((left, right) => left - right)
    const provisionalMonths = endedMonths.filter(month => recorded.has(month) || closed.has(month))
    const previousRecorded = new Set(rows
      .filter(row => row.date.startsWith(`${year - 1}-`))
      .map(row => Number(row.date.slice(5, 7))))
    const previousComparable = closedMonths.length > 0 && closedMonths.every(month => previousClosed.has(month))
    const previousEndedComparable = provisionalMonths.length > 0
      && provisionalMonths.some(month => previousRecorded.has(month) || previousClosed.has(month))
    const displayRows = yearRows.filter(row => {
      const month = Number(row.date.slice(5, 7))
      return ended.has(month) || monthStates[month - 1] === 'current'
    })
    const monthly = monthlySummaries(yearRows, year).map((row, index) => ({
      ...row,
      active: monthStates[index] !== 'future',
      state: monthStates[index],
      hasTransactions: recorded.has(index + 1),
    }))
    const details = buildCategoryDetails({ year, currentMonthKey, taxonomy, transactions: displayRows })
    const monthRevisions = Object.fromEntries(months
      .filter((_, index) => monthStates[index] === 'closed')
      .map(row => [Number(row.month.slice(5)), row.revision]))
    const accountMonthly = {} as Record<ReportFlow, AccountMonthlyData>
    for (const flow of FLOWS) {
      Object.assign(details[flow], {
        months: Array.from({ length: 12 }, (_, i) => i + 1),
        divisor: closedMonths.length,
        provisionalDivisor: provisionalMonths.length,
        closedMonths,
        endedMonths,
        recordedMonths,
        provisionalMonths,
        states: monthStates,
        monthRevisions,
      })
      const account = buildAccountMonthly(displayRows, flow, { fold: false })
      for (const name of account.accounts) {
        account.series[name] = account.series[name].map((value, index) => {
          const month = index + 1
          if (monthStates[index] === 'future') return null
          return recorded.has(month) || closed.has(month) ? value ?? 0 : null
        })
      }
      accountMonthly[flow] = account
    }
    const savingsHit = (eligibleMonths: number[]) => monthly.filter(
      (row, index) => eligibleMonths.includes(index + 1) && row.income > 0 && row.savingsRate >= savingsTarget,
    ).length
    return {
      report: {
        official: buildAnnualReport({ year, currentMonthKey, transactions: rows, assetBalances: balances, eligibleMonths: closedMonths, previousComparable }),
        provisional: buildAnnualReport({ year, currentMonthKey, transactions: rows, assetBalances: balances, eligibleMonths: provisionalMonths, previousComparable: previousEndedComparable }),
      },
      monthly, accountMonthly, details, savingsTarget, months, monthStates,
      closedMonths, endedMonths, recordedMonths, provisionalMonths,
      hasTransactions: recordedMonths.length > 0,
      previousComparable, previousEndedComparable,
      targetHitMonths: savingsHit(closedMonths),
      provisionalTargetHitMonths: savingsHit(provisionalMonths),
      assetBasisMonth: balances.map(row => row.month).sort().at(-1) ?? null,
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

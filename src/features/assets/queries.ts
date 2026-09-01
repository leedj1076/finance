import { and, desc, eq, gte, lte, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots, transactions } from '@/db/schema'
import { currentMonthInKorea, isMonthKey, monthBounds, shiftMonth } from '@/lib/finance'

import {
  assetComposition,
  assetOverview,
  netWorthTrend,
  type AssetAccountRow,
  type AssetKind,
} from './calculations'

export async function getAssetData(householdId: string, requestedMonth?: string) {
  const [latest] = await db
    .select({ month: balanceSnapshots.month })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.householdId, householdId))
    .orderBy(desc(balanceSnapshots.month))
    .limit(1)

  const month = isMonthKey(requestedMonth)
    ? requestedMonth
    : latest?.month ?? currentMonthInKorea()
  const year = Number(month.slice(0, 4))
  const previousMonth = shiftMonth(month, -1)
  const nextMonth = shiftMonth(month, 1)
  const expenseStart = `${shiftMonth(month, -5)}-01`
  const { end: expenseEnd } = monthBounds(month)

  const [accountRows, snapshotRows, expenseRows] = await Promise.all([
    db
      .select({
        id: assetAccounts.id,
        major: assetAccounts.major,
        name: assetAccounts.name,
        kind: assetAccounts.kind,
        sortOrder: assetAccounts.sortOrder,
      })
      .from(assetAccounts)
      .where(and(eq(assetAccounts.householdId, householdId), eq(assetAccounts.active, true)))
      .orderBy(assetAccounts.sortOrder, assetAccounts.id),
    db
      .select({
        accountId: balanceSnapshots.accountId,
        month: balanceSnapshots.month,
        amount: balanceSnapshots.amount,
      })
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.householdId, householdId),
          lte(balanceSnapshots.month, `${year}-12`),
        ),
      )
      .orderBy(balanceSnapshots.month),
    db
      .select({
        amount: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
        months: sql<string>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.flow, 'expense'),
          gte(transactions.date, expenseStart),
          lt(transactions.date, expenseEnd),
        ),
      ),
  ])

  const accounts: AssetAccountRow[] = accountRows
    .filter((row) => row.kind === 'asset' || row.kind === 'liability')
    .map((row) => ({ ...row, kind: row.kind as AssetKind }))
  const snapshots = snapshotRows.map((row) => ({ ...row, amount: Number(row.amount) }))
  const overview = assetOverview(accounts, snapshots, month)
  const previousOverview = assetOverview(accounts, snapshots, previousMonth)
  const trend = netWorthTrend(accounts, snapshots, year, month)
  const composition = assetComposition(overview)
  const expenseMonths = Number(expenseRows[0]?.months ?? 0)
  const averageExpense = expenseMonths > 0
    ? Math.round(Number(expenseRows[0]?.amount ?? 0) / expenseMonths)
    : 0

  return {
    month,
    year,
    previousMonth,
    nextMonth,
    overview,
    trend,
    composition,
    netWorthDelta: overview.netWorth - previousOverview.netWorth,
    averageExpense,
    emergencyMonths: averageExpense > 0 ? overview.liquidAssets / averageExpense : null,
    debtRatio: overview.assets > 0 ? (overview.debt / overview.assets) * 100 : null,
  }
}

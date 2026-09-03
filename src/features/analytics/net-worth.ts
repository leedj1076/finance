import { and, asc, eq, lte } from 'drizzle-orm'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots } from '@/db/schema'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'

export type NetWorthAccount = {
  id: number
  kind: string
}

export type NetWorthSnapshot = {
  accountId: number
  month: string
  amount: number
}

export type NetWorthPoint = {
  month: string
  assets: number
  liabilities: number
  netWorth: number
}

export function buildNetWorthSeries(
  accounts: NetWorthAccount[],
  snapshots: NetWorthSnapshot[],
  months = 12,
  throughMonth = currentMonthInKorea(),
): NetWorthPoint[] {
  if (snapshots.length === 0 || months <= 0) return []

  const accountKind = new Map(accounts.map((account) => [account.id, account.kind]))
  const sorted = [...snapshots]
    .filter((snapshot) => accountKind.has(snapshot.accountId) && snapshot.month <= throughMonth)
    .sort((left, right) => left.month.localeCompare(right.month))
  if (sorted.length === 0) return []

  const startMonth = shiftMonth(throughMonth, -(months - 1))
  const latest = new Map<number, number>()
  let snapshotIndex = 0

  return Array.from({ length: months }, (_, index) => {
    const month = shiftMonth(startMonth, index)
    while (snapshotIndex < sorted.length && sorted[snapshotIndex].month <= month) {
      latest.set(sorted[snapshotIndex].accountId, sorted[snapshotIndex].amount)
      snapshotIndex += 1
    }

    let assets = 0
    let liabilities = 0
    for (const [accountId, amount] of latest) {
      if (accountKind.get(accountId) === 'liability') liabilities += amount
      else assets += amount
    }
    return { month, assets, liabilities, netWorth: assets - liabilities }
  })
}

export async function getNetWorthSeries(householdId: string, months = 12) {
  const throughMonth = currentMonthInKorea()
  const [accountRows, snapshotRows] = await Promise.all([
    db
      .select({ id: assetAccounts.id, kind: assetAccounts.kind })
      .from(assetAccounts)
      .where(and(eq(assetAccounts.householdId, householdId), eq(assetAccounts.active, true)))
      .orderBy(asc(assetAccounts.id)),
    db
      .select({
        accountId: balanceSnapshots.accountId,
        month: balanceSnapshots.month,
        amount: balanceSnapshots.amount,
      })
      .from(balanceSnapshots)
      .innerJoin(
        assetAccounts,
        and(
          eq(assetAccounts.id, balanceSnapshots.accountId),
          eq(assetAccounts.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(balanceSnapshots.householdId, householdId),
          lte(balanceSnapshots.month, throughMonth),
        ),
      )
      .orderBy(asc(balanceSnapshots.month), asc(balanceSnapshots.accountId)),
  ])

  return buildNetWorthSeries(accountRows, snapshotRows, months, throughMonth)
}

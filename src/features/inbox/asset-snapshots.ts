import { asc, eq, max, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots } from '@/db/schema'

import type { BanksaladStatus } from './banksalad'

type SnapshotItem = {
  major: string
  name: string
  kind: 'asset' | 'liability'
  amount: number
}

function snapshotItems(statuses: BanksaladStatus[]) {
  const items: SnapshotItem[] = []
  for (const status of statuses) {
    for (const asset of status.assets) {
      items.push({ major: asset.group, name: asset.label, kind: 'asset', amount: asset.amount })
    }
    for (const loan of status.loans) {
      items.push({ major: '대출', name: loan.label, kind: 'liability', amount: loan.balance })
    }
  }
  return items
}

export async function upsertBanksaladAssetSnapshots(
  householdId: string,
  statuses: BanksaladStatus[],
  month: string,
) {
  const items = snapshotItems(statuses)
  if (items.length === 0) return 0

  return db.transaction(async (transaction) => {
    const [accountRows, sortRows] = await Promise.all([
      transaction
        .select({ id: assetAccounts.id, name: assetAccounts.name })
        .from(assetAccounts)
        .where(eq(assetAccounts.householdId, householdId))
        .orderBy(asc(assetAccounts.id)),
      transaction
        .select({ value: max(assetAccounts.sortOrder) })
        .from(assetAccounts)
        .where(eq(assetAccounts.householdId, householdId)),
    ])
    const accountsByName = new Map<string, number>()
    for (const account of accountRows) {
      if (!accountsByName.has(account.name)) accountsByName.set(account.name, account.id)
    }
    let sortOrder = sortRows[0]?.value ?? 0

    for (const item of items) {
      let accountId = accountsByName.get(item.name)
      if (accountId === undefined) {
        sortOrder += 1
        const [created] = await transaction
          .insert(assetAccounts)
          .values({
            householdId,
            major: item.kind === 'liability' ? '대출' : item.major,
            name: item.name,
            kind: item.kind,
            sortOrder,
          })
          .returning({ id: assetAccounts.id })
        accountId = created.id
        accountsByName.set(item.name, accountId)
      }

      await transaction
        .insert(balanceSnapshots)
        .values({ householdId, accountId, month, amount: item.amount })
        .onConflictDoUpdate({
          target: [
            balanceSnapshots.householdId,
            balanceSnapshots.accountId,
            balanceSnapshots.month,
          ],
          set: { amount: sql`excluded.amount` },
        })
    }

    return items.length
  })
}

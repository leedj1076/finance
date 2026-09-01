'use server'

import { and, eq, max, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots } from '@/db/schema'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

import { parseAssetAmount, parseAssetName, parseNewAssets } from './asset-input'

export type AssetActionState = { error?: string }

type ExistingAssetUpdate = {
  id: number
  major: string
  name: string
  amount: number | null
  deleted: boolean
}

function parseIds(values: FormDataEntryValue[]) {
  const ids = values
    .filter((value): value is string => typeof value === 'string')
    .map(Number)
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null
  return Array.from(new Set(ids))
}

export async function saveAssets(
  _previousState: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const monthValue = formData.get('month')
  if (typeof monthValue !== 'string' || !isMonthKey(monthValue)) {
    return { error: '자산 기준 월이 올바르지 않습니다.' }
  }

  const ids = parseIds(formData.getAll('accountId'))
  if (!ids) return { error: '자산 항목 정보가 올바르지 않습니다.' }

  const allActive = await db
    .select({ id: assetAccounts.id, major: assetAccounts.major, name: assetAccounts.name })
    .from(assetAccounts)
    .where(
      and(
        eq(assetAccounts.householdId, household.householdId),
        eq(assetAccounts.active, true),
      ),
    )
  const existingById = new Map(allActive.map((account) => [account.id, account]))
  const existing = ids.flatMap((id) => {
    const account = existingById.get(id)
    return account ? [account] : []
  })
  if (existing.length !== ids.length || ids.length !== allActive.length) {
    return { error: '자산 목록이 변경되었습니다. 새로고침 후 다시 저장해 주세요.' }
  }

  const updates: ExistingAssetUpdate[] = []
  for (const account of existing) {
    const name = parseAssetName(formData.get(`name:${account.id}`))
    const amount = parseAssetAmount(formData.get(`amount:${account.id}`))
    if (!name) return { error: '자산 항목 이름은 1~80자로 입력해 주세요.' }
    if (amount === undefined) return { error: `${name} 잔액은 0 이상의 정수로 입력해 주세요.` }
    updates.push({
      id: account.id,
      major: account.major,
      name,
      amount,
      deleted: formData.get(`deleted:${account.id}`) === 'on',
    })
  }

  const newAssets = parseNewAssets(formData.get('newAssets'))
  if (!newAssets) return { error: '추가할 자산 항목을 확인해 주세요.' }

  const activeNames = updates
    .filter((row) => !row.deleted)
    .map((row) => `${row.major}\u0000${row.name.toLocaleLowerCase('ko-KR')}`)
  const newNames = newAssets.map((row) => `${row.major}\u0000${row.name.toLocaleLowerCase('ko-KR')}`)
  const allNames = [...activeNames, ...newNames]
  if (new Set(allNames).size !== allNames.length) {
    return { error: '같은 그룹에 동일한 자산 항목 이름이 있습니다.' }
  }

  await db.transaction(async (transaction) => {
    const [sortRow] = await transaction
      .select({ value: max(assetAccounts.sortOrder) })
      .from(assetAccounts)
      .where(eq(assetAccounts.householdId, household.householdId))
    let sortOrder = sortRow?.value ?? 0

    // Move every submitted name out of the unique-key space first so two
    // accounts can safely swap names in one save.
    for (const update of updates) {
      await transaction
        .update(assetAccounts)
        .set({ name: `__asset_edit_${update.id}` })
        .where(
          and(
            eq(assetAccounts.householdId, household.householdId),
            eq(assetAccounts.id, update.id),
          ),
        )
    }

    for (const update of updates) {
      await transaction
        .update(assetAccounts)
        .set({
          name: update.deleted ? `${update.name} · 보관 ${update.id}` : update.name,
          active: !update.deleted,
        })
        .where(
          and(
            eq(assetAccounts.householdId, household.householdId),
            eq(assetAccounts.id, update.id),
          ),
        )
      if (update.deleted) continue

      if (update.amount === null) {
        await transaction
          .delete(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.householdId, household.householdId),
              eq(balanceSnapshots.accountId, update.id),
              eq(balanceSnapshots.month, monthValue),
            ),
          )
      } else {
        await transaction
          .insert(balanceSnapshots)
          .values({
            householdId: household.householdId,
            accountId: update.id,
            month: monthValue,
            amount: update.amount,
          })
          .onConflictDoUpdate({
            target: [
              balanceSnapshots.householdId,
              balanceSnapshots.accountId,
              balanceSnapshots.month,
            ],
            set: { amount: sql`excluded.amount` },
          })
      }
    }

    for (const newAsset of newAssets) {
      sortOrder += 1
      const [created] = await transaction
        .insert(assetAccounts)
        .values({
          householdId: household.householdId,
          major: newAsset.major,
          name: newAsset.name,
          kind: newAsset.kind,
          sortOrder,
        })
        .returning({ id: assetAccounts.id })
      if (newAsset.amount !== null) {
        await transaction.insert(balanceSnapshots).values({
          householdId: household.householdId,
          accountId: created.id,
          month: monthValue,
          amount: newAsset.amount,
        })
      }
    }
  })

  revalidatePath('/assets')
  revalidatePath('/dashboard')
  redirect(`/assets?month=${monthValue}&saved=1`)
}

'use server'

import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accountAliases, accounts, categories, categoryRules, importInbox, merchantLookup, recurring, transactions } from '@/db/schema'
import { isAggregatorNorm } from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'
import { requireHousehold } from '@/lib/household'

import { classificationFromToken } from './bulk-classification'
import { manageFlow, optionalText, parseBulkAccounts, parseBulkCategories, positiveId, requiredText } from './manage-input'

type ManageTab = 'accounts' | 'categories' | 'rules' | 'unclassified'

function finish(tab: ManageTab, key: 'error' | 'saved', message: string): never {
  redirect(`/manage?tab=${tab}&${key}=${encodeURIComponent(message)}`)
}

function refreshDataPaths() {
  for (const path of ['/manage', '/ledger', '/budgets', '/inbox', '/recurring', '/dashboard', '/analysis']) {
    revalidatePath(path)
  }
}

function sameIds(left: number[], right: number[]) {
  if (left.length !== right.length) return false
  const expected = new Set(right)
  return left.every((id) => expected.has(id))
}

function learnMerchantStatement(input: {
  householdId: string
  normMerchant: string
  displayMerchant: string
  categoryId: number
  flow: 'expense' | 'income' | 'saving'
}) {
  return sql`
    insert into merchant_lookup
      (household_id, norm_merchant, display_merchant, category_id, flow, source,
       confidence, always_confirm, hit_count, last_used_at)
    values
      (${input.householdId}, ${input.normMerchant}, ${input.displayMerchant},
       ${input.categoryId}, ${input.flow}, 'user', 'high',
       ${isAggregatorNorm(input.normMerchant)}, 1, now())
    on conflict (household_id, norm_merchant) do update set
      display_merchant = excluded.display_merchant,
      category_id = excluded.category_id,
      flow = excluded.flow,
      source = 'user',
      confidence = 'high',
      hit_count = merchant_lookup.hit_count + 1,
      last_used_at = now()
  `
}

export async function bulkSaveAccounts(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const parsed = parseBulkAccounts(formData.get('accounts'))
  if (!parsed.ok) finish('accounts', 'error', parsed.error)

  const existingRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.householdId, household.householdId))
  const submittedIds = parsed.value.flatMap((row) => row.id === null ? [] : [row.id])
  if (!sameIds(submittedIds, existingRows.map((row) => row.id))) {
    finish('accounts', 'error', '결제수단 목록이 변경되었습니다. 새로고침 후 다시 저장해 주세요.')
  }

  await db.transaction(async (tx) => {
    for (const row of parsed.value) {
      if (row.id === null) continue
      await tx
        .update(accounts)
        .set({ name: `__account_bulk_edit_${household.householdId}_${row.id}` })
        .where(and(eq(accounts.householdId, household.householdId), eq(accounts.id, row.id)))
    }
    for (const [index, row] of parsed.value.entries()) {
      if (row.id === null) {
        await tx.insert(accounts).values({
          householdId: household.householdId,
          name: row.name,
          owner: row.owner,
          type: row.type,
          memo: row.memo,
          active: row.active,
          sortOrder: index + 1,
        })
      } else {
        await tx
          .update(accounts)
          .set({ name: row.name, owner: row.owner, type: row.type, memo: row.memo, active: row.active, sortOrder: index + 1 })
          .where(and(eq(accounts.householdId, household.householdId), eq(accounts.id, row.id)))
      }
    }
  })
  refreshDataPaths()
  finish('accounts', 'saved', '결제수단과 표시 순서를 저장했습니다.')
}

export async function bulkSaveCategories(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const parsed = parseBulkCategories(formData.get('categories'))
  if (!parsed.ok) finish('categories', 'error', parsed.error)

  const existingRows = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(eq(categories.householdId, household.householdId))
  const submittedIds = parsed.value.flatMap((row) => row.id === null ? [] : [row.id])
  if (!sameIds(submittedIds, existingRows.map((row) => row.id))) {
    finish('categories', 'error', '카테고리 목록이 변경되었습니다. 새로고침 후 다시 저장해 주세요.')
  }
  const kindById = new Map(existingRows.map((row) => [row.id, row.kind]))
  if (parsed.value.some((row) => row.id !== null && kindById.get(row.id) !== row.kind)) {
    finish('categories', 'error', '기존 카테고리의 거래 유형은 바꿀 수 없습니다.')
  }

  const existingIds = existingRows.map((row) => row.id)
  const usage = new Map<number, number>()
  if (existingIds.length > 0) {
    const usageGroups = await Promise.all([
      db.select({ id: transactions.categoryId, value: count() }).from(transactions).where(and(eq(transactions.householdId, household.householdId), inArray(transactions.categoryId, existingIds))).groupBy(transactions.categoryId),
      db.select({ id: recurring.categoryId, value: count() }).from(recurring).where(and(eq(recurring.householdId, household.householdId), inArray(recurring.categoryId, existingIds))).groupBy(recurring.categoryId),
      db.select({ id: categoryRules.categoryId, value: count() }).from(categoryRules).where(and(eq(categoryRules.householdId, household.householdId), inArray(categoryRules.categoryId, existingIds))).groupBy(categoryRules.categoryId),
      db.select({ id: merchantLookup.categoryId, value: count() }).from(merchantLookup).where(and(eq(merchantLookup.householdId, household.householdId), inArray(merchantLookup.categoryId, existingIds))).groupBy(merchantLookup.categoryId),
      db.select({ id: importInbox.categoryId, value: count() }).from(importInbox).where(and(eq(importInbox.householdId, household.householdId), inArray(importInbox.categoryId, existingIds))).groupBy(importInbox.categoryId),
    ])
    for (const rows of usageGroups) {
      for (const row of rows) {
        if (row.id !== null) usage.set(row.id, (usage.get(row.id) ?? 0) + row.value)
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const row of parsed.value) {
      if (row.id === null) continue
      await tx
        .update(categories)
        .set({ major: `__category_bulk_edit_${row.id}`, sub: `__category_bulk_edit_${row.id}` })
        .where(and(eq(categories.householdId, household.householdId), eq(categories.id, row.id)))
    }

    const orderByKind = new Map<string, number>()
    for (const row of parsed.value) {
      const order = (orderByKind.get(row.kind) ?? 0) + 1
      orderByKind.set(row.kind, order)
      if (row.id !== null && row.deleted && (usage.get(row.id) ?? 0) === 0) {
        await tx.delete(categories).where(and(eq(categories.householdId, household.householdId), eq(categories.id, row.id)))
        continue
      }
      const hidden = row.hidden || row.deleted
      if (row.id === null) {
        await tx.insert(categories).values({ householdId: household.householdId, kind: row.kind, major: row.major, sub: row.sub, hidden, sortOrder: order })
      } else {
        await tx
          .update(categories)
          .set({ major: row.major, sub: row.sub, hidden, sortOrder: order })
          .where(and(eq(categories.householdId, household.householdId), eq(categories.id, row.id)))
      }
    }
  })
  refreshDataPaths()
  finish('categories', 'saved', '카테고리 구조와 표시 순서를 저장했습니다.')
}

export async function saveAccount(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  const name = requiredText(formData.get('name'), '결제수단 이름', 80)
  const owner = requiredText(formData.get('owner'), '소유자', 20)
  const type = requiredText(formData.get('type'), '종류', 20)
  const memo = optionalText(formData.get('memo'))
  if (!name.ok) finish('accounts', 'error', name.error)
  if (!owner.ok) finish('accounts', 'error', owner.error)
  if (!type.ok) finish('accounts', 'error', type.error)
  if (!memo.ok) finish('accounts', 'error', memo.error)

  const duplicate = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.householdId, household.householdId),
      sql`lower(${accounts.name}) = lower(${name.value})`,
      id ? ne(accounts.id, id) : undefined,
    ))
    .limit(1)
  if (duplicate.length > 0) finish('accounts', 'error', '같은 이름의 결제수단이 이미 있습니다.')

  if (id) {
    const updated = await db
      .update(accounts)
      .set({ name: name.value, owner: owner.value, type: type.value, memo: memo.value, active: formData.get('active') === 'on' })
      .where(and(eq(accounts.householdId, household.householdId), eq(accounts.id, id)))
      .returning({ id: accounts.id })
    if (updated.length === 0) finish('accounts', 'error', '결제수단을 찾을 수 없습니다.')
  } else {
    const [sortRow] = await db
      .select({ value: sql<number>`coalesce(max(${accounts.sortOrder}), 0)` })
      .from(accounts)
      .where(eq(accounts.householdId, household.householdId))
    await db.insert(accounts).values({
      householdId: household.householdId,
      name: name.value,
      owner: owner.value,
      type: type.value,
      memo: memo.value,
      active: true,
      sortOrder: Number(sortRow?.value ?? 0) + 1,
    })
  }
  refreshDataPaths()
  finish('accounts', 'saved', id ? '결제수단을 저장했습니다.' : '결제수단을 추가했습니다.')
}

export async function saveCategory(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  const requestedFlow = manageFlow(formData.get('kind'))
  const major = requiredText(formData.get('major'), '대분류', 80)
  const sub = requiredText(formData.get('sub'), '소분류', 80)
  if (!requestedFlow) finish('categories', 'error', '거래 유형을 확인해 주세요.')
  if (!major.ok) finish('categories', 'error', major.error)
  if (!sub.ok) finish('categories', 'error', sub.error)

  let kind = requestedFlow
  if (id) {
    const existing = await db
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.householdId, household.householdId), eq(categories.id, id)))
      .limit(1)
    if (!existing[0]) finish('categories', 'error', '카테고리를 찾을 수 없습니다.')
    kind = existing[0].kind
  }
  const duplicate = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(
      eq(categories.householdId, household.householdId),
      eq(categories.kind, kind),
      sql`lower(${categories.major}) = lower(${major.value})`,
      sql`lower(${categories.sub}) = lower(${sub.value})`,
      id ? ne(categories.id, id) : undefined,
    ))
    .limit(1)
  if (duplicate.length > 0) finish('categories', 'error', '같은 카테고리가 이미 있습니다.')

  if (id) {
    await db
      .update(categories)
      .set({ major: major.value, sub: sub.value, hidden: formData.get('active') !== 'on' })
      .where(and(eq(categories.householdId, household.householdId), eq(categories.id, id)))
  } else {
    const [sortRow] = await db
      .select({ value: sql<number>`coalesce(max(${categories.sortOrder}), 0)` })
      .from(categories)
      .where(and(eq(categories.householdId, household.householdId), eq(categories.kind, kind)))
    await db.insert(categories).values({
      householdId: household.householdId,
      kind,
      major: major.value,
      sub: sub.value,
      sortOrder: Number(sortRow?.value ?? 0) + 1,
    })
  }
  refreshDataPaths()
  finish('categories', 'saved', id ? '카테고리를 저장했습니다.' : '카테고리를 추가했습니다.')
}

export async function updateMerchantLookupCategory(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  const flow = manageFlow(formData.get('flow'))
  const categoryId = positiveId(formData.get('categoryId'))
  if (!id || !flow || !categoryId) finish('rules', 'error', '가맹점 분류 정보를 확인해 주세요.')

  const category = await db
    .select({ kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, household.householdId),
        eq(categories.id, categoryId),
        eq(categories.hidden, false),
      ),
    )
    .limit(1)
  if (category[0]?.kind !== flow) {
    finish('rules', 'error', '카테고리와 거래 유형이 맞지 않습니다.')
  }

  const updated = await db
    .update(merchantLookup)
    .set({ categoryId, flow, source: 'user', confidence: 'high' })
    .where(
      and(
        eq(merchantLookup.householdId, household.householdId),
        eq(merchantLookup.id, id),
      ),
    )
    .returning({ id: merchantLookup.id })
  if (updated.length === 0) finish('rules', 'error', '가맹점 사전 항목을 찾을 수 없습니다.')
  revalidatePath('/manage')
  revalidatePath('/inbox')
  finish('rules', 'saved', '가맹점 분류를 저장했습니다.')
}

export async function toggleAlwaysConfirm(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  if (!id) finish('rules', 'error', '가맹점 사전 항목을 확인해 주세요.')

  const updated = await db
    .update(merchantLookup)
    .set({ alwaysConfirm: sql`not ${merchantLookup.alwaysConfirm}` })
    .where(
      and(
        eq(merchantLookup.householdId, household.householdId),
        eq(merchantLookup.id, id),
      ),
    )
    .returning({ alwaysConfirm: merchantLookup.alwaysConfirm })
  if (updated.length === 0) finish('rules', 'error', '가맹점 사전 항목을 찾을 수 없습니다.')
  revalidatePath('/manage')
  revalidatePath('/inbox')
  finish(
    'rules',
    'saved',
    updated[0].alwaysConfirm
      ? '이 가맹점은 항상 확인하도록 설정했습니다.'
      : '항상 확인 설정을 해제했습니다.',
  )
}

export async function deleteMerchantLookup(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  if (!id) finish('rules', 'error', '가맹점 사전 항목을 확인해 주세요.')

  const deleted = await db
    .delete(merchantLookup)
    .where(
      and(
        eq(merchantLookup.householdId, household.householdId),
        eq(merchantLookup.id, id),
      ),
    )
    .returning({ id: merchantLookup.id })
  if (deleted.length === 0) finish('rules', 'error', '가맹점 사전 항목을 찾을 수 없습니다.')
  revalidatePath('/manage')
  revalidatePath('/inbox')
  finish('rules', 'saved', '가맹점 사전 항목을 삭제했습니다.')
}

export async function saveAlias(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const owner = requiredText(formData.get('owner'), '소유자', 20)
  const alias = requiredText(formData.get('alias'), '별칭', 100)
  if (!owner.ok) finish('rules', 'error', owner.error)
  if (!alias.ok) finish('rules', 'error', alias.error)

  if (formData.get('intent') === 'delete') {
    await db.delete(accountAliases).where(and(
      eq(accountAliases.householdId, household.householdId),
      eq(accountAliases.owner, owner.value),
      eq(accountAliases.alias, alias.value),
    ))
    revalidatePath('/manage')
    revalidatePath('/inbox')
    finish('rules', 'saved', '결제수단 별칭을 삭제했습니다.')
  }
  const accountId = positiveId(formData.get('accountId'))
  if (!accountId) finish('rules', 'error', '연결할 결제수단을 선택해 주세요.')
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, household.householdId), eq(accounts.id, accountId)))
    .limit(1)
  if (!account[0]) finish('rules', 'error', '가족 가계부의 결제수단이 아닙니다.')
  await db
    .update(accountAliases)
    .set({ accountId })
    .where(and(
      eq(accountAliases.householdId, household.householdId),
      eq(accountAliases.owner, owner.value),
      eq(accountAliases.alias, alias.value),
    ))
  revalidatePath('/manage')
  revalidatePath('/inbox')
  finish('rules', 'saved', '결제수단 별칭을 저장했습니다.')
}

export async function classifyTransaction(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  const categoryId = positiveId(formData.get('categoryId'))
  if (!id || !categoryId) finish('unclassified', 'error', '거래와 카테고리를 확인해 주세요.')

  const [transaction, category] = await Promise.all([
    db
      .select({ id: transactions.id, flow: transactions.flow, memo: transactions.memo, rawMerchant: transactions.rawMerchant })
      .from(transactions)
      .where(and(eq(transactions.householdId, household.householdId), eq(transactions.id, id)))
      .limit(1),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.householdId, household.householdId), eq(categories.id, categoryId)))
      .limit(1),
  ])
  if (!transaction[0] || !category[0]) finish('unclassified', 'error', '거래 또는 카테고리를 찾을 수 없습니다.')
  if (transaction[0].flow !== category[0].kind) finish('unclassified', 'error', '카테고리와 거래 유형이 맞지 않습니다.')

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId, fixed: transaction[0].flow === 'expense' ? formData.get('fixed') === 'on' : false })
      .where(and(eq(transactions.householdId, household.householdId), eq(transactions.id, id)))
    const displayMerchant = transaction[0].rawMerchant || transaction[0].memo || ''
    const pattern = normalizeMerchant(displayMerchant)
    if (pattern) {
      await tx.execute(learnMerchantStatement({
        householdId: household.householdId,
        normMerchant: pattern,
        displayMerchant,
        categoryId,
        flow: transaction[0].flow,
      }))
    }
  })
  refreshDataPaths()
  finish('unclassified', 'saved', '거래를 분류하고 다음 추천에 반영했습니다.')
}

export async function bulkClassifyTransactions(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const ids = [
    ...new Set(
      formData
        .getAll('ids')
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ]
  if (ids.length === 0) finish('unclassified', 'error', '분류할 거래를 선택해 주세요.')
  if (ids.length > 100) finish('unclassified', 'error', '한 번에 최대 100건까지 분류할 수 있습니다.')

  const transactionRows = await db
    .select({
      id: transactions.id,
      memo: transactions.memo,
      rawMerchant: transactions.rawMerchant,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, household.householdId),
        isNull(transactions.categoryId),
        inArray(transactions.id, ids),
      ),
    )
    .orderBy(transactions.id)
  if (transactionRows.length !== ids.length) {
    finish('unclassified', 'error', '선택한 미분류 거래를 모두 찾지 못했습니다.')
  }

  const requested = new Map<number, {
    categoryId: number
    flow: 'expense' | 'income' | 'saving'
    fixed: boolean
  }>()
  for (const row of transactionRows) {
    const categoryId = positiveId(formData.get(`category_${row.id}`))
    if (!categoryId) finish('unclassified', 'error', `${row.id}번 거래의 카테고리를 선택해 주세요.`)
    const classification = classificationFromToken(formData.get(`flow_${row.id}`))
    if (!classification) finish('unclassified', 'error', `${row.id}번 거래의 유형을 확인해 주세요.`)
    requested.set(row.id, { categoryId, ...classification })
  }
  const categoryIds = [...new Set([...requested.values()].map((item) => item.categoryId))]
  const categoryRows = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, household.householdId),
        eq(categories.hidden, false),
        inArray(categories.id, categoryIds),
      ),
    )
  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]))
  for (const row of transactionRows) {
    const classification = requested.get(row.id)!
    const category = categoriesById.get(classification.categoryId)
    if (!category || category.kind !== classification.flow) {
      finish('unclassified', 'error', `${row.id}번 거래의 카테고리와 거래 유형이 맞지 않습니다.`)
    }
  }

  const updatedCount = await db.transaction(async (tx) => {
    let updated = 0
    for (const row of transactionRows) {
      const classification = requested.get(row.id)!
      const [changed] = await tx
        .update(transactions)
        .set({
          categoryId: classification.categoryId,
          flow: classification.flow,
          fixed: classification.fixed,
        })
        .where(
          and(
            eq(transactions.householdId, household.householdId),
            eq(transactions.id, row.id),
            isNull(transactions.categoryId),
          ),
        )
        .returning({ id: transactions.id })
      if (!changed) continue
      updated += 1

      const displayMerchant = row.rawMerchant || row.memo || ''
      const pattern = normalizeMerchant(displayMerchant)
      if (!pattern) continue
      await tx.execute(learnMerchantStatement({
        householdId: household.householdId,
        normMerchant: pattern,
        displayMerchant,
        categoryId: classification.categoryId,
        flow: classification.flow,
      }))
    }
    return updated
  })

  if (updatedCount === 0) {
    finish('unclassified', 'error', '선택한 거래가 이미 다른 화면에서 분류되었습니다.')
  }
  refreshDataPaths()
  const skipped = transactionRows.length - updatedCount
  const suffix = skipped > 0 ? ` · 이미 분류된 ${skipped}건 제외` : ''
  finish('unclassified', 'saved', `${updatedCount}건을 분류하고 다음 추천에 반영했습니다${suffix}.`)
}

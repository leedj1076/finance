'use server'

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accountAliases, accounts, categories, categoryRules, transactions } from '@/db/schema'
import { normalizeMerchant } from '@/features/inbox/banksalad'
import { requireHousehold } from '@/lib/household'

import { classificationFromToken } from './bulk-classification'
import { manageFlow, optionalId, optionalText, positiveId, requiredText, safePriority } from './manage-input'

type ManageTab = 'accounts' | 'categories' | 'rules' | 'unclassified'

function finish(tab: ManageTab, key: 'error' | 'saved', message: string): never {
  redirect(`/manage?tab=${tab}&${key}=${encodeURIComponent(message)}`)
}

function refreshDataPaths() {
  for (const path of ['/manage', '/ledger', '/budgets', '/inbox', '/recurring', '/dashboard', '/analysis']) {
    revalidatePath(path)
  }
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

export async function saveRule(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const id = positiveId(formData.get('id'))
  if (!id) finish('rules', 'error', '분류 규칙을 찾을 수 없습니다.')
  const existing = await db
    .select({ id: categoryRules.id })
    .from(categoryRules)
    .where(and(eq(categoryRules.householdId, household.householdId), eq(categoryRules.id, id)))
    .limit(1)
  if (!existing[0]) finish('rules', 'error', '분류 규칙을 찾을 수 없습니다.')

  if (formData.get('intent') === 'delete') {
    await db.delete(categoryRules).where(and(eq(categoryRules.householdId, household.householdId), eq(categoryRules.id, id)))
    revalidatePath('/manage')
    revalidatePath('/inbox')
    finish('rules', 'saved', '분류 규칙을 삭제했습니다.')
  }

  const flow = manageFlow(formData.get('flow'))
  const categoryId = optionalId(formData.get('categoryId'))
  const accountId = optionalId(formData.get('accountId'))
  const priority = safePriority(formData.get('priority'))
  if (!flow || categoryId === undefined || accountId === undefined || priority === null) {
    finish('rules', 'error', '규칙 설정값을 확인해 주세요.')
  }
  if (categoryId !== null) {
    const category = await db
      .select({ kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.householdId, household.householdId), eq(categories.id, categoryId)))
      .limit(1)
    if (category[0]?.kind !== flow) finish('rules', 'error', '카테고리와 거래 유형이 맞지 않습니다.')
  }
  if (accountId !== null) {
    const account = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.householdId, household.householdId), eq(accounts.id, accountId)))
      .limit(1)
    if (!account[0]) finish('rules', 'error', '가족 가계부의 결제수단이 아닙니다.')
  }
  await db
    .update(categoryRules)
    .set({ categoryId, accountId, flow, fixed: flow === 'expense' ? formData.get('fixed') === 'on' : false, priority })
    .where(and(eq(categoryRules.householdId, household.householdId), eq(categoryRules.id, id)))
  revalidatePath('/manage')
  revalidatePath('/inbox')
  finish('rules', 'saved', '분류 규칙을 저장했습니다.')
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
    const pattern = normalizeMerchant(transaction[0].rawMerchant || transaction[0].memo || '')
    if (pattern) {
      await tx
        .insert(categoryRules)
        .values({
          householdId: household.householdId,
          matchType: 'merchant_norm',
          pattern,
          categoryId,
          flow: transaction[0].flow,
          fixed: transaction[0].flow === 'expense' ? formData.get('fixed') === 'on' : false,
          priority: 100,
          hits: 1,
        })
        .onConflictDoUpdate({
          target: [categoryRules.householdId, categoryRules.matchType, categoryRules.pattern],
          set: {
            categoryId,
            flow: transaction[0].flow,
            fixed: transaction[0].flow === 'expense' ? formData.get('fixed') === 'on' : false,
            hits: sql`${categoryRules.hits} + 1`,
          },
        })
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

      const pattern = normalizeMerchant(row.rawMerchant || row.memo || '')
      if (!pattern) continue
      await tx
        .insert(categoryRules)
        .values({
          householdId: household.householdId,
          matchType: 'merchant_norm',
          pattern,
          categoryId: classification.categoryId,
          flow: classification.flow,
          fixed: classification.fixed,
          priority: 100,
          hits: 1,
        })
        .onConflictDoUpdate({
          target: [categoryRules.householdId, categoryRules.matchType, categoryRules.pattern],
          set: {
            categoryId: classification.categoryId,
            flow: classification.flow,
            fixed: classification.fixed,
            hits: sql`${categoryRules.hits} + 1`,
          },
        })
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

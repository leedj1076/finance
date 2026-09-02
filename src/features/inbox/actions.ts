'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  importBatches,
  importInbox,
  transactions,
} from '@/db/schema'
import { requireHousehold } from '@/lib/household'

import type { TransactionFlow } from './banksalad'
import { merchantLookupUpsertStatement } from './merchant-lookup'
import { normalizeMerchant } from './normalize'
import { cardSourceFromMarker } from './parsers/cards'
import { refreshDuplicateFlags } from './staging'

function inboxRedirect(kind: 'notice' | 'error', message: string): never {
  redirect(`/inbox?${kind}=${encodeURIComponent(message)}`)
}

function selectedIds(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll('ids')
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ]
}

function parseOptionalId(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseFlow(value: FormDataEntryValue | null): TransactionFlow | null {
  return value === 'expense' || value === 'income' || value === 'saving' ? value : null
}

type InboxRow = typeof importInbox.$inferSelect

type PreparedInboxRow = {
  row: InboxRow
  flow: TransactionFlow
  categoryId: number | null
  accountId: number | null
  source: string
}

type ApplyResult = {
  processed: number
  inserted: number
  income: number
  expense: number
  saving: number
}

export type ApplyInboxItemInput = {
  id: number
  flow: TransactionFlow
  categoryId: number | null
  accountId: number | null
}

export type ApplyInboxItemResult = {
  error?: string
  applied?: boolean
  message?: string
}

function inboxTransactionSource(row: InboxRow) {
  return cardSourceFromMarker(row.bsCat1) ?? `banksalad:${row.owner.toLowerCase()}`
}

/** Shared apply path for reviewed rows and high-confidence bulk approval. */
async function applyPreparedInboxRows(
  householdId: string,
  prepared: PreparedInboxRow[],
): Promise<ApplyResult> {
  const result = await db.transaction(async (tx) => {
    const sources = new Set(prepared.map((item) => item.source))
    const batchSource = [...sources].every((source) => source.startsWith('banksalad:'))
      ? 'banksalad'
      : sources.size === 1 ? [...sources][0] : 'inbox'
    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId,
        source: batchSource,
        filename: 'inbox',
      })
      .returning({ id: importBatches.id })

    const inserted = await tx
      .insert(transactions)
      .values(
        prepared.map(({ row, flow, categoryId, accountId, source }) => ({
          householdId,
          date: row.date,
          flow,
          fixed: false,
          categoryId,
          memo: row.merchant || row.memo || '',
          amount: row.amount,
          accountId,
          source,
          rawMerchant: row.merchant,
          importBatchId: batch.id,
          importUid: row.importUid,
        })),
      )
      .onConflictDoNothing({ target: [transactions.householdId, transactions.importUid] })
      .returning({ importUid: transactions.importUid })

    const insertedUids = new Set(
      inserted.map((row) => row.importUid).filter((uid): uid is string => Boolean(uid)),
    )
    const insertedRows = prepared.filter(({ row }) => insertedUids.has(row.importUid))

    const aliases = new Map<string, { owner: string; alias: string; accountId: number }>()
    for (const item of insertedRows) {
      if (
        item.row.pay &&
        item.accountId !== null &&
        item.accountId !== item.row.accountId
      ) {
        aliases.set(`${item.row.owner}|${item.row.pay}`, {
          owner: item.row.owner,
          alias: item.row.pay,
          accountId: item.accountId,
        })
      }
    }

    if (aliases.size > 0) {
      await tx
        .insert(accountAliases)
        .values(
          [...aliases.values()].map((alias) => ({ householdId, ...alias })),
        )
        .onConflictDoUpdate({
          target: [
            accountAliases.householdId,
            accountAliases.owner,
            accountAliases.alias,
          ],
          set: { accountId: sql`excluded.account_id` },
        })
    }

    for (const item of insertedRows) {
      const merchant = item.row.merchant ?? ''
      const normMerchant = normalizeMerchant(merchant)
      if (!normMerchant || item.categoryId === null) continue
      await tx.execute(
        merchantLookupUpsertStatement(
          householdId,
          {
            normMerchant,
            displayMerchant: merchant,
            categoryId: item.categoryId,
            flow: item.flow,
          },
          'user',
        ),
      )
    }

    await tx
      .update(importInbox)
      .set({ status: 'done' })
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
          inArray(importInbox.id, prepared.map(({ row }) => row.id)),
        ),
      )
    await tx
      .update(importBatches)
      .set({ rowCount: insertedRows.length })
      .where(
        and(eq(importBatches.householdId, householdId), eq(importBatches.id, batch.id)),
      )

    return { insertedRows }
  })

  await refreshDuplicateFlags(householdId)
  revalidatePath('/inbox')
  revalidatePath('/ledger')

  return {
    processed: prepared.length,
    inserted: result.insertedRows.length,
    income: result.insertedRows
      .filter((item) => item.flow === 'income')
      .reduce((sum, item) => sum + item.row.amount, 0),
    expense: result.insertedRows
      .filter((item) => item.flow === 'expense')
      .reduce((sum, item) => sum + item.row.amount, 0),
    saving: result.insertedRows
      .filter((item) => item.flow === 'saving')
      .reduce((sum, item) => sum + item.row.amount, 0),
  }
}

export async function processInbox(formData: FormData) {
  const household = await requireHousehold()
  if (!household) inboxRedirect('error', '가족 가계부에 연결된 계정이 아닙니다.')

  const ids = selectedIds(formData)
  if (ids.length === 0) inboxRedirect('error', '선택된 항목이 없습니다.')
  if (ids.length > 500) inboxRedirect('error', '한 번에 최대 500건까지 처리할 수 있습니다.')

  const householdId = household.householdId
  const intent = formData.get('intent') === 'dismiss' ? 'dismiss' : 'apply'

  if (intent === 'dismiss') {
    const dismissed = await db
      .update(importInbox)
      .set({ status: 'dismissed' })
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
          inArray(importInbox.id, ids),
        ),
      )
      .returning({ id: importInbox.id })
    await refreshDuplicateFlags(householdId)
    revalidatePath('/inbox')
    inboxRedirect('notice', `${dismissed.length}건을 인박스에서 제외했습니다.`)
  }

  const [rows, categoryRows, accountRows] = await Promise.all([
    db
      .select()
      .from(importInbox)
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
          inArray(importInbox.id, ids),
        ),
      ),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.householdId, householdId)),
  ])
  if (rows.length === 0) inboxRedirect('error', '처리할 대기 거래를 찾지 못했습니다.')

  const categoriesById = new Map(categoryRows.map((category) => [category.id, category]))
  const accountIds = new Set(accountRows.map((account) => account.id))
  const prepared = rows.map((row) => {
    const flow = parseFlow(formData.get(`flow_${row.id}`))
    if (!flow) inboxRedirect('error', `${row.id}번 거래의 유형이 올바르지 않습니다.`)

    const requestedCategoryId = parseOptionalId(formData.get(`category_${row.id}`))
    const category = requestedCategoryId === null ? null : categoriesById.get(requestedCategoryId)
    if (requestedCategoryId !== null && (!category || category.kind !== flow)) {
      inboxRedirect('error', `${row.id}번 거래의 분류가 거래 유형과 맞지 않습니다.`)
    }

    const requestedAccountId = parseOptionalId(formData.get(`account_${row.id}`))
    if (requestedAccountId !== null && !accountIds.has(requestedAccountId)) {
      inboxRedirect('error', `${row.id}번 거래의 결제수단을 확인해 주세요.`)
    }

    return {
      row,
      flow,
      categoryId: requestedCategoryId,
      accountId: requestedAccountId,
      source: inboxTransactionSource(row),
    }
  })

  const result = await applyPreparedInboxRows(householdId, prepared)
  const amounts = [
    result.expense ? `지출 ${result.expense.toLocaleString('ko-KR')}원` : '',
    result.income ? `수입 ${result.income.toLocaleString('ko-KR')}원` : '',
    result.saving ? `저축 ${result.saving.toLocaleString('ko-KR')}원` : '',
  ].filter(Boolean)
  const skipped = result.processed - result.inserted
  const suffix = [amounts.join(' / '), skipped ? `이미 반영된 ${skipped}건` : '']
    .filter(Boolean)
    .join(' · ')
  inboxRedirect('notice', `${result.inserted}건을 가계부에 반영했습니다${suffix ? ` (${suffix})` : ''}.`)
}

/** Applies one row with the values currently shown in the inbox, without a page redirect. */
export async function applyInboxItem(
  input: ApplyInboxItemInput,
): Promise<ApplyInboxItemResult> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  if (!Number.isSafeInteger(input.id) || input.id <= 0) {
    return { error: '반영할 거래를 확인해 주세요.' }
  }
  if (input.flow !== 'expense' && input.flow !== 'income' && input.flow !== 'saving') {
    return { error: '거래 유형을 확인해 주세요.' }
  }
  if (
    input.categoryId !== null &&
    (!Number.isSafeInteger(input.categoryId) || input.categoryId <= 0)
  ) {
    return { error: '거래 분류를 확인해 주세요.' }
  }
  if (
    input.accountId !== null &&
    (!Number.isSafeInteger(input.accountId) || input.accountId <= 0)
  ) {
    return { error: '결제수단을 확인해 주세요.' }
  }

  const householdId = household.householdId
  const [rows, categoryRows, accountRows] = await Promise.all([
    db
      .select()
      .from(importInbox)
      .where(
        and(
          eq(importInbox.id, input.id),
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
        ),
      )
      .limit(1),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.householdId, householdId)),
  ])
  const row = rows[0]
  if (!row) return { error: '이미 처리됐거나 찾을 수 없는 거래입니다.' }

  if (input.categoryId !== null) {
    const category = categoryRows.find((candidate) => candidate.id === input.categoryId)
    if (!category || category.kind !== input.flow) {
      return { error: '분류가 거래 유형과 맞지 않습니다.' }
    }
  }
  if (
    input.accountId !== null &&
    !accountRows.some((account) => account.id === input.accountId)
  ) {
    return { error: '결제수단을 확인해 주세요.' }
  }

  try {
    const result = await applyPreparedInboxRows(householdId, [{
      row,
      flow: input.flow,
      categoryId: input.categoryId,
      accountId: input.accountId,
      source: inboxTransactionSource(row),
    }])
    const applied = result.inserted === 1
    return {
      applied: true,
      message: applied ? '가계부에 반영했습니다.' : '이미 가계부에 반영된 거래입니다.',
    }
  } catch {
    return { error: '거래를 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

export async function approveHighConfidence(): Promise<{ error?: string; applied?: number }> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const householdId = household.householdId
  const [rows, categoryRows, accountRows] = await Promise.all([
    db
      .select()
      .from(importInbox)
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
          eq(importInbox.confidence, 'high'),
        ),
      )
      .orderBy(importInbox.id),
    db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.householdId, householdId)),
  ])
  if (rows.length === 0) return { applied: 0 }

  const categoriesById = new Map(categoryRows.map((category) => [category.id, category]))
  const accountIds = new Set(accountRows.map((account) => account.id))
  const prepared: PreparedInboxRow[] = []
  for (const row of rows) {
    const category = row.categoryId === null ? null : categoriesById.get(row.categoryId)
    if (!category || category.kind !== row.flow) {
      return { error: `${row.id}번 거래의 저장된 분류를 확인해 주세요.` }
    }
    if (row.accountId !== null && !accountIds.has(row.accountId)) {
      return { error: `${row.id}번 거래의 저장된 결제수단을 확인해 주세요.` }
    }
    prepared.push({
      row,
      flow: row.flow,
      categoryId: row.categoryId,
      accountId: row.accountId,
      source: inboxTransactionSource(row),
    })
  }

  try {
    const result = await applyPreparedInboxRows(householdId, prepared)
    return { applied: result.inserted }
  } catch {
    return { error: '자동 분류 거래를 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

export async function demoteToReview(
  id: number,
): Promise<{ error?: string; demoted?: boolean }> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '거래를 확인해 주세요.' }

  const updated = await db
    .update(importInbox)
    .set({ confidence: 'review' })
    .where(
      and(
        eq(importInbox.id, id),
        eq(importInbox.householdId, household.householdId),
        eq(importInbox.status, 'pending'),
      ),
    )
    .returning({ id: importInbox.id })
  if (updated.length === 0) return { error: '수정할 대기 거래를 찾지 못했습니다.' }

  revalidatePath('/inbox')
  return { demoted: true }
}

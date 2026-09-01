'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  categoryRules,
  importBatches,
  importInbox,
  transactions,
} from '@/db/schema'
import { requireHousehold } from '@/lib/household'

import { normalizeMerchant, type TransactionFlow } from './banksalad'
import { refreshDuplicateFlags } from './upload-action'

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

export async function processInbox(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

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
    }
  })

  const result = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId,
        source: 'banksalad',
        filename: 'inbox',
      })
      .returning({ id: importBatches.id })

    const inserted = await tx
      .insert(transactions)
      .values(
        prepared.map(({ row, flow, categoryId, accountId }) => ({
          householdId,
          date: row.date,
          flow,
          fixed: false,
          categoryId,
          memo: row.merchant || row.memo || '',
          amount: row.amount,
          accountId,
          source: `banksalad:${row.owner.toLowerCase()}`,
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

    const rules = new Map<
      string,
      { pattern: string; categoryId: number; flow: TransactionFlow; hits: number }
    >()
    const aliases = new Map<string, { owner: string; alias: string; accountId: number }>()
    for (const item of insertedRows) {
      const merchant = item.row.merchant ?? ''
      const pattern = normalizeMerchant(merchant)
      if (pattern && item.categoryId !== null) {
        const previous = rules.get(pattern)
        rules.set(pattern, {
          pattern,
          categoryId: item.categoryId,
          flow: item.flow,
          hits: (previous?.hits ?? 0) + 1,
        })
      }
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

    if (rules.size > 0) {
      await tx
        .insert(categoryRules)
        .values(
          [...rules.values()].map((rule) => ({
            householdId,
            matchType: 'merchant_norm',
            pattern: rule.pattern,
            categoryId: rule.categoryId,
            flow: rule.flow,
            priority: 100,
            hits: rule.hits,
          })),
        )
        .onConflictDoUpdate({
          target: [
            categoryRules.householdId,
            categoryRules.matchType,
            categoryRules.pattern,
          ],
          set: {
            categoryId: sql`excluded.category_id`,
            flow: sql`excluded.flow`,
            hits: sql`${categoryRules.hits} + excluded.hits`,
          },
        })
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

    await tx
      .update(importInbox)
      .set({ status: 'done' })
      .where(
        and(
          eq(importInbox.householdId, householdId),
          inArray(importInbox.id, rows.map((row) => row.id)),
        ),
      )
    await tx
      .update(importBatches)
      .set({ rowCount: insertedRows.length })
      .where(
        and(eq(importBatches.householdId, householdId), eq(importBatches.id, batch.id)),
      )

    return {
      processed: rows.length,
      inserted: insertedRows.length,
      income: insertedRows
        .filter((item) => item.flow === 'income')
        .reduce((sum, item) => sum + item.row.amount, 0),
      expense: insertedRows
        .filter((item) => item.flow === 'expense')
        .reduce((sum, item) => sum + item.row.amount, 0),
      saving: insertedRows
        .filter((item) => item.flow === 'saving')
        .reduce((sum, item) => sum + item.row.amount, 0),
    }
  })

  await refreshDuplicateFlags(householdId)
  revalidatePath('/inbox')
  revalidatePath('/ledger')
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

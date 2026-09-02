import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  importInbox,
  settings,
  transactions,
} from '@/db/schema'

import {
  buildAmountRepeatIndex,
  buildHistorySuggester,
  duplicateMerchantSimilar,
  type HistoryRow,
  type TransactionFlow,
} from './banksalad'
import { resolveSuggestions } from './resolve-suggestion'

export const MAX_FILE_BYTES = 2 * 1024 * 1024

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '파일을 읽는 중 알 수 없는 오류가 발생했습니다.'
}

type DuplicateInboxRow = {
  id: number
  date: string
  merchant: string | null
  amount: number
  flow: TransactionFlow
}

type DuplicateTransactionRow = {
  id: number
  date: string
  merchant: string
  amount: number
  flow: TransactionFlow
  source: string
}

function duplicateKey(row: { date: string; amount: number; flow: TransactionFlow }) {
  return `${row.date}|${row.amount}|${row.flow}`
}

export async function refreshDuplicateFlags(householdId: string) {
  const [pending, transactionRows] = await Promise.all([
    db
      .select({
        id: importInbox.id,
        date: importInbox.date,
        merchant: importInbox.merchant,
        amount: importInbox.amount,
        flow: importInbox.flow,
      })
      .from(importInbox)
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
        ),
      )
      .orderBy(importInbox.date, importInbox.amount, importInbox.id),
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        merchant: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), ${transactions.memo}, '')`,
        amount: transactions.amount,
        flow: transactions.flow,
        source: transactions.source,
      })
      .from(transactions)
      .where(eq(transactions.householdId, householdId))
      .orderBy(transactions.id),
  ]) as [DuplicateInboxRow[], DuplicateTransactionRow[]]

  const byKey = new Map<string, DuplicateTransactionRow[]>()
  for (const row of transactionRows) {
    const key = duplicateKey(row)
    byKey.set(key, [...(byKey.get(key) ?? []), row])
  }

  const claimed = new Set<number>()
  const notes = new Map<number, string>()
  for (const row of pending) {
    const match = (byKey.get(duplicateKey(row)) ?? []).find(
      (candidate) =>
        !claimed.has(candidate.id) && duplicateMerchantSimilar(row.merchant, candidate.merchant),
    )
    if (!match) continue
    claimed.add(match.id)
    notes.set(
      row.id,
      `가계부에 이미 있음: ${match.merchant.slice(0, 20)} (${match.source})`,
    )
  }

  await db.transaction(async (tx) => {
    await tx
      .update(importInbox)
      .set({ dupNote: null })
      .where(
        and(
          eq(importInbox.householdId, householdId),
          eq(importInbox.status, 'pending'),
        ),
      )
    for (const [id, dupNote] of notes) {
      await tx
        .update(importInbox)
        .set({ dupNote, confidence: 'review' })
        .where(and(eq(importInbox.householdId, householdId), eq(importInbox.id, id)))
    }
  })

  return notes.size
}

export async function loadStagingContext(householdId: string) {
  const [
    transactionUidRows,
    inboxUidRows,
    categoryRows,
    aliasRows,
    historyRows,
    aiSettingRows,
  ] = await Promise.all([
    db
      .select({ importUid: transactions.importUid })
      .from(transactions)
      .where(and(eq(transactions.householdId, householdId), isNotNull(transactions.importUid))),
    db
      .select({ importUid: importInbox.importUid })
      .from(importInbox)
      .where(eq(importInbox.householdId, householdId)),
    db
      .select({
        id: categories.id,
        kind: categories.kind,
        major: categories.major,
        sub: categories.sub,
      })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.hidden, false)))
      .orderBy(categories.sortOrder, asc(categories.major), asc(categories.sub)),
    db
      .select({
        owner: accountAliases.owner,
        alias: accountAliases.alias,
        accountId: accountAliases.accountId,
      })
      .from(accountAliases)
      .innerJoin(
        accounts,
        and(eq(accounts.id, accountAliases.accountId), eq(accounts.householdId, householdId)),
      )
      .where(eq(accountAliases.householdId, householdId)),
    db
      .select({
        flow: transactions.flow,
        fixed: transactions.fixed,
        major: categories.major,
        sub: categories.sub,
        rawMerchant: transactions.rawMerchant,
        memo: transactions.memo,
        date: transactions.date,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .innerJoin(
        categories,
        and(eq(categories.id, transactions.categoryId), eq(categories.householdId, householdId)),
      )
      .where(eq(transactions.householdId, householdId))
      .orderBy(desc(transactions.date), desc(transactions.id)),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(
        and(
          eq(settings.householdId, householdId),
          eq(settings.key, 'ai_fallback_enabled'),
        ),
      )
      .limit(1),
  ])

  const doneUids = new Set([
    ...transactionUidRows.map((row) => row.importUid).filter((uid): uid is string => Boolean(uid)),
    ...inboxUidRows.map((row) => row.importUid),
  ])
  const aliases = new Map(aliasRows.map((row) => [`${row.owner}|${row.alias}`, row.accountId]))
  const categoriesByMajor = new Map<string, typeof categoryRows>()
  const categoriesById = new Map(categoryRows.map((row) => [row.id, row]))
  for (const category of categoryRows) {
    const key = `${category.kind}|${category.major}`
    categoriesByMajor.set(key, [...(categoriesByMajor.get(key) ?? []), category])
  }
  const history: HistoryRow[] = historyRows
    .map((row) => ({
      flow: row.flow,
      fixed: row.fixed,
      major: row.major,
      sub: row.sub,
      merchant: row.rawMerchant || row.memo || '',
      date: row.date,
    }))
    .filter((row) => row.merchant)
  const amountRepeatIndex = buildAmountRepeatIndex(
    historyRows
      .map((row) => ({
        merchant: row.rawMerchant || row.memo || '',
        amount: row.amount,
        categoryId: row.categoryId,
      }))
      .filter((row) => row.merchant),
  )
  const categoryIdByTaxonomy = new Map(
    categoryRows.map((row) => [`${row.kind}|${row.major}|${row.sub}`, row.id]),
  )

  return {
    aiSetting: aiSettingRows[0]?.value ?? null,
    aliases,
    categoriesById,
    categoriesByMajor,
    categoryRows,
    doneUids,
    amountRepeatIndex,
    examples: historyRows
      .filter((row) => row.categoryId !== null && categoriesById.has(row.categoryId))
      .map((row) => ({
        merchant: row.rawMerchant || row.memo || '',
        major: row.major,
        sub: row.sub,
      }))
      .filter((row) => row.merchant)
      .slice(0, 20),
    findCategoryId: (flow: string, major: string, sub: string) =>
      categoryIdByTaxonomy.get(`${flow}|${major}|${sub}`) ?? null,
    suggestFromHistory: buildHistorySuggester(history),
    taxonomy: categoryRows.map((row) => ({
      flow: row.kind,
      major: row.major,
      sub: row.sub,
    })),
  }
}

export type StagingContext = Awaited<ReturnType<typeof loadStagingContext>>

export type SuggestionCandidate = {
  merchant: string
  amount: number
  baseFlow: TransactionFlow
  bsSuggestCategoryId: number | null
  lockFlow?: boolean
}

export async function resolveStagingSuggestions(
  householdId: string,
  context: StagingContext,
  items: SuggestionCandidate[],
  taxonomy = context.taxonomy,
) {
  return resolveSuggestions({
    householdId,
    items,
    historySuggest: context.suggestFromHistory,
    amountRepeatIndex: context.amountRepeatIndex,
    taxonomy,
    examples: context.examples,
    findCategoryId: context.findCategoryId,
    aiSetting: context.aiSetting,
  })
}

export async function insertInboxRows(
  householdId: string,
  values: Array<typeof importInbox.$inferInsert>,
) {
  const inserted: Array<{ id: number; owner: string }> = []
  for (let index = 0; index < values.length; index += 500) {
    const rows = await db
      .insert(importInbox)
      .values(values.slice(index, index + 500).map((value) => ({ ...value, householdId })))
      .onConflictDoNothing({ target: [importInbox.householdId, importInbox.importUid] })
      .returning({ id: importInbox.id, owner: importInbox.owner })
    inserted.push(...rows)
  }
  return inserted
}

export async function summarizeInsertedConfidence(householdId: string, ids: number[]) {
  if (ids.length === 0) return { automatic: 0, review: 0 }
  const rows = await db
    .select({ confidence: importInbox.confidence })
    .from(importInbox)
    .where(
      and(
        eq(importInbox.householdId, householdId),
        inArray(importInbox.id, ids),
      ),
    )
  const automatic = rows.filter((row) => row.confidence === 'high').length
  return { automatic, review: rows.length - automatic }
}

'use server'

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  importInbox,
  transactions,
} from '@/db/schema'
import { requireHousehold } from '@/lib/household'

import {
  banksaladFingerprint,
  buildHistorySuggester,
  classifyBanksaladRow,
  duplicateMerchantSimilar,
  parseBanksaladWorkbook,
  type BanksaladOwner,
  type HistoryRow,
  type TransactionFlow,
} from './banksalad'

const COMMIT_CUTOFF = '2026-06-01'
const HISTORY_END = '2026-01-01'
const MAX_FILE_BYTES = 2 * 1024 * 1024

export type UploadBanksaladState = {
  error?: string
  message?: string
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
        .set({ dupNote })
        .where(and(eq(importInbox.householdId, householdId), eq(importInbox.id, id)))
    }
  })

  return notes.size
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '파일을 읽는 중 알 수 없는 오류가 발생했습니다.'
}

export async function uploadBanksaladFiles(
  _previousState: UploadBanksaladState,
  formData: FormData,
): Promise<UploadBanksaladState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const files = formData
    .getAll('files')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)

  if (files.length === 0) return { error: '뱅크샐러드 엑셀 파일을 선택해 주세요.' }
  if (files.length > 2) return { error: 'DJ와 YJ 파일을 최대 2개까지 한 번에 올릴 수 있습니다.' }
  if (files.some((file) => !file.name.toLowerCase().endsWith('.xlsx'))) {
    return { error: '.xlsx 형식의 뱅크샐러드 파일만 올릴 수 있습니다.' }
  }
  if (files.some((file) => file.size > MAX_FILE_BYTES)) {
    return { error: '파일 하나의 크기는 2MB 이하여야 합니다.' }
  }

  let parsedFiles
  try {
    parsedFiles = await Promise.all(
      files.map(async (file) => parseBanksaladWorkbook(Buffer.from(await file.arrayBuffer()))),
    )
  } catch (error) {
    return { error: `파일을 읽지 못했습니다: ${errorMessage(error)}` }
  }

  const duplicateOwners = parsedFiles
    .map((file) => file.owner)
    .filter((owner, index, owners) => owners.indexOf(owner) !== index)
  if (duplicateOwners.length > 0) {
    return { error: `${duplicateOwners.join(', ')} 파일이 두 번 선택되었습니다.` }
  }

  const householdId = household.householdId
  const [transactionUidRows, inboxUidRows, categoryRows, aliasRows, historyRows] = await Promise.all([
    db
      .select({ importUid: transactions.importUid })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNotNull(transactions.importUid),
        ),
      ),
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
      .select({ owner: accountAliases.owner, alias: accountAliases.alias, accountId: accountAliases.accountId })
      .from(accountAliases)
      .innerJoin(
        accounts,
        and(
          eq(accounts.id, accountAliases.accountId),
          eq(accounts.householdId, householdId),
        ),
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
      })
      .from(transactions)
      .innerJoin(
        categories,
        and(
          eq(categories.id, transactions.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .where(eq(transactions.householdId, householdId)),
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
  const suggestFromHistory = buildHistorySuggester(history)

  const values: Array<typeof importInbox.$inferInsert> = []
  const excluded = new Map<string, number>()
  const owners: Record<BanksaladOwner, number> = { DJ: 0, YJ: 0 }
  let alreadyProcessed = 0
  let oldPeriod = 0
  let skippedForeignCurrency = 0

  for (const parsed of parsedFiles) {
    skippedForeignCurrency += parsed.skippedForeignCurrency
    for (const row of parsed.rows) {
      const uid = banksaladFingerprint(parsed.owner, row)
      if (row.date < HISTORY_END) continue
      if (row.date < COMMIT_CUTOFF) {
        if (doneUids.has(uid)) alreadyProcessed += 1
        else oldPeriod += 1
        continue
      }
      if (doneUids.has(uid)) {
        alreadyProcessed += 1
        continue
      }

      const classification = classifyBanksaladRow(row)
      if (classification.action === 'exclude') {
        excluded.set(classification.reason, (excluded.get(classification.reason) ?? 0) + 1)
        continue
      }

      const kind = classification.action === 'transfer_candidate' ? 'transfer' : 'normal'
      const baseFlow: TransactionFlow = classification.action === 'transfer_candidate'
        ? row.amount > 0 ? 'income' : 'expense'
        : classification.action
      const historical = suggestFromHistory(row.merchant)
      let flow = baseFlow
      let categoryId: number | null = null
      let sugSource: string | null = null

      if (historical && (kind === 'normal' || historical.flow === baseFlow)) {
        flow = kind === 'normal' ? historical.flow : baseFlow
        categoryId = categoryRows.find(
          (category) =>
            category.kind === flow &&
            category.major === historical.major &&
            category.sub === historical.sub,
        )?.id ?? null
        if (categoryId !== null) sugSource = 'history'
      }

      if (categoryId === null && classification.suggestMajor) {
        const options = categoriesByMajor.get(`${flow}|${classification.suggestMajor}`) ?? []
        const category = options.find((option) => option.sub === '기타') ?? options[0]
        if (category) {
          categoryId = category.id
          sugSource = 'banksalad'
        }
      }

      if (categoryId !== null && categoriesById.get(categoryId)?.kind !== flow) categoryId = null
      values.push({
        householdId,
        importUid: uid,
        owner: parsed.owner,
        date: row.date,
        time: row.time,
        merchant: row.merchant,
        amount: Math.abs(row.amount),
        flow,
        kind,
        bsCat1: row.cat1,
        bsCat2: row.cat2,
        pay: row.pay,
        accountId: row.pay ? aliases.get(`${parsed.owner}|${row.pay}`) ?? null : null,
        categoryId,
        memo: row.memo ?? '',
        sugSource,
      })
      doneUids.add(uid)
    }
  }

  const inserted: Array<{ owner: string }> = []
  for (let index = 0; index < values.length; index += 500) {
    const rows = await db
      .insert(importInbox)
      .values(values.slice(index, index + 500))
      .onConflictDoNothing({ target: [importInbox.householdId, importInbox.importUid] })
      .returning({ owner: importInbox.owner })
    inserted.push(...rows)
  }
  for (const row of inserted) {
    if (row.owner === 'DJ' || row.owner === 'YJ') owners[row.owner] += 1
  }

  const duplicateCount = await refreshDuplicateFlags(householdId)
  revalidatePath('/inbox')
  revalidatePath('/ledger')

  const excludedCount = [...excluded.values()].reduce((sum, count) => sum + count, 0)
  const details = [
    `인박스에 ${inserted.length}건 추가 (DJ ${owners.DJ} / YJ ${owners.YJ})`,
    `이미 처리 ${alreadyProcessed}건`,
  ]
  if (excludedCount) details.push(`자동 제외 ${excludedCount}건`)
  if (oldPeriod) details.push(`기존 이관기간 ${oldPeriod}건`)
  if (skippedForeignCurrency) details.push(`외화 ${skippedForeignCurrency}건`)
  if (duplicateCount) details.push(`중복 의심 ${duplicateCount}건`)

  return { message: details.join(' · ') }
}

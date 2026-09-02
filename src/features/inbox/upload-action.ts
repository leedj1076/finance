'use server'

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db/client'
import {
  accountAliases,
  accounts,
  categories,
  importInbox,
  settings,
  transactions,
} from '@/db/schema'
import { requireHousehold } from '@/lib/household'

import { upsertBanksaladAssetSnapshots } from './asset-snapshots'
import { suggestCardAccountId } from './account-match'
import {
  banksaladFingerprint,
  buildAmountRepeatIndex,
  buildHistorySuggester,
  classifyBanksaladRow,
  duplicateMerchantSimilar,
  parseBanksaladWorkbook,
  type BanksaladOwner,
  type HistoryRow,
  type TransactionFlow,
} from './banksalad'
import { assessConfidence } from './confidence'
import {
  CARD_ISSUERS,
  cardFingerprint,
  cardSourceMarker,
  looksLikeBanksalad,
  parseCardStatement,
  type CardIssuer,
  type CardRow,
} from './parsers/cards'
import { resolveSuggestions } from './resolve-suggestion'

const COMMIT_CUTOFF = '2026-06-01'
const HISTORY_END = '2026-01-01'
const MAX_FILE_BYTES = 2 * 1024 * 1024

export type UploadBanksaladState = {
  error?: string
  message?: string
}

export type UploadCardState = UploadBanksaladState

function cardPaymentSource(row: CardRow, issuerLabel: string) {
  const parsed = row.pay?.trim()
  return parsed && !/^(?:본인|가족)?카드$/.test(parsed) ? parsed : issuerLabel
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '파일을 읽는 중 알 수 없는 오류가 발생했습니다.'
}

async function loadStagingContext(householdId: string) {
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

type StagingContext = Awaited<ReturnType<typeof loadStagingContext>>

type SuggestionCandidate = {
  merchant: string
  amount: number
  baseFlow: TransactionFlow
  bsSuggestCategoryId: number | null
  lockFlow?: boolean
}

async function resolveStagingSuggestions(
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

async function insertInboxRows(
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

async function summarizeInsertedConfidence(householdId: string, ids: number[]) {
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
  const assetOptions = formData.getAll('asset_include').map(String)
  const includeAssets = assetOptions.length === 0 || assetOptions.includes('on')
  const stagingContext = await loadStagingContext(householdId)
  const {
    aliases,
    categoriesById,
    categoriesByMajor,
    doneUids,
  } = stagingContext

  type BanksaladCandidate = {
    owner: BanksaladOwner
    row: (typeof parsedFiles)[number]['rows'][number]
    uid: string
    kind: 'normal' | 'transfer'
    baseFlow: TransactionFlow
    bsSuggestCategoryId: number | null
  }
  const candidates: BanksaladCandidate[] = []
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
      const options = classification.suggestMajor
        ? categoriesByMajor.get(`${baseFlow}|${classification.suggestMajor}`) ?? []
        : []
      const fallback = options.find((option) => option.sub === '기타') ?? options[0]
      candidates.push({
        owner: parsed.owner,
        row,
        uid,
        kind,
        baseFlow,
        bsSuggestCategoryId: fallback?.id ?? null,
      })
      doneUids.add(uid)
    }
  }

  const suggestions = await resolveStagingSuggestions(
    householdId,
    stagingContext,
    candidates.map((candidate) => ({
      merchant: candidate.row.merchant,
      amount: Math.abs(candidate.row.amount),
      baseFlow: candidate.baseFlow,
      bsSuggestCategoryId: candidate.bsSuggestCategoryId,
      lockFlow: candidate.kind === 'transfer',
    })),
  )
  const values: Array<typeof importInbox.$inferInsert> = candidates.map((candidate, index) => {
    const suggestion = suggestions[index]
    const flow = candidate.kind === 'transfer' ? candidate.baseFlow : suggestion.flow
    const suggestedCategory = suggestion.categoryId === null
      ? null
      : categoriesById.get(suggestion.categoryId)
    const categoryId = suggestedCategory?.kind === flow ? suggestion.categoryId : null
    const sugSource = categoryId === null ? null : suggestion.sugSource
    return {
      householdId,
      importUid: candidate.uid,
      owner: candidate.owner,
      date: candidate.row.date,
      time: candidate.row.time,
      merchant: candidate.row.merchant,
      amount: Math.abs(candidate.row.amount),
      flow,
      kind: candidate.kind,
      bsCat1: candidate.row.cat1,
      bsCat2: candidate.row.cat2,
      pay: candidate.row.pay,
      accountId: candidate.row.pay
        ? aliases.get(`${candidate.owner}|${candidate.row.pay}`) ?? null
        : null,
      categoryId,
      memo: candidate.row.memo ?? '',
      sugSource,
      confidence: assessConfidence({
        sugSource,
        historyMatch: suggestion.historyMatch,
        alwaysConfirm: suggestion.alwaysConfirm,
        hasDup: false,
        kind: candidate.kind,
        categoryId,
        exactAmountRepeat: suggestion.exactAmountRepeat,
      }),
    }
  })

  const inserted = await insertInboxRows(householdId, values)
  for (const row of inserted) {
    if (row.owner === 'DJ' || row.owner === 'YJ') owners[row.owner] += 1
  }

  const duplicateCount = await refreshDuplicateFlags(householdId)
  const confidenceSummary = await summarizeInsertedConfidence(
    householdId,
    inserted.map((row) => row.id),
  )
  const latestDate = parsedFiles
    .flatMap((parsed) => parsed.rows.map((row) => row.date))
    .sort()
    .at(-1)
  const snapshotMonth = latestDate?.slice(0, 7)
    ?? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7)
  const assetUpdated = includeAssets
    ? await upsertBanksaladAssetSnapshots(
      householdId,
      parsedFiles.map((parsed) => parsed.status),
      snapshotMonth,
    )
    : 0
  revalidatePath('/inbox')
  revalidatePath('/ledger')
  if (assetUpdated) {
    revalidatePath('/assets')
    revalidatePath('/dashboard')
  }

  const excludedCount = [...excluded.values()].reduce((sum, count) => sum + count, 0)
  const details = [
    `인박스에 ${inserted.length}건 추가 (DJ ${owners.DJ} / YJ ${owners.YJ})`,
    `이미 처리 ${alreadyProcessed}건`,
    `자동 분류 ${confidenceSummary.automatic}건`,
    `확인 필요 ${confidenceSummary.review}건`,
  ]
  if (excludedCount) details.push(`자동 제외 ${excludedCount}건`)
  if (oldPeriod) details.push(`기존 이관기간 ${oldPeriod}건`)
  if (skippedForeignCurrency) details.push(`외화 ${skippedForeignCurrency}건`)
  if (duplicateCount) details.push(`중복 의심 ${duplicateCount}건`)
  if (assetUpdated) details.push(`자산 ${assetUpdated}항목 업데이트`)

  return { message: details.join(' · ') }
}

export async function uploadCardStatement(formData: FormData): Promise<UploadCardState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const file = formData.get('file')
  const issuer = String(formData.get('issuer') ?? '') as CardIssuer
  const owner = String(formData.get('owner') ?? '')
  if (!(file instanceof File) || file.size === 0) return { error: '카드사 명세서 파일을 선택해 주세요.' }
  if (!CARD_ISSUERS.some((card) => card.key === issuer)) return { error: '카드사를 선택해 주세요.' }
  if (owner !== 'DJ' && owner !== 'YJ') return { error: '소유자를 선택해 주세요.' }
  if (!/\.xlsx?$/i.test(file.name)) return { error: '.xls 또는 .xlsx 형식의 명세서만 올릴 수 있습니다.' }
  if (file.size > MAX_FILE_BYTES) return { error: '파일 크기는 2MB 이하여야 합니다.' }

  const issuerLabel = CARD_ISSUERS.find((card) => card.key === issuer)!.label
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, owner: accounts.owner, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, household.householdId),
        eq(accounts.active, true),
      ),
    )
  const resolvedAccountId = suggestCardAccountId(accountRows, issuerLabel, owner)
  const selectedAccount = accountRows.find((account) => account.id === resolvedAccountId)
  if (!selectedAccount || selectedAccount.type !== 'card') {
    return { error: `${owner} ${issuerLabel}와 정확히 일치하는 활성 카드가 없습니다. 결제수단 관리를 확인해 주세요.` }
  }
  if (selectedAccount.owner && selectedAccount.owner !== owner) {
    return { error: '소유자와 카드의 소유자가 일치하지 않습니다.' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (looksLikeBanksalad(buffer)) {
    return { error: '뱅크샐러드 파일입니다. 뱅크샐러드 업로드를 사용해 주세요.' }
  }

  let rows: CardRow[]
  try {
    rows = parseCardStatement(buffer, issuer)
  } catch (error) {
    return { error: `파일을 읽지 못했습니다: ${errorMessage(error)}` }
  }
  if (rows.length === 0) {
    return { error: '거래 행을 찾지 못했습니다. 카드사 선택이 맞는지 확인해 주세요.' }
  }

  const occurrences = new Map<string, number>()
  const staged = rows.map((row) => {
    const key = `${row.date}|${row.amount}|${row.merchant}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    return { row, uid: cardFingerprint(issuer, owner, row, occurrence) }
  })

  const householdId = household.householdId
  const stagingContext = await loadStagingContext(householdId)
  const { categoriesById, doneUids } = stagingContext
  let alreadyProcessed = 0

  const candidates = staged.filter(({ uid }) => {
    if (doneUids.has(uid)) {
      alreadyProcessed += 1
      return false
    }
    doneUids.add(uid)
    return true
  })

  const suggestions = await resolveStagingSuggestions(
    householdId,
    stagingContext,
    candidates.map(({ row }) => ({
      merchant: row.merchant,
      amount: Math.abs(row.amount),
      baseFlow: 'expense',
      bsSuggestCategoryId: null,
      lockFlow: true,
    })),
    stagingContext.taxonomy.filter((category) => category.flow === 'expense'),
  )

  const values: Array<typeof importInbox.$inferInsert> = candidates.map(({ row, uid }, index) => {
    const suggestion = suggestions[index]
    const pay = cardPaymentSource(row, issuerLabel)
    const categoryId = suggestion.categoryId !== null &&
      categoriesById.get(suggestion.categoryId)?.kind === 'expense'
      ? suggestion.categoryId
      : null
    const sugSource = categoryId === null ? null : suggestion.sugSource

    return {
      householdId,
      importUid: uid,
      owner,
      date: row.date,
      time: null,
      merchant: row.merchant,
      amount: Math.abs(row.amount),
      flow: 'expense',
      kind: 'normal',
      bsCat1: cardSourceMarker(issuer),
      bsCat2: null,
      pay,
      accountId: selectedAccount.id,
      categoryId,
      memo: '',
      sugSource,
      confidence: assessConfidence({
        sugSource,
        historyMatch: suggestion.historyMatch,
        alwaysConfirm: suggestion.alwaysConfirm,
        hasDup: false,
        kind: 'normal',
        categoryId,
        exactAmountRepeat: suggestion.exactAmountRepeat,
      }),
    }
  })

  const inserted = await insertInboxRows(householdId, values)

  const duplicateCount = await refreshDuplicateFlags(householdId)
  const confidenceSummary = await summarizeInsertedConfidence(
    householdId,
    inserted.map((row) => row.id),
  )
  revalidatePath('/inbox')
  revalidatePath('/ledger')

  const details = [
    `인박스에 ${inserted.length}건 추가`,
    `이미 처리 ${alreadyProcessed}건`,
    `자동 분류 ${confidenceSummary.automatic}건`,
    `확인 필요 ${confidenceSummary.review}건`,
  ]
  if (duplicateCount) details.push(`중복 의심 ${duplicateCount}건`)
  return { message: details.join(' · ') }
}

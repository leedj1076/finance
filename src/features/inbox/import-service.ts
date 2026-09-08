import 'server-only'

import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, importInbox } from '@/db/schema'
import { revalidateFinance } from '@/lib/revalidate'

import { upsertBanksaladAssetSnapshots } from './asset-snapshots'
import { cardAccountCandidates, resolveCardAccountId } from './account-match'
import {
  banksaladFingerprint,
  classifyBanksaladRow,
  ledgerAmount,
  parseBanksaladWorkbook,
  type BanksaladOwner,
  type TransactionFlow,
} from './banksalad'
import { assessConfidence } from './confidence'
import { ImportFailure, type ImportObserver, type ImportResult } from './import-progress'
import { occurrenceCounter } from './occurrence'
import { HyundaiStatementError, isHtmlStatement } from './parsers/hyundai-html'
import { isPdfStatement, NhPdfError, parseNhPdf } from './parsers/nh-pdf'
import {
  CARD_ISSUERS,
  cardFingerprint,
  cardSourceMarker,
  looksLikeBanksalad,
  parseCardStatement,
  type CardIssuer,
  type CardRow,
} from './parsers/cards'
import {
  insertInboxRows,
  loadStagingContext,
  MAX_FILE_BYTES,
  refreshDuplicateFlags,
  resolveStagingSuggestions,
  summarizeInsertedConfidence,
} from './staging'
const COMMIT_CUTOFF = '2026-06-01'
const HISTORY_END = '2026-01-01'

type ValidatedImport =
  | { mode: 'banksalad'; files: File[] }
  | { mode: 'card'; file: File; issuer: CardIssuer; owner: 'DJ' | 'YJ'; issuerLabel: string; resolvedAccountId: number; isPdfFile: boolean }

/** Reused by HTTP preflight and every service call; householdId comes from server authentication. */
export async function validateImportInput(householdId: string, mode: 'card' | 'banksalad', formData: FormData): Promise<ValidatedImport> {
  if (!householdId || (mode !== 'card' && mode !== 'banksalad')) throw new ImportFailure('invalid_input')
  const fileKey = mode === 'card' ? 'file' : 'files'
  for (const [key, value] of formData) {
    if ((value instanceof File && key !== fileKey) || (key === fileKey && (!(value instanceof File) || value.size === 0))) {
      throw new ImportFailure('invalid_input', '업로드 파일을 다시 선택해 주세요.')
    }
  }
  for (const key of ['issuer', 'owner', 'accountId', 'password']) {
    if (formData.getAll(key).length > 1) throw new ImportFailure('invalid_input')
  }
  if (mode === 'banksalad') {
    const files = formData
      .getAll('files')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)

    if (files.length === 0) throw new ImportFailure('invalid_input', '뱅크샐러드 엑셀 파일을 선택해 주세요.')
    if (files.length > 2) throw new ImportFailure('invalid_input', 'DJ와 YJ 파일을 최대 2개까지 한 번에 올릴 수 있습니다.')
    if (files.some((file) => !file.name.toLowerCase().endsWith('.xlsx'))) {
      throw new ImportFailure('invalid_input', '.xlsx 형식의 뱅크샐러드 파일만 올릴 수 있습니다.')
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      throw new ImportFailure('invalid_input', '파일 하나의 크기는 2MB 이하여야 합니다.')
    }
    return { mode, files }
  }
  if (formData.getAll('file').length > 1) throw new ImportFailure('invalid_input', '카드사 명세서는 한 번에 하나만 올릴 수 있습니다.')
  const file = formData.get('file')
  const issuer = String(formData.get('issuer') ?? '') as CardIssuer
  const owner = String(formData.get('owner') ?? '')
  if (!(file instanceof File) || file.size === 0) throw new ImportFailure('invalid_input', '카드사 명세서 파일을 선택해 주세요.')
  if (!CARD_ISSUERS.some((card) => card.key === issuer)) throw new ImportFailure('invalid_input', '카드사를 선택해 주세요.')
  if (owner !== 'DJ' && owner !== 'YJ') throw new ImportFailure('invalid_input', '소유자를 선택해 주세요.')
  const isHtmlFile = /\.html?$/i.test(file.name)
  const isPdfFile = /\.pdf$/i.test(file.name)
  if (isHtmlFile && issuer !== 'hyundai') throw new ImportFailure('invalid_input', 'HTML 명세서는 현대카드만 지원합니다.')
  if (isPdfFile && issuer !== 'nonghyup') throw new ImportFailure('invalid_input', 'PDF 명세서는 농협카드만 지원합니다.')
  if (!/\.xlsx?$/i.test(file.name) && !isHtmlFile && !isPdfFile) {
    throw new ImportFailure('invalid_input', '.xls 또는 .xlsx 파일을 올려 주세요. 현대카드는 .html, 농협카드는 .pdf도 지원합니다.')
  }
  if (file.size > MAX_FILE_BYTES) throw new ImportFailure('invalid_input', '파일 크기는 2MB 이하여야 합니다.')

  const issuerLabel = CARD_ISSUERS.find((card) => card.key === issuer)!.label
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, owner: accounts.owner, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.active, true),
      ),
    )
  const submittedAccountId = formData.get('accountId')
  if (submittedAccountId !== null && typeof submittedAccountId !== 'string') {
    throw new ImportFailure('invalid_input', '선택한 기본 카드를 사용할 수 없습니다. 다시 선택해 주세요.')
  }
  const eligibleAccounts = cardAccountCandidates(accountRows, issuerLabel, owner)
  const resolvedAccountId = resolveCardAccountId(
    accountRows,
    issuerLabel,
    owner,
    submittedAccountId,
  )
  if (resolvedAccountId === null) {
    if (submittedAccountId === null && eligibleAccounts.length > 1) {
      throw new ImportFailure('invalid_input', `${owner} ${issuerLabel} 기본 카드를 선택해 주세요.`)
    }
    if (eligibleAccounts.length === 0) {
      throw new ImportFailure('invalid_input', `${owner} ${issuerLabel}와 정확히 일치하는 활성 카드가 없습니다. 결제수단 관리를 확인해 주세요.`)
    }
    throw new ImportFailure('invalid_input', '선택한 기본 카드를 사용할 수 없습니다. 카드사와 소유자를 확인해 다시 선택해 주세요.')
  }

  return { mode, file, issuer, owner, issuerLabel, resolvedAccountId, isPdfFile }
}

const safeHyundaiMessages = new Set([
  '파일 크기는 2MB 이하여야 합니다.',
  '지원하지 않거나 손상된 현대카드 보안 HTML입니다. 명세서를 다시 내려받아 주세요.',
  '이용일의 연도를 확정할 수 없습니다. 연도가 포함된 엑셀 이용내역을 올려 주세요.',
  '명세서에 올바르지 않은 이용일이 있습니다. 원본 파일을 확인해 주세요.',
])

function safeParserFailure(error: unknown): ImportFailure {
  if (error instanceof NhPdfError) {
    return new ImportFailure(error.code === 'password_required' || error.code === 'password_incorrect' ? error.code : 'invalid_input', new NhPdfError(error.code).message)
  }
  if (error instanceof HyundaiStatementError) {
    if (error.message === '보안 명세서 비밀번호를 입력해 주세요.') return new ImportFailure('password_required', error.message)
    if (error.message === '비밀번호가 맞지 않거나 보안 명세서가 손상되었습니다. 확인 후 다시 시도해 주세요.') return new ImportFailure('password_incorrect', error.message)
    if (safeHyundaiMessages.has(error.message)) return new ImportFailure('invalid_input', error.message)
  }
  return new ImportFailure('invalid_input', '파일을 읽지 못했습니다. 명세서 형식과 카드사 선택을 확인해 주세요.')
}

function cardPaymentSource(row: CardRow, issuerLabel: string) {
  const parsed = row.pay?.trim()
  return parsed && !/^(?:본인|가족)?카드$/.test(parsed) ? parsed : issuerLabel
}
export async function runImport(householdId: string, mode: 'card' | 'banksalad', data: FormData, observe?: ImportObserver): Promise<ImportResult> {
  try {
    observe?.({ type: 'stage', phase: 'validating' })
    const input = await validateImportInput(householdId, mode, data)
    return input.mode === 'card'
      ? await importCard(householdId, data, input, observe)
      : await importBanksalad(householdId, data, input.files, observe)
  } catch (error) {
    if (error instanceof ImportFailure) throw error
    throw new ImportFailure('processing_failed')
  }
}

async function importBanksalad(householdId: string, formData: FormData, files: File[], observe?: ImportObserver): Promise<ImportResult> {
  observe?.({ type: 'stage', phase: 'reading' })
  let parsedFiles
  try {
    parsedFiles = await Promise.all(
      files.map(async (file) => parseBanksaladWorkbook(Buffer.from(await file.arrayBuffer()))),
    )
  } catch {
    throw new ImportFailure('invalid_input', '뱅크샐러드 파일을 읽지 못했습니다. 올바른 엑셀 파일인지 확인해 주세요.')
  }

  const duplicateOwners = parsedFiles
    .map((file) => file.owner)
    .filter((owner, index, owners) => owners.indexOf(owner) !== index)
  if (duplicateOwners.length > 0) {
    throw new ImportFailure('invalid_input', `${duplicateOwners.join(', ')} 파일이 두 번 선택되었습니다.`)
  }

  const assetOptions = formData.getAll('asset_include').map(String)
  const includeAssets = assetOptions.length === 0 || assetOptions.includes('on')
  observe?.({ type: 'stage', phase: 'matching' })
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
  const nextOccurrence = occurrenceCounter()

  for (const parsed of parsedFiles) {
    skippedForeignCurrency += parsed.skippedForeignCurrency
    for (const row of parsed.rows) {
      const baseUid = banksaladFingerprint(parsed.owner, row)
      const occurrence = nextOccurrence(baseUid)
      const uid = occurrence === 0
        ? baseUid
        : banksaladFingerprint(parsed.owner, row, occurrence)
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
    stagingContext.taxonomy,
    observe,
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
      amount: ledgerAmount(candidate.baseFlow, candidate.row.amount),
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

  const inserted = await insertInboxRows(householdId, values, observe)
  for (const row of inserted) {
    if (row.owner === 'DJ' || row.owner === 'YJ') owners[row.owner] += 1
  }

  observe?.({ type: 'stage', phase: 'finalizing' })
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
  revalidateFinance('inbox')
  if (assetUpdated) revalidateFinance('assets')

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

  return { message: details.join(' · '), added: inserted.length, alreadyProcessed, ...confidenceSummary }
}


async function importCard(householdId: string, formData: FormData, input: Extract<ValidatedImport, { mode: 'card' }>, observe?: ImportObserver): Promise<ImportResult> {
  const { file, issuer, owner, issuerLabel, resolvedAccountId, isPdfFile } = input
  observe?.({ type: 'stage', phase: 'reading' })
  const buffer = Buffer.from(await file.arrayBuffer())
  if (isPdfFile !== isPdfStatement(buffer)) {
    throw new ImportFailure('invalid_input', '파일 내용과 확장자가 맞지 않습니다. 농협 PDF 명세서를 .pdf 파일로 선택해 주세요.')
  }
  if (!isPdfFile && !isHtmlStatement(buffer) && looksLikeBanksalad(buffer)) {
    throw new ImportFailure('invalid_input', '뱅크샐러드 파일입니다. 뱅크샐러드 업로드를 사용해 주세요.')
  }

  let rows: CardRow[]
  try {
    const password = String(formData.get('password') ?? '')
    rows = isPdfFile && issuer === 'nonghyup'
      ? await parseNhPdf(buffer, password)
      : parseCardStatement(buffer, issuer, { password })
  } catch (error) {
    throw safeParserFailure(error)
  }
  if (rows.length === 0) {
    throw new ImportFailure('invalid_input', '거래 행을 찾지 못했습니다. 카드사 선택이 맞는지 확인해 주세요.')
  }

  observe?.({ type: 'stage', phase: 'matching' })
  const nextOccurrence = occurrenceCounter()
  const staged = rows.map((row) => ({
    row,
    uid: cardFingerprint(
      issuer,
      owner,
      row,
      nextOccurrence(`${row.date}|${row.amount}|${row.merchant}`),
    ),
  }))

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
    observe,
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
      amount: row.amount,
      flow: 'expense',
      kind: 'normal',
      bsCat1: cardSourceMarker(issuer),
      bsCat2: null,
      pay,
      accountId: resolvedAccountId,
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

  const inserted = await insertInboxRows(householdId, values, observe)

  observe?.({ type: 'stage', phase: 'finalizing' })
  const duplicateCount = await refreshDuplicateFlags(householdId)
  const confidenceSummary = await summarizeInsertedConfidence(
    householdId,
    inserted.map((row) => row.id),
  )
  revalidateFinance('inbox')

  const details = [
    `인박스에 ${inserted.length}건 추가`,
    `이미 처리 ${alreadyProcessed}건`,
    `자동 분류 ${confidenceSummary.automatic}건`,
    `확인 필요 ${confidenceSummary.review}건`,
  ]
  if (duplicateCount) details.push(`중복 의심 ${duplicateCount}건`)
  return { message: details.join(' · '), added: inserted.length, alreadyProcessed, ...confidenceSummary }
}

import 'server-only'

import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { budgetRecommendationJobs, diagnosisJobs } from '@/db/schema'
import { buildBudgetPromptInput } from '@/features/budget-recommendations/prompt'
import { readBudgetSnapshot } from '@/features/budget-recommendations/snapshot'
import { buildDiagnosisPromptInput } from '@/features/diagnosis/prompt'
import { readDiagnosisSnapshot } from '@/features/diagnosis/queries'
import { currentMonthInKorea, isMonthKey, shiftMonth } from '@/lib/finance'

import { parseAiSettingsValues } from './input'
import { canonicalAiJson, parseAiPromptInput, renderAiPrompt } from './prompt'
import { readAiSettings } from './service'
import type { AiJobPromptView, AiKind, AiPromptInput, AiPromptPreview, AiSettingsValues } from './types'

type Reader = Parameters<Parameters<typeof db.transaction>[0]>[0]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(code: string): never {
  throw new Error(code)
}

function previewFrom(
  kind: AiKind,
  month: string,
  input: AiPromptInput,
  snapshot: unknown,
  unsaved: boolean,
  generatedAt = new Date().toISOString(),
): AiPromptPreview {
  const dataJson = canonicalAiJson(snapshot)
  if (renderAiPrompt(input, snapshot) !== input.prefix + dataJson + input.suffix) fail('prompt_unavailable')
  return {
    kind,
    month,
    prefix: input.prefix,
    dataJson,
    suffix: input.suffix,
    promptHash: input.promptHash,
    instructions: input.instructions,
    generatedAt,
    unsaved,
  }
}

async function buildPreview(
  reader: Reader,
  householdId: string,
  input: { kind: AiKind; month: string; values: AiSettingsValues },
) {
  if (!isMonthKey(input.month)) fail('invalid_input')
  const current = await readAiSettings(reader, householdId)
  const settings = { ...parseAiSettingsValues(input.values), revision: current.revision, updatedAt: current.updatedAt }
  if (input.kind === 'ledger') {
    const snapshot = await readDiagnosisSnapshot(reader, householdId, input.month)
    if (snapshot.current.count === 0) fail('preview_no_data')
    return previewFrom('ledger', input.month, buildDiagnosisPromptInput(snapshot, settings), snapshot, true)
  }
  const currentMonth = currentMonthInKorea(new Date())
  if (input.month !== currentMonth && input.month !== shiftMonth(currentMonth, 1)) fail('preview_month_unavailable')
  const snapshot = await readBudgetSnapshot(reader, householdId, {
    month: input.month,
    notes: '',
    plannedExpenses: [],
    draftAmounts: [],
  })
  if (snapshot.basis.averageIncome <= 0) fail('preview_missing_income')
  return previewFrom('budget', input.month, buildBudgetPromptInput(snapshot, settings), snapshot, true)
}

export async function previewAiPrompt(
  householdId: string,
  input: { kind: AiKind; month: string; values: AiSettingsValues },
): Promise<AiPromptPreview> {
  if (input.kind !== 'ledger' && input.kind !== 'budget') fail('invalid_input')
  return db.transaction(
    tx => buildPreview(tx, householdId, input),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export async function getAiJobPrompt(
  householdId: string,
  kind: AiKind,
  jobId: string,
): Promise<AiJobPromptView> {
  if ((kind !== 'ledger' && kind !== 'budget') || !UUID.test(jobId)) fail('invalid_input')
  try {
    return await db.transaction(async (tx) => {
      const rows = kind === 'ledger'
        ? await tx.select({ month: diagnosisJobs.month, createdAt: diagnosisJobs.createdAt, snapshot: diagnosisJobs.snapshot, promptInput: diagnosisJobs.promptInput })
          .from(diagnosisJobs).where(and(eq(diagnosisJobs.householdId, householdId), eq(diagnosisJobs.id, jobId))).limit(1)
        : await tx.select({ month: budgetRecommendationJobs.month, createdAt: budgetRecommendationJobs.createdAt, snapshot: budgetRecommendationJobs.snapshot, promptInput: budgetRecommendationJobs.promptInput })
          .from(budgetRecommendationJobs).where(and(eq(budgetRecommendationJobs.householdId, householdId), eq(budgetRecommendationJobs.id, jobId))).limit(1)
      const row = rows[0]
      if (!row) fail('not_found')
      if (row.promptInput === null) return { state: 'unrecorded', kind, month: row.month }
      const input = parseAiPromptInput(row.promptInput, kind, row.snapshot)
      return { state: 'recorded', preview: previewFrom(kind, row.month, input, row.snapshot, false, row.createdAt.toISOString()) }
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  } catch (error) {
    if (error instanceof Error && ['not_found', 'invalid_input'].includes(error.message)) throw error
    throw new Error('prompt_unavailable')
  }
}

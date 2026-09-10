import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'

import { db } from '@/db/client'
import { aiDiagnosisSettings, diagnosisWorkers } from '@/db/schema'
import { AI_DEFAULTS } from './defaults'
import type { AiSettingsPageData, AiSettingsSave, AiSettingsState, AiSettingsValues, AiWorkerView } from './types'

export type AiSettingsReader = Pick<typeof db, 'select'>

const EMPTY_SETTINGS: AiSettingsState = {
  commonInstructions: null,
  ledgerInstructions: null,
  budgetInstructions: null,
  revision: 0,
  updatedAt: null,
}

function state(row: typeof aiDiagnosisSettings.$inferSelect | undefined): AiSettingsState {
  if (!row) return { ...EMPTY_SETTINGS }
  return {
    commonInstructions: row.commonInstructions,
    ledgerInstructions: row.ledgerInstructions,
    budgetInstructions: row.budgetInstructions,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function sameValues(current: AiSettingsState, input: AiSettingsValues) {
  return current.commonInstructions === input.commonInstructions
    && current.ledgerInstructions === input.ledgerInstructions
    && current.budgetInstructions === input.budgetInstructions
}

function hasDatabaseCode(error: unknown, code: string, seen = new Set<object>()): boolean {
  if (!error || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const item = error as { code?: unknown; cause?: unknown }
  return item.code === code || hasDatabaseCode(item.cause, code, seen)
}

export async function readAiSettings(reader: AiSettingsReader, householdId: string): Promise<AiSettingsState> {
  const rows = await reader.select().from(aiDiagnosisSettings)
    .where(eq(aiDiagnosisSettings.householdId, householdId)).limit(1)
  return state(rows[0])
}

export async function getAiSettings(householdId: string): Promise<AiSettingsState> {
  return readAiSettings(db, householdId)
}

export async function getAiWorkerViews(householdId: string): Promise<AiWorkerView[]> {
  const rows = await db.select({
    id: diagnosisWorkers.id,
    label: diagnosisWorkers.label,
    lastSeenAt: diagnosisWorkers.lastSeenAt,
    promptProtocolVersion: diagnosisWorkers.promptProtocolVersion,
    promptLastSeenAt: diagnosisWorkers.promptLastSeenAt,
    budgetProtocolVersion: diagnosisWorkers.budgetProtocolVersion,
    budgetLastSeenAt: diagnosisWorkers.budgetLastSeenAt,
    configuredModel: diagnosisWorkers.configuredModel,
    configuredTimeoutMs: diagnosisWorkers.configuredTimeoutMs,
  }).from(diagnosisWorkers).where(and(
    eq(diagnosisWorkers.householdId, householdId),
    isNull(diagnosisWorkers.revokedAt),
  )).orderBy(asc(diagnosisWorkers.createdAt), asc(diagnosisWorkers.id))
  const cutoff = Date.now() - 90_000
  return rows.map((row) => {
    const seen = [row.lastSeenAt, row.promptLastSeenAt, row.budgetLastSeenAt]
      .filter((value): value is Date => value !== null)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null
    const state: AiWorkerView['state'] = row.promptProtocolVersion < 1
      ? 'upgrade_required'
      : row.promptLastSeenAt && row.promptLastSeenAt.getTime() >= cutoff ? 'ready' : 'offline'
    return {
      id: row.id,
      label: row.label,
      lastSeenAt: seen?.toISOString() ?? null,
      state,
      promptProtocolVersion: row.promptProtocolVersion,
      budgetProtocolVersion: row.budgetProtocolVersion,
      configuredModel: row.configuredModel,
      timeoutMs: row.configuredTimeoutMs,
    }
  })
}

export async function getAiSettingsPageData(householdId: string): Promise<AiSettingsPageData> {
  const [settings, workers] = await Promise.all([getAiSettings(householdId), getAiWorkerViews(householdId)])
  return { settings, defaults: { ...AI_DEFAULTS }, workers, budgetPreviewAvailable: true }
}

export async function saveAiSettings(
  householdId: string,
  userId: string,
  input: AiSettingsSave,
): Promise<AiSettingsState> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.select().from(aiDiagnosisSettings)
        .where(eq(aiDiagnosisSettings.householdId, householdId)).limit(1).for('update')
      const current = state(rows[0])
      if (sameValues(current, input)) return current
      if (current.revision !== input.expectedRevision) throw new Error('ai_settings_conflict')

      const values = {
        commonInstructions: input.commonInstructions,
        ledgerInstructions: input.ledgerInstructions,
        budgetInstructions: input.budgetInstructions,
        updatedAt: new Date(),
        updatedBy: userId,
      }
      if (!rows[0]) {
        const [inserted] = await tx.insert(aiDiagnosisSettings)
          .values({ householdId, ...values, revision: 1 }).returning()
        return state(inserted)
      }
      const [updated] = await tx.update(aiDiagnosisSettings)
        .set({ ...values, revision: current.revision + 1 })
        .where(and(
          eq(aiDiagnosisSettings.householdId, householdId),
          eq(aiDiagnosisSettings.revision, input.expectedRevision),
        )).returning()
      if (!updated) throw new Error('ai_settings_conflict')
      return state(updated)
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'ai_settings_conflict') throw error
    if (hasDatabaseCode(error, '23505')) {
      const current = await getAiSettings(householdId)
      if (sameValues(current, input)) return current
      throw new Error('ai_settings_conflict')
    }
    throw error
  }
}

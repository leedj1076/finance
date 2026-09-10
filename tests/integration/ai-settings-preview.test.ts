import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { db } from '@/db/client'
import { getAiJobPrompt, previewAiPrompt } from '@/features/ai-settings/preview'
import { buildDiagnosisPromptInput } from '@/features/diagnosis/prompt'
import { readDiagnosisSnapshot } from '@/features/diagnosis/queries'
import { currentMonthInKorea } from '@/lib/finance'

const databaseUrl = process.env.DATABASE_URL!
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('AI preview tests require local Supabase')
const raw = postgres(databaseUrl, { prepare: false })
const householdId = randomUUID()
const userId = randomUUID()
const budgetMonth = currentMonthInKorea(new Date())
const values = { commonInstructions: '짧게', ledgerInstructions: '내역 집중', budgetInstructions: '예산 집중' }

async function counts() {
  const [[settings], [ledger], [budget]] = await Promise.all([
    raw`select count(*)::int as count, coalesce(max(revision), 0)::int as revision from ai_diagnosis_settings where household_id = ${householdId}`,
    raw`select count(*)::int as count from diagnosis_jobs where household_id = ${householdId}`,
    raw`select count(*)::int as count from budget_recommendation_jobs where household_id = ${householdId}`,
  ])
  return { settings, ledger: ledger.count, budget: budget.count }
}

beforeAll(async () => {
  await raw`insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${`preview-${userId}@test.local`}, '')`
  await raw`insert into households (id, name) values (${householdId}, 'AI preview fixture')`
  await raw`insert into household_members (household_id, user_id) values (${householdId}, ${userId})`
  const categories = await raw`insert into categories (household_id, kind, major, sub) values
    (${householdId}, 'income', '월급', '급여'), (${householdId}, 'expense', '식비', '장보기') returning id, kind`
  const incomeId = categories.find(row => row.kind === 'income')!.id
  const expenseId = categories.find(row => row.kind === 'expense')!.id
  await raw`insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, source) values
    (${householdId}, '2026-07-01', 'income', 5000000, ${incomeId}, '월급', 'test'),
    (${householdId}, '2026-07-02', 'expense', 120000, ${expenseId}, '미리보기 마트', 'test'),
    (${householdId}, ${`${budgetMonth}-01`}, 'income', 5000000, ${incomeId}, '예산 기준 월급', 'test'),
    (${householdId}, ${`${budgetMonth}-02`}, 'expense', 120000, ${expenseId}, '예산 미리보기 마트', 'test')`
  await raw`insert into ai_diagnosis_settings (household_id, common_instructions, revision, updated_by) values (${householdId}, 'saved', 7, ${userId})`
})

afterAll(async () => {
  await raw`delete from households where id = ${householdId}`
  await raw`delete from auth.users where id = ${userId}`
  await raw.end()
})

test('unsaved ledger preview uses the frozen builder without writing settings or either queue', async () => {
  const before = await counts()
  const preview = await previewAiPrompt(householdId, { kind: 'ledger', month: '2026-07', values })
  expect(preview).toMatchObject({ kind: 'ledger', month: '2026-07', unsaved: true })
  expect(preview.instructions).toMatchObject({ common: '짧게', task: '내역 집중', commonSource: 'custom', taskSource: 'custom' })
  expect(preview.prefix + preview.dataJson + preview.suffix).toContain('미리보기 마트')
  expect(preview.promptHash).toMatch(/^[0-9a-f]{64}$/)
  expect(await counts()).toEqual(before)
})

test('budget preview leaves month-only inputs explicitly empty and writes nothing', async () => {
  const before = await counts()
  const preview = await previewAiPrompt(householdId, { kind: 'budget', month: budgetMonth, values })
  expect(JSON.parse(preview.dataJson).input).toEqual({ month: budgetMonth, notes: '', plannedExpenses: [], draftAmounts: [] })
  expect(preview.instructions.task).toBe('예산 집중')
  expect(await counts()).toEqual(before)
})

test('stored prompts are reconstructed only from household-owned frozen input and null stays unrecorded', async () => {
  const frozenSnapshot = await readDiagnosisSnapshot(db, householdId, '2026-07')
  const input = buildDiagnosisPromptInput(frozenSnapshot, { ...values, revision: 7, updatedAt: null })
  const snapshot = frozenSnapshot
  const [recorded] = await raw`insert into diagnosis_jobs (household_id, month, snapshot, prompt_input, fingerprint, requested_by, status)
    values (${householdId}, '2026-07', ${raw.json(snapshot)}, ${raw.json(input)}, ${'a'.repeat(64)}, ${userId}, 'queued') returning id`
  expect(await getAiJobPrompt(householdId, 'ledger', recorded.id)).toMatchObject({ state: 'recorded', preview: { promptHash: input.promptHash, unsaved: false } })
  const [legacy] = await raw`insert into diagnosis_jobs (household_id, month, snapshot, prompt_input, fingerprint, requested_by, status)
    values (${householdId}, '2026-06', ${raw.json({ ...snapshot, month: '2026-06' })}, null, ${'b'.repeat(64)}, ${userId}, 'queued') returning id`
  expect(await getAiJobPrompt(householdId, 'ledger', legacy.id)).toEqual({ state: 'unrecorded', kind: 'ledger', month: '2026-06' })
  await expect(getAiJobPrompt(randomUUID(), 'ledger', recorded.id)).rejects.toThrow('not_found')
})

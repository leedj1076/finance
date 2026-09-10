import { randomBytes, randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { db } from '@/db/client'
import { getAiSettings, saveAiSettings } from '@/features/ai-settings/service'

const databaseUrl = process.env.DATABASE_URL!
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
for (const value of [databaseUrl, supabaseUrl]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error('AI settings integration tests require local Supabase')
  }
}
const raw = postgres(databaseUrl, { prepare: false })
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const userIds: string[] = []
const householdIds: string[] = []

type Fixture = { householdId: string; userId: string; client: SupabaseClient }
let a: Fixture
let b: Fixture

async function fixture(label: string): Promise<Fixture> {
  const suffix = randomUUID()
  const email = `ai-settings-${label}-${suffix}@test.local`
  const password = randomBytes(24).toString('hex')
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userIds.push(data.user.id)
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  const [household] = await raw`insert into households (name) values (${`ai-settings-${label}-${suffix}`}) returning id`
  householdIds.push(household.id)
  await raw`insert into household_members (household_id, user_id) values (${household.id}, ${data.user.id})`
  return { householdId: household.id, userId: data.user.id, client }
}

afterAll(async () => {
  if (householdIds.length) await raw`delete from households where id in ${raw(householdIds)}`
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
  await raw.end()
})

describe('household AI settings', () => {
  beforeAll(async () => {
    a = await fixture('a')
    b = await fixture('b')
  })

  beforeEach(async () => {
    await raw`delete from ai_diagnosis_settings where household_id in ${raw(householdIds)}`
  })

  test('a missing row reads as defaults without inserting', async () => {
    expect(await getAiSettings(a.householdId)).toEqual({
      commonInstructions: null,
      ledgerInstructions: null,
      budgetInstructions: null,
      revision: 0,
      updatedAt: null,
    })
    const [count] = await raw`select count(*)::int as value from ai_diagnosis_settings where household_id = ${a.householdId}`
    expect(count.value).toBe(0)
  })

  test('first save is revision one and preserves the empty/null distinction', async () => {
    const saved = await saveAiSettings(a.householdId, a.userId, {
      commonInstructions: '', ledgerInstructions: null, budgetInstructions: '여행 없음', expectedRevision: 0,
    })
    expect(saved).toMatchObject({ commonInstructions: '', ledgerInstructions: null, budgetInstructions: '여행 없음', revision: 1 })
    expect(saved.updatedAt).toEqual(expect.any(String))
    const [row] = await raw`select updated_by from ai_diagnosis_settings where household_id = ${a.householdId}`
    expect(row.updated_by).toBe(a.userId)
  })

  test('a stale revision conflicts without overwriting current values', async () => {
    await saveAiSettings(a.householdId, a.userId, { commonInstructions: 'A', ledgerInstructions: null, budgetInstructions: null, expectedRevision: 0 })
    await expect(saveAiSettings(a.householdId, a.userId, { commonInstructions: 'B', ledgerInstructions: null, budgetInstructions: null, expectedRevision: 0 }))
      .rejects.toThrow('ai_settings_conflict')
    expect(await getAiSettings(a.householdId)).toMatchObject({ commonInstructions: 'A', revision: 1 })
  })

  test('saving null restores each default-backed field and advances the revision', async () => {
    await saveAiSettings(a.householdId, a.userId, {
      commonInstructions: 'custom', ledgerInstructions: '', budgetInstructions: 'custom budget', expectedRevision: 0,
    })
    const restored = await saveAiSettings(a.householdId, a.userId, {
      commonInstructions: null, ledgerInstructions: null, budgetInstructions: null, expectedRevision: 1,
    })
    expect(restored).toMatchObject({
      commonInstructions: null, ledgerInstructions: null, budgetInstructions: null, revision: 2,
    })
  })

  test('identical duplicate submissions are a no-op even with the previous revision', async () => {
    const values = { commonInstructions: 'same', ledgerInstructions: '', budgetInstructions: null }
    const first = await saveAiSettings(a.householdId, a.userId, { ...values, expectedRevision: 0 })
    const duplicate = await saveAiSettings(a.householdId, b.userId, { ...values, expectedRevision: 0 })
    expect(duplicate).toEqual(first)
    const [row] = await raw`select revision, updated_by from ai_diagnosis_settings where household_id = ${a.householdId}`
    expect(row).toEqual({ revision: 1, updated_by: a.userId })
  })

  test('a member sees only their household while authenticated and anonymous writes are denied', async () => {
    await saveAiSettings(a.householdId, a.userId, { commonInstructions: 'private', ledgerInstructions: null, budgetInstructions: null, expectedRevision: 0 })
    const own = await a.client.from('ai_diagnosis_settings').select('common_instructions')
    expect(own.error).toBeNull()
    expect(own.data).toEqual([{ common_instructions: 'private' }])
    const foreign = await b.client.from('ai_diagnosis_settings').select('common_instructions')
    expect(foreign.error).toBeNull()
    expect(foreign.data).toEqual([])
    expect((await anon.from('ai_diagnosis_settings').select('common_instructions')).error).not.toBeNull()
    for (const client of [a.client, b.client, anon]) {
      expect((await client.from('ai_diagnosis_settings').insert({
        household_id: a.householdId, common_instructions: 'forged', revision: 2, updated_by: b.userId,
      })).error).not.toBeNull()
      expect((await client.from('ai_diagnosis_settings').update({ common_instructions: 'forged' }).eq('household_id', a.householdId)).error).not.toBeNull()
      expect((await client.from('ai_diagnosis_settings').delete().eq('household_id', a.householdId)).error).not.toBeNull()
    }
    expect(await getAiSettings(a.householdId)).toMatchObject({ commonInstructions: 'private', revision: 1 })
  })

  test('all owner reads remain explicitly household-scoped', async () => {
    await saveAiSettings(a.householdId, a.userId, { commonInstructions: 'A', ledgerInstructions: null, budgetInstructions: null, expectedRevision: 0 })
    await saveAiSettings(b.householdId, b.userId, { commonInstructions: 'B', ledgerInstructions: null, budgetInstructions: null, expectedRevision: 0 })
    expect(await getAiSettings(a.householdId)).toMatchObject({ commonInstructions: 'A' })
    expect(await getAiSettings(b.householdId)).toMatchObject({ commonInstructions: 'B' })
    expect(db).toBeDefined()
  })
})

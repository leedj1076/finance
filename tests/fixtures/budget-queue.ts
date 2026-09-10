import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { expect } from 'vitest'

import { freezeAiPromptInput, resolveAiInstructions } from '@/features/ai-settings/prompt'

export type BudgetQueueHousehold = {
  householdId: string
  userId: string
  workerId: string
  token: string
  client: SupabaseClient
}

/** Each suite owns its clients and cleanup IDs; no fixture state is shared across files. */
export function createBudgetQueueFixture() {
  const databaseUrl = process.env.DATABASE_URL!
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // Check both endpoints before constructing any clients or creating auth users.
  for (const value of [databaseUrl, supabaseUrl]) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Queue tests require local Supabase')
    }
  }
  const raw = postgres(databaseUrl, { prepare: false })
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const householdIds: string[] = []
  const userIds: string[] = []
  let a: BudgetQueueHousehold
  let b: BudgetQueueHousehold
  const snapshot = { version: 1, month: '2026-09' }
  const report = { version: 1, rows: [{ major: '식비', amount: 100000 }] }

  async function household(): Promise<BudgetQueueHousehold> {
    const email = `queue-${randomUUID()}@test.local`
    const password = randomBytes(24).toString('hex')
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id)
    const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    const login = await client.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error
    const [home] = await raw`insert into households (name) values ('TEST-budget-queue') returning id`
    householdIds.push(home.id)
    await raw`insert into household_members (household_id, user_id) values (${home.id}, ${data.user.id})`
    const token = randomBytes(32).toString('hex')
    const hash = createHash('sha256').update(token).digest('hex')
    const [worker] = await raw`insert into diagnosis_workers (household_id, token_hash, label)
      values (${home.id}, ${hash}, 'TEST queue') returning id`
    return { householdId: home.id, userId: data.user.id, workerId: worker.id, token, client }
  }

  async function setup() {
    a = await household()
    b = await household()
    return { a, b }
  }
  async function reset() {
    await raw`delete from budgets where household_id in ${raw(householdIds)}`
    await raw`delete from budget_recommendation_jobs where household_id in ${raw(householdIds)}`
    await raw`delete from diagnosis_jobs where household_id in ${raw(householdIds)}`
    await raw`update diagnosis_workers set revoked_at = null, budget_protocol_version = 0, budget_last_seen_at = null,
      prompt_protocol_version = 0, prompt_last_seen_at = null where household_id in ${raw(householdIds)}`
  }
  async function cleanup() {
    if (householdIds.length) await raw`delete from households where id in ${raw(householdIds)}`
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
    await raw.end()
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const result = await anon.rpc(name, args)
    if (result.error) throw result.error
    return result.data
  }
  async function enqueue(owner = a, month = '2026-09', requestId = randomUUID(), input: unknown = null) {
    const [job] = await raw`insert into budget_recommendation_jobs
      (household_id, month, request_id, snapshot, prompt_input, fingerprint, requested_by)
      values (${owner.householdId}, ${month}, ${requestId}, ${raw.json({ ...snapshot, month })},
        ${input === null ? null : raw.json(input as never)}, ${'a'.repeat(64)}, ${owner.userId}) returning id`
    return job.id as string
  }
  function prompt(kind: 'ledger' | 'budget', value = snapshot) {
    return freezeAiPromptInput(resolveAiInstructions({ revision: 0, updatedAt: null,
      commonInstructions: null, ledgerInstructions: null, budgetInstructions: null }, kind),
    { version: 'test-v1', before: 'Policy', after: 'Output JSON', dataTag: 'data' }, value)
  }
  async function ready(owner = a) {
    expect(await rpc('heartbeat_budget_worker', { p_token: owner.token })).toBe(true)
  }
  async function claim(owner = a) {
    return rpc('claim_budget_recommendation_job', { p_token: owner.token })
  }
  async function finish(job: { id: string; claimToken: string }, owner = a, value: unknown = report, errorCode: string | null = null) {
    return rpc('finish_budget_recommendation_job', { p_token: owner.token, p_job_id: job.id,
      p_claim_token: job.claimToken, p_report: value, p_error_code: errorCode })
  }

  return { raw, anon, snapshot, report, setup, reset, cleanup, rpc, enqueue, prompt, ready, claim, finish }
}

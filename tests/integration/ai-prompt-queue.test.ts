import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { createBudgetQueueFixture, type BudgetQueueHousehold } from '../fixtures/budget-queue'

const fixture = createBudgetQueueFixture()
const { raw, anon, snapshot, prompt, rpc, enqueue } = fixture
let a: BudgetQueueHousehold
let b: BudgetQueueHousehold
beforeAll(async () => { ({ a, b } = await fixture.setup()) })
beforeEach(fixture.reset)
afterAll(fixture.cleanup)

async function ledger(month: string, input: unknown = null, requestId = randomUUID()) {
  const [row] = await raw`insert into diagnosis_jobs (household_id, month, request_id, snapshot, prompt_input, fingerprint, requested_by)
    values (${a.householdId}, ${month}, ${requestId}, ${raw.json(snapshot)},
      ${input === null ? null : raw.json(input as never)}, ${'a'.repeat(64)}, ${a.userId}) returning id`
  return row.id as string
}
test('legacy claim only takes null prompt input; configured claim preserves frozen envelope and request deduplication', async () => {
  const legacy = await ledger('2026-08')
  const input = prompt('ledger')
  const requestId = randomUUID()
  const configured = await ledger('2026-09', input, requestId)
  await expect(ledger('2026-10', input, requestId)).rejects.toMatchObject({ code: '23505' })
  expect((await rpc('claim_diagnosis_job', { p_token: a.token })).id).toBe(legacy)
  expect(await rpc('claim_diagnosis_job', { p_token: a.token })).toBeNull()
  expect(await rpc('claim_configured_diagnosis_job', { p_token: a.token })).toBeNull()
  expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: 'gpt-5.4', p_timeout_ms: 300000 })).toBe(true)
  expect((await raw`select status from diagnosis_jobs where id = ${configured}`)[0].status).toBe('queued')
  await raw`update diagnosis_workers set prompt_last_seen_at = now() - interval '91 seconds' where id = ${a.workerId}`
  expect(await rpc('claim_configured_diagnosis_job', { p_token: a.token })).toBeNull()
  await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: 'gpt-5.4', p_timeout_ms: 300000 })
  const job = await rpc('claim_configured_diagnosis_job', { p_token: a.token })
  expect(job).toMatchObject({ id: configured, promptInput: input })
  const [presence] = await raw`select prompt_protocol_version, configured_model, configured_timeout_ms
    from diagnosis_workers where id = ${a.workerId}`
  expect(presence).toEqual({ prompt_protocol_version: 1, configured_model: 'gpt-5.4', configured_timeout_ms: 300000 })
  const finishLedger = (token: string, claimToken: string) => rpc('finish_diagnosis_job', { p_token: token,
    p_job_id: job.id, p_claim_token: claimToken, p_report: null, p_error_code: 'timeout' })
  expect(await finishLedger(b.token, job.claimToken)).toBe(false)
  expect(await finishLedger(a.token, randomUUID())).toBe(false)
  await raw`update diagnosis_jobs set lease_expires_at = now() - interval '1 second' where id = ${job.id}`
  expect(await finishLedger(a.token, job.claimToken)).toBe(false)
})
test('AI presence rejects revoked tokens, paths, controls, out-of-bounds timeout and unknown arguments', async () => {
  expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: 'x'.repeat(100), p_timeout_ms: 1 })).toBe(true)
  for (const model of ['model\n', 'model\r', 'model\t']) {
    expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: model, p_timeout_ms: 1000 })).toBe(false)
  }
  for (const model of ['C:private', 'x'.repeat(101)]) {
    expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: model, p_timeout_ms: 1000 })).toBe(false)
  }
  for (const model of ['/tmp/model', 'path/model', 'bad\\model', 'bad\nmodel', 'model ', '']) {
    expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: model, p_timeout_ms: 1000 })).toBe(false)
  }
  for (const timeout of [null, 0, 300001]) {
    expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: timeout })).toBe(false)
  }
  expect((await anon.rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 1, arbitrary: true })).error).not.toBeNull()
  expect(await rpc('heartbeat_ai_worker', { p_token: randomBytes(32).toString('hex'), p_model: null, p_timeout_ms: 1 })).toBe(false)
  await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
  expect(await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 1 })).toBe(false)
})
test('prompt envelopes are immutable including null to configured, unsupported versions stay queued, and kind/size are enforced', async () => {
  const id = await ledger('2026-07')
  const input = prompt('ledger')
  await expect(raw`update diagnosis_jobs set prompt_input = ${raw.json(input)} where id = ${id}`).rejects.toMatchObject({ code: '23514' })
  await expect(raw`update diagnosis_jobs set snapshot = '{"version":1,"changed":true}' where id = ${id}`).rejects.toMatchObject({ code: '23514' })
  await expect(ledger('2026-06', prompt('budget'))).rejects.toMatchObject({ code: '23514' })
  await expect(ledger('2026-06', { ...input, version: 0 })).rejects.toMatchObject({ code: '23514' })
  await expect(ledger('2026-06', { kind: 'ledger' })).rejects.toMatchObject({ code: '23514' })
  await expect(ledger('2026-06', { ...input, prefix: 'x'.repeat(131072) })).rejects.toMatchObject({ code: '23514' })
  const future = await ledger('2026-08', { ...input, version: 2 })
  await rpc('heartbeat_ai_worker', { p_token: a.token, p_model: null, p_timeout_ms: 1000 })
  expect((await rpc('claim_configured_diagnosis_job', { p_token: a.token })).id).toBe(id)
  expect(await rpc('claim_configured_diagnosis_job', { p_token: a.token })).toBeNull()
  expect((await raw`select status from diagnosis_jobs where id = ${future}`)[0].status).toBe('queued')
  const budgetId = await enqueue(a, '2026-09', randomUUID(), prompt('budget'))
  await expect(raw`update budget_recommendation_jobs set prompt_input = null where id = ${budgetId}`).rejects.toMatchObject({ code: '23514' })
})

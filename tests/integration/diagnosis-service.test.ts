import { createHash, randomBytes, randomUUID } from 'node:crypto'

import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'

import { getDiagnosisPageData, getDiagnosisSnapshot, requestDiagnosis } from '@/features/diagnosis/queries'
import type { ClaimedDiagnosisJob, DiagnosisReport, DiagnosisSnapshot } from '@/features/diagnosis/types'

const databaseUrl = process.env.DATABASE_URL!
for (const value of [databaseUrl, process.env.NEXT_PUBLIC_SUPABASE_URL!]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error('Diagnosis service integration tests require local Supabase')
  }
}
const raw = postgres(databaseUrl, { prepare: false })
const householdIds: string[] = []
type Fixture = { householdId: string; userId: string; workerId: string; token: string; foodCategoryId: number; expenseId: number }
let a: Fixture
let b: Fixture

async function fixture(label: string): Promise<Fixture> {
  const [household] = await raw`insert into households (name) values (${`diagnosis-service-${label}-${randomUUID()}`}) returning id`
  householdIds.push(household.id)
  const token = randomBytes(32).toString('hex')
  const [worker] = await raw`
    insert into diagnosis_workers (household_id, token_hash, label)
    values (${household.id}, ${createHash('sha256').update(token).digest('hex')}, 'Service test') returning id
  `
  const categoryRows = await raw`
    insert into categories (household_id, kind, major, sub) values
      (${household.id}, 'income', '월급', '급여'),
      (${household.id}, 'income', '기타수입', '환급'),
      (${household.id}, 'expense', '식비', '외식'),
      (${household.id}, 'saving', '연금', 'IRP')
    returning id, major
  `
  const categoryId = (major: string) => Number(categoryRows.find(row => row.major === major)!.id)
  const accountRows = await raw`
    insert into accounts (household_id, name) values (${household.id}, '카드 A'), (${household.id}, '계좌 B') returning id
  `
  const transactions = await raw`
    insert into transactions (household_id, date, flow, amount, category_id, account_id, fixed, raw_merchant, memo)
    values
      (${household.id}, '2026-07-31', 'income', 7101720, ${categoryId('월급')}, ${accountRows[1].id}, true, '회사', '7월 월급'),
      (${household.id}, '2026-07-03', 'income', 579327, ${categoryId('기타수입')}, ${accountRows[1].id}, false, '환급', '기타 수입'),
      (${household.id}, '2026-07-01', 'expense', 5000000, ${categoryId('식비')}, ${accountRows[0].id}, true, '가맹점 A', '월 초 지출'),
      (${household.id}, '2026-07-31', 'expense', 603949, ${categoryId('식비')}, ${accountRows[1].id}, false, '가맹점 B', '월 말 지출'),
      (${household.id}, '2026-07-20', 'saving', 850000, ${categoryId('연금')}, ${accountRows[1].id}, true, '연금 계좌', '납입')
    returning id, amount, flow
  `
  return { householdId: household.id, userId: randomUUID(), workerId: worker.id, token,
    foodCategoryId: categoryId('식비'), expenseId: Number(transactions.find(row => row.flow === 'expense' && Number(row.amount) === 5000000)!.id) }
}

function report(owner = a): DiagnosisReport {
  return {
    version: 1, headline: '월급에서 지출과 저축을 빼면 64.8만 원입니다.',
    summary: '기록상 차액이며 실제 계좌 잔액과는 다릅니다.',
    changes: [{ title: '지출 내역', body: '월 초 지출을 확인해주세요.', category: '식비', transactionIds: [owner.expenseId] }],
    trend: { summary: '비교할 과거 기록이 없습니다.', caveat: '기록이 있는 달만 비교합니다.' },
    checks: [], actions: [{ title: '다음 달 확인', body: '반복되는 지출인지 확인해주세요.' }], positive: null,
  }
}

async function claim(owner = a): Promise<ClaimedDiagnosisJob> {
  const [row] = await raw`select public.claim_diagnosis_job(${owner.token}) as result`
  expect(row.result).not.toBeNull()
  return row.result
}

async function finish(job: ClaimedDiagnosisJob, owner = a, value: DiagnosisReport | null = report(owner), code: string | null = null) {
  const [row] = await raw`
    select public.finish_diagnosis_job(${owner.token}, ${job.id}, ${job.claimToken}, ${value === null ? null : raw.json(value)}, ${code}) as ok
  `
  expect(row.ok).toBe(true)
}

async function completedReport(owner = a) {
  const requested = await requestDiagnosis(owner.householdId, owner.userId, '2026-07')
  const job = await claim(owner)
  expect(job.id).toBe(requested.latestJob?.id)
  await finish(job, owner)
  return job
}

beforeEach(async () => {
  a = await fixture('a')
  b = await fixture('b')
})

afterEach(async () => {
  if (householdIds.length) await raw`delete from households where id in ${raw(householdIds)}`
  householdIds.splice(0)
})
afterAll(async () => { await raw.end() })

describe('monthly diagnosis service', () => {
  test('loads the whole selected month across accounts and fixed flags, with only three prior months', async () => {
    await raw`
      insert into transactions (household_id, date, flow, amount, category_id) values
        (${a.householdId}, '2026-03-31', 'expense', 90000000, ${a.foodCategoryId}),
        (${a.householdId}, '2026-04-01', 'expense', 4000000, ${a.foodCategoryId}),
        (${a.householdId}, '2026-06-30', 'expense', 5556547, ${a.foodCategoryId}),
        (${a.householdId}, '2026-08-01', 'expense', 80000000, ${a.foodCategoryId}),
        (${b.householdId}, '2026-07-15', 'expense', 99000000, ${b.foodCategoryId})
    `
    const snapshot = await getDiagnosisSnapshot(a.householdId, '2026-07')
    expect(snapshot.current).toMatchObject({ count: 5, salary: 7101720, income: 7681047, otherIncome: 579327,
      expense: 5603949, saving: 850000, salaryRemainder: 647771, totalRemainder: 1227098 })
    expect(snapshot.months.map(month => [month.month, month.count, month.expense])).toEqual([
      ['2026-04', 1, 4000000], ['2026-05', 0, 0], ['2026-06', 1, 5556547], ['2026-07', 5, 5603949],
    ])
    expect(snapshot.comparison).toMatchObject({ previousExpense: 5556547, expenseDelta: 47402, baselineMonthCount: 2 })
    expect(snapshot.transactions).toHaveLength(5)
    expect(snapshot.transactions.every(row => row.date.startsWith('2026-07'))).toBe(true)
  })

  test('resolves household-specific budgets and target without leaking another household settings', async () => {
    await raw`
      insert into budgets (household_id, major, month, amount) values
        (${a.householdId}, '식비', '*', 6000000), (${a.householdId}, '식비', '2026-07', 5800000),
        (${a.householdId}, '식비', '2026-08', 9000000), (${b.householdId}, '식비', '*', 99000000)
    `
    await raw`insert into settings (household_id, key, value) values (${a.householdId}, 'savings_target', '30'), (${b.householdId}, 'savings_target', '80')`
    const snapshot = await getDiagnosisSnapshot(a.householdId, '2026-07')
    expect(snapshot.budget).toEqual({ total: 5800000, savingsRateTarget: 30 })
    expect(snapshot.categories.find(category => category.major === '식비')?.budget).toBe(5800000)
  })

  test('counts each visible expense major budget once and excludes hidden, orphan, and nonexpense budgets', async () => {
    const categoryRows = await raw`
      insert into categories (household_id, kind, major, sub, hidden) values
        (${a.householdId}, 'expense', '식비', '장보기', false),
        (${a.householdId}, 'expense', '식비', '배달', false),
        (${a.householdId}, 'expense', '건강', '병원', false),
        (${a.householdId}, 'expense', '숨긴 지출', '보관', true),
        (${b.householdId}, 'expense', '다른 가구 분류', '기타', false)
      returning id, major
    `
    const hiddenId = categoryRows.find(row => row.major === '숨긴 지출')!.id
    await raw`
      insert into transactions (household_id, date, flow, amount, category_id)
      values (${a.householdId}, '2026-07-15', 'expense', 20, ${hiddenId})
    `
    await raw`
      insert into budgets (household_id, major, month, amount) values
        (${a.householdId}, '식비', '*', 4000),
        (${a.householdId}, '식비', '2026-07', 5000),
        (${a.householdId}, '건강', '*', 2000),
        (${a.householdId}, '숨긴 지출', '*', 11000),
        (${a.householdId}, '삭제된 분류', '*', 13000),
        (${a.householdId}, '월급', '*', 17000),
        (${a.householdId}, '연금', '*', 19000),
        (${a.householdId}, '다른 가구 분류', '*', 23000)
    `
    const snapshot = await getDiagnosisSnapshot(a.householdId, '2026-07')
    // The visible expense budgets are food 5,000 (month override) + health
    // 2,000, irrespective of food's three subcategories or health having no spend.
    expect(snapshot.budget.total).toBe(7000)
    expect(snapshot.categories.find(category => category.major === '식비')?.budget).toBe(5000)
    expect(snapshot.categories.find(category => category.major === '숨긴 지출')).toMatchObject({ amount: 20, budget: null })
    expect(snapshot.current.expense).toBe(5603969)
  })

  test('rejects invalid months and empty-month requests without creating a job', async () => {
    await expect(getDiagnosisSnapshot(a.householdId, '2026-13')).rejects.toThrow()
    await expect(requestDiagnosis(a.householdId, a.userId, '2026-09')).rejects.toMatchObject({ status: 400 })
    const rows = await raw`select id from diagnosis_jobs where household_id = ${a.householdId}`
    expect(rows).toHaveLength(0)
  })

  test('worker presence and liveness are scoped to the household and exclude revoked tokens', async () => {
    await raw`update diagnosis_workers set last_seen_at = now() where id = ${b.workerId}`
    expect(await getDiagnosisPageData(a.householdId, '2026-07')).toMatchObject({ latestJob: null, completed: null, workerOnline: false, setupRequired: false })
    await raw`update diagnosis_workers set last_seen_at = now() where id = ${a.workerId}`
    expect(await getDiagnosisPageData(a.householdId, '2026-07')).toMatchObject({ workerOnline: true, setupRequired: false })
    await raw`update diagnosis_workers set revoked_at = now() where id = ${a.workerId}`
    expect(await getDiagnosisPageData(a.householdId, '2026-07')).toMatchObject({ workerOnline: false, setupRequired: true })
    await expect(requestDiagnosis(a.householdId, a.userId, '2026-07')).rejects.toMatchObject({ status: 409 })
  })

  test('simultaneous button requests create a single active job and return the same job', async () => {
    const states = await Promise.all(Array.from({ length: 5 }, () => requestDiagnosis(a.householdId, a.userId, '2026-07')))
    const ids = states.map(state => state.latestJob?.id)
    expect(new Set(ids).size).toBe(1)
    expect(states.every(state => state.latestJob?.status === 'queued')).toBe(true)
    const rows = await raw`select id, requested_by from diagnosis_jobs where household_id = ${a.householdId}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: ids[0], requested_by: a.userId })
  })

  test('a queued snapshot remains immutable while fresh ledger data changes', async () => {
    const initial = await requestDiagnosis(a.householdId, a.userId, '2026-07')
    const [before] = await raw`select snapshot, fingerprint from diagnosis_jobs where id = ${initial.latestJob!.id}`
    await raw`update transactions set amount = 5000100, memo = '수정된 지출' where id = ${a.expenseId}`
    const repeated = await requestDiagnosis(a.householdId, a.userId, '2026-07')
    expect(repeated.latestJob?.id).toBe(initial.latestJob?.id)
    expect(repeated.currentSnapshot.current.expense).toBe(5604049)
    const [after] = await raw`select snapshot, fingerprint from diagnosis_jobs where id = ${initial.latestJob!.id}`
    expect(after).toEqual(before)
    expect((after.snapshot as DiagnosisSnapshot).current.expense).toBe(5603949)
  })

  test('keeps the completed report visible during queued, running, and failed regeneration', async () => {
    const first = await completedReport()
    const initial = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(initial.completed?.id).toBe(first.id)
    expect(initial.isStale).toBe(false)
    const queued = await requestDiagnosis(a.householdId, a.userId, '2026-07')
    expect(queued.latestJob).toMatchObject({ status: 'queued' })
    expect(queued.latestJob?.id).not.toBe(first.id)
    expect(queued.completed?.id).toBe(first.id)
    const next = await claim()
    const running = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(running.latestJob).toMatchObject({ id: next.id, status: 'running' })
    expect(running.completed?.report).toEqual(initial.completed?.report)
    await finish(next, a, null, 'cli_failed')
    const failed = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(failed.latestJob).toMatchObject({ id: next.id, status: 'failed', errorCode: 'cli_failed' })
    expect(failed.completed?.id).toBe(first.id)
    expect(failed.isStale).toBe(false)
  })

  test('marks an existing report stale after an amount edit but retains its original calculations', async () => {
    const job = await completedReport()
    expect((await getDiagnosisPageData(a.householdId, '2026-07')).isStale).toBe(false)
    await raw`update transactions set amount = 5001000 where id = ${a.expenseId}`
    const state = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(state.isStale).toBe(true)
    expect(state.currentSnapshot.current.expense).toBe(5604949)
    expect(state.completed?.snapshot.current.expense).toBe(5603949)
    expect(state.completed?.id).toBe(job.id)
  })

  test('another household or another month cannot supply the displayed job or completed report', async () => {
    await completedReport(b)
    await completedReport(a)
    const emptyMonth = await getDiagnosisPageData(a.householdId, '2026-06')
    expect(emptyMonth).toMatchObject({ latestJob: null, completed: null })
    const [third] = await raw`insert into households (name) values ('Diagnosis isolated reader') returning id`
    householdIds.push(third.id)
    const thirdState = await getDiagnosisPageData(third.id, '2026-07')
    expect(thirdState).toMatchObject({ latestJob: null, completed: null, setupRequired: true })
    expect(thirdState.currentSnapshot.current.count).toBe(0)
  })

  test('a malformed latest report falls back to the prior valid report and exposes a safe error', async () => {
    const previous = await completedReport()
    await requestDiagnosis(a.householdId, a.userId, '2026-07')
    const latest = await claim()
    const malformed = report()
    malformed.changes[0].transactionIds = [b.expenseId]
    // The SQL RPC enforces minimal shape; the query must independently reject
    // unsupported transaction evidence before displaying persisted output.
    await finish(latest, a, malformed)
    const state = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(state.latestJob).toMatchObject({ id: latest.id, status: 'failed', errorCode: 'invalid_output' })
    expect(state.completed?.id).toBe(previous.id)
    expect(state.completed?.report.changes[0].transactionIds).toEqual([a.expenseId])
  })

  test('page reads expire an abandoned running job with an offline worker and allow manual retry', async () => {
    await requestDiagnosis(a.householdId, a.userId, '2026-07')
    const abandoned = await claim()
    await raw`update diagnosis_jobs set lease_expires_at = now() - interval '1 second' where id = ${abandoned.id}`
    await raw`update diagnosis_workers set last_seen_at = now() - interval '10 minutes' where id = ${a.workerId}`
    const page = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(page).toMatchObject({ workerOnline: false, setupRequired: false, latestJob: { id: abandoned.id, status: 'failed', errorCode: 'lease_expired' } })
    const [expired] = await raw`select status, claim_token, lease_expires_at from diagnosis_jobs where id = ${abandoned.id}`
    expect(expired).toMatchObject({ status: 'failed', claim_token: null, lease_expires_at: null })
    const retry = await requestDiagnosis(a.householdId, a.userId, '2026-07')
    expect(retry.latestJob?.status).toBe('queued')
    expect(retry.latestJob?.id).not.toBe(abandoned.id)
  })

  test('expiry handling cannot mutate another household or another month', async () => {
    await completedReport(a)
    await requestDiagnosis(b.householdId, b.userId, '2026-07')
    const foreign = await claim(b)
    await raw`update diagnosis_jobs set lease_expires_at = now() - interval '1 second' where id = ${foreign.id}`
    await getDiagnosisPageData(a.householdId, '2026-07')
    await getDiagnosisPageData(b.householdId, '2026-06')
    const [row] = await raw`select status from diagnosis_jobs where id = ${foreign.id}`
    expect(row.status).toBe('running')
  })

  test('a memo-only edit outside the 300 evidence rows invalidates the report without changing totals', async () => {
    await raw`
      insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, memo)
      select ${a.householdId}, '2026-07-10', 'expense', 1000, ${a.foodCategoryId}, '반복 가맹점', '기존 메모'
      from generate_series(1, 310)
    `
    const [small] = await raw`
      insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, memo)
      values (${a.householdId}, '2026-07-11', 'expense', 1, ${a.foodCategoryId}, '작은 가맹점', '수정 전 메모') returning id
    `
    const completed = await completedReport()
    expect(completed.snapshot.transactions).toHaveLength(300)
    expect(completed.snapshot.transactions.some(row => row.id === Number(small.id))).toBe(false)
    await raw`update transactions set memo = '수정 후 메모' where id = ${small.id}`
    const state = await getDiagnosisPageData(a.householdId, '2026-07')
    expect(state.currentSnapshot.current).toEqual(completed.snapshot.current)
    expect(state.currentSnapshot.transactions).toEqual(completed.snapshot.transactions)
    expect(state.currentSnapshot.sourceHash).not.toBe(completed.snapshot.sourceHash)
    expect(state.isStale).toBe(true)
  })
})

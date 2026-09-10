import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'

import type { BudgetRecommendationReport, ClaimedBudgetJob } from '@/features/budget-recommendations/types'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'
import { makeBudgetReport } from '../fixtures/budget-recommendation'

type Database = ReturnType<typeof postgres>

type BudgetAcceptanceFixture = {
  admin: SupabaseClient
  anon: SupabaseClient
  database: Database
  email: string
  password: string
  householdId: string
  userId: string
  token: string
  foodCategoryId: number
  month: string
  nextMonth: string
}

function localEndpoint(name: string): string {
  const value = process.env[name]
  if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error(`${name} must use local Supabase`)
  }
  return value
}

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByPlaceholder('이메일').fill(email)
  await page.getByPlaceholder('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/dashboard')
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data as T
}

async function refreshCapabilities(fixture: BudgetAcceptanceFixture) {
  localEndpoint('DATABASE_URL')
  localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
  expect(await rpc<boolean>(fixture.anon, 'heartbeat_ai_worker', {
    p_token: fixture.token,
    p_model: null,
    p_timeout_ms: 180_000,
  })).toBe(true)
  expect(await rpc<boolean>(fixture.anon, 'heartbeat_budget_worker', {
    p_token: fixture.token,
  })).toBe(true)
}

function reportFor(job: ClaimedBudgetJob): BudgetRecommendationReport {
  expect(job.snapshot.rows).toHaveLength(1)
  const source = job.snapshot.rows[0]
  const evidence = job.snapshot.evidence.find(row => row.major === source.major
    && row.date.slice(0, 7) === shiftMonth(job.snapshot.month, -1))
  expect(evidence, `real prior-month transaction evidence for ${source.major}`).toBeDefined()
  const report = makeBudgetReport()
  report.rows = [{
    ...report.rows[0],
    major: source.major,
    amount: Math.max(300_000, source.floor),
    references: [{ kind: 'transaction', id: evidence!.id }],
  }]
  return report
}

async function enqueueAndComplete(page: import('@playwright/test').Page, fixture: BudgetAcceptanceFixture) {
  await refreshCapabilities(fixture)
  const posted = page.waitForResponse(response => {
    const request = response.request()
    const url = new URL(response.url())
    return request.method() === 'POST' && url.pathname === '/api/budget-recommendations'
      && url.searchParams.get('month') === fixture.month
  })
  await page.getByRole('button', { name: 'AI 예산 추천', exact: true }).click()
  expect((await posted).ok()).toBe(true)
  await expect(page.getByText('예산 추천이 대기 중입니다.', { exact: true })).toBeVisible()

  localEndpoint('DATABASE_URL')
  localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
  const claimed = await rpc<ClaimedBudgetJob | null>(fixture.anon, 'claim_budget_recommendation_job', {
    p_token: fixture.token,
  })
  expect(claimed).not.toBeNull()
  expect(Object.keys(claimed!).sort()).toEqual(['claimToken', 'id', 'promptInput', 'snapshot'])
  expect(claimed!.snapshot).toMatchObject({ version: 1, month: fixture.month })
  expect(claimed!.promptInput).toMatchObject({ version: 1, kind: 'budget' })

  const [queued] = await fixture.database`
    select id, status from budget_recommendation_jobs
    where household_id = ${fixture.householdId} and month = ${fixture.month}
    order by created_at desc, id desc limit 1
  `
  expect(queued).toEqual({ id: claimed!.id, status: 'running' })
  expect(await rpc<boolean>(fixture.anon, 'finish_budget_recommendation_job', {
    p_token: fixture.token,
    p_job_id: claimed!.id,
    p_claim_token: claimed!.claimToken,
    p_report: reportFor(claimed!),
    p_error_code: null,
  })).toBe(true)
  await expect(page.getByText('추천 완료', { exact: true })).toBeVisible({ timeout: 15_000 })
  return claimed!
}

async function navigateToClientBudgetPanel(
  page: import('@playwright/test').Page,
  month: string,
  navigate: () => Promise<unknown>,
) {
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname === '/api/budget-recommendations'
      && url.searchParams.get('month') === month
  })
  await navigate()
  expect((await loaded).ok()).toBe(true)
  return page.getByRole('region', {
    name: `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 AI 예산 추천`,
    exact: true,
  })
}

async function waitForCompletedBudgetPanel(
  page: import('@playwright/test').Page,
  month: string,
  navigate: () => Promise<unknown>,
) {
  const panel = await navigateToClientBudgetPanel(page, month, navigate)
  await expect(panel.getByText('추천 완료', { exact: true })).toBeVisible({ timeout: 15_000 })
}

const suite = test.extend<{ budgetFixture: BudgetAcceptanceFixture }>({
  budgetFixture: async ({ page }, provide) => {
    const supabaseUrl = localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
    const databaseUrl = localEndpoint('DATABASE_URL')
    const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const database = postgres(databaseUrl, { prepare: false, max: 1 })
    const email = `budget-persistence-${randomUUID()}@example.com`
    const password = randomBytes(24).toString('base64url')
    const auth = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (auth.error) throw auth.error
    const userId = auth.data.user.id
    const month = currentMonthInKorea()
    const nextMonth = shiftMonth(month, 1)
    let householdId: string | undefined

    try {
      const [household] = await database`
        insert into households (name) values ('E2E budget persistence') returning id
      `
      const fixtureHouseholdId = household.id as string
      householdId = fixtureHouseholdId
      await database`
        insert into household_members (household_id, user_id, role)
        values (${fixtureHouseholdId}, ${userId}, 'owner')
      `
      const [food] = await database`
        insert into categories (household_id, kind, major, sub)
        values (${fixtureHouseholdId}, 'expense', '식비', '장보기') returning id
      `
      await database`
        insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, source)
        values
          (${fixtureHouseholdId}, ${`${month.slice(0, 4)}-01-02`}, 'income', 1000000, null, 'E2E 수입', 'e2e'),
          (${fixtureHouseholdId}, ${`${shiftMonth(month, -1)}-15`}, 'expense', 90000, ${food.id}, 'E2E 지난달 장보기', 'e2e'),
          (${fixtureHouseholdId}, ${`${month}-03`}, 'expense', 100000, ${food.id}, 'E2E 장보기', 'e2e')
      `
      await database`
        insert into budgets (household_id, month, major, amount)
        values (${fixtureHouseholdId}, ${month}, '식비', 350000)
      `
      const token = randomBytes(32).toString('base64url')
      const tokenHash = createHash('sha256').update(token).digest('hex')
      await database`
        insert into diagnosis_workers (household_id, token_hash, label)
        values (${fixtureHouseholdId}, ${tokenHash}, 'E2E budget persistence worker')
      `

      await signIn(page, email, password)
      await provide({
        admin, anon, database, email, password, householdId: fixtureHouseholdId, userId, token,
        foodCategoryId: food.id, month, nextMonth,
      })
    } finally {
      if (householdId) await database`delete from households where id = ${householdId}`
      const deleted = await admin.auth.admin.deleteUser(userId)
      if (deleted.error) throw deleted.error
      await database.end()
    }
  },
})

suite.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

suite('keeps manual saving available while a fixture worker is unsupported, absent, or offline', async ({ page, budgetFixture }) => {
  const fixture = budgetFixture
  await page.goto(`/budgets?month=${fixture.month}`)

  const saveManual = async (amount: string) => {
    await page.getByLabel('식비 예산', { exact: true }).fill(amount)
    await expect(page.getByText(`입력 합계 ${Number(amount).toLocaleString('ko-KR')}원`, { exact: true })).toBeVisible()
    const overageConsent = page.getByRole('checkbox', { name: '미분류·정기 지출을 포함한 전체 예산의 상한 초과를 확인하고 저장합니다.', exact: true })
    if (await overageConsent.isVisible()) await overageConsent.check()
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible({ timeout: 15_000 })
  }

  await expect(page.getByText('Mac의 AI 작업기 업데이트가 필요합니다.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 예산 추천', exact: true })).toBeDisabled()
  await saveManual('351000')

  localEndpoint('DATABASE_URL')
  localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
  await fixture.database`
    delete from diagnosis_workers where household_id = ${fixture.householdId}
  `
  const absentPanel = await navigateToClientBudgetPanel(page, fixture.month, () => page.reload())
  await expect(absentPanel.getByText(
    'Mac AI 작업기가 아직 연결되지 않았습니다.', { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 예산 추천', exact: true })).toBeDisabled()
  await saveManual('352000')

  localEndpoint('DATABASE_URL')
  localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
  const tokenHash = createHash('sha256').update(fixture.token).digest('hex')
  await fixture.database`
    insert into diagnosis_workers (household_id, token_hash, label)
    values (${fixture.householdId}, ${tokenHash}, 'E2E restored budget worker')
  `
  await refreshCapabilities(fixture)
  await fixture.database`
    update diagnosis_workers
    set budget_last_seen_at = now() - interval '91 seconds',
        prompt_last_seen_at = now() - interval '91 seconds'
    where household_id = ${fixture.householdId}
  `
  const offlinePanel = await navigateToClientBudgetPanel(page, fixture.month, () => page.reload())
  await expect(offlinePanel.getByText(
    'Mac이 오프라인입니다. 요청은 저장되며 Mac이 다시 연결되면 자동으로 시작합니다.',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 예산 추천', exact: true })).toBeEnabled()
  await saveManual('353000')

  await refreshCapabilities(fixture)
  const readyPanel = await navigateToClientBudgetPanel(page, fixture.month, () => page.reload())
  await expect(readyPanel.getByText(/Mac이 오프라인입니다/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 예산 추천', exact: true })).toBeEnabled()
  const [saved] = await fixture.database`
    select amount::int as amount, recommendation_job_id from budgets
    where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
  `
  expect(saved).toEqual({ amount: 353_000, recommendation_job_id: null })
})

suite('persists a real completed recommendation with its adjusted amount and frozen reasons', async ({ page, budgetFixture }, testInfo) => {
  suite.setTimeout(120_000)
  const fixture = budgetFixture
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await refreshCapabilities(fixture)
  await page.goto(`/budgets/review?month=${fixture.month}`)
  await expect(page).toHaveURL(`/budgets?month=${fixture.month}`)
  await expect(page.getByRole('heading', {
    name: `${fixture.month.slice(0, 4)}년 ${Number(fixture.month.slice(5, 7))}월 AI 예산 추천`, exact: true,
  })).toBeVisible()
  expect(fixture.nextMonth).toBe(shiftMonth(fixture.month, 1))

  await page.getByLabel('추천에 전달할 참고 메모', { exact: true }).fill('가족 식사를 우선해 주세요.')
  await page.getByLabel('예정 지출 카테고리', { exact: true }).selectOption({ label: '식비' })
  await page.getByLabel('예정 지출 금액', { exact: true }).fill('20000')
  await page.getByLabel('예정 지출 메모', { exact: true }).fill('가족 식사')
  await page.getByRole('button', { name: '예정 지출 추가', exact: true }).click()

  const job = await enqueueAndComplete(page, fixture)
  expect(job.snapshot.input).toMatchObject({
    month: fixture.month,
    notes: '가족 식사를 우선해 주세요.',
    plannedExpenses: [{ major: '식비', amount: 20_000, note: '가족 식사' }],
    draftAmounts: [{ major: '식비', amount: 350_000 }],
  })
  expect(job.snapshot.evidence.find(row => row.major === '식비'))
    .toMatchObject({ id: expect.any(Number), merchant: 'E2E 장보기' })

  const [beforeApply] = await fixture.database`
    select amount::int as amount, recommendation_job_id from budgets
    where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
  `
  expect(beforeApply).toEqual({ amount: 350_000, recommendation_job_id: null })

  const selection = page.getByRole('checkbox', { name: '식비 추천 선택', exact: true })
  await expect(selection).not.toBeChecked()
  await selection.check()
  await page.getByRole('button', { name: '선택한 추천 가져오기', exact: true }).click()
  const amount = page.getByLabel('식비 예산', { exact: true })
  await expect(amount).toHaveValue('300000')
  await amount.fill('310000')
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible({ timeout: 15_000 })

  await page.reload()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')
  await expect(page.getByText('사용자 조정 310,000원', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '식비 추천 이유', exact: true }).click()
  await expect(page.getByText('기록된 장보기 비용을 포함해 배정했습니다.', { exact: true })).toBeVisible()
  const historicalEvidence = page.getByRole('link', { name: /E2E 지난달 장보기/ }).first()
  await expect(historicalEvidence).toBeVisible()
  await historicalEvidence.click()
  await expect(page).toHaveURL((url) => url.pathname === '/ledger'
    && url.searchParams.get('month') === shiftMonth(fixture.month, -1)
    && url.searchParams.get('tab') === 'list'
    && url.searchParams.get('flow') === 'expense'
    && url.searchParams.get('major') === '식비')
  await expect(page.getByRole('row', { name: /E2E 지난달 장보기/ })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')
  expect(await page.locator('[aria-label="식비 예산"]').count()).toBe(1)
  expect(await page.locator(`#budget-recommendation-title-${fixture.month}`).count()).toBe(1)
  await expect(page.getByRole('region', { name: 'AI 추천 검토', exact: true })).toHaveCount(1)
  const reasonButton = page.getByRole('button', { name: '식비 추천 이유', exact: true })
  const reasonDetails = page.locator('details').filter({ has: reasonButton })
  if (await reasonDetails.getAttribute('open') === null) await reasonButton.click()
  await expect(reasonDetails).toHaveAttribute('open', '')

  const [saved] = await fixture.database`
    select amount::int as amount, recommendation_job_id from budgets
    where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
  `
  expect(saved).toEqual({ amount: 310_000, recommendation_job_id: job.id })

  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('budget-planning-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('budget-planning-mobile.png'), fullPage: true })
  await page.evaluate(() => {
    localStorage.setItem('finance-theme', 'dark')
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.dataset.themePreference = 'dark'
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('budget-planning-dark.png'), fullPage: true })
  await reasonDetails.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: testInfo.outputPath('budget-planning-dark-viewport.png') })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => {
    localStorage.setItem('finance-theme', 'light')
    document.documentElement.dataset.theme = 'light'
    document.documentElement.dataset.themePreference = 'light'
  })
  await refreshCapabilities(fixture)
  const rerunResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' && url.pathname === '/api/budget-recommendations'
  })
  await page.getByRole('button', { name: '다시 추천하기', exact: true }).click()
  expect((await rerunResponse).ok()).toBe(true)
  await expect(page.getByText('예산 추천이 대기 중입니다.', { exact: true })).toBeVisible()
  await expect(page.getByText('완료되면 아래 예산 편집기에서 확인할 수 있습니다. 기다리는 동안 이전 추천은 그대로 남아 있습니다.', { exact: true })).toBeVisible()
  await expect(page.getByText('사용자 조정 310,000원', { exact: true })).toBeVisible()
  const jobs = await fixture.database`
    select id, status from budget_recommendation_jobs
    where household_id = ${fixture.householdId} and month = ${fixture.month}
    order by created_at, id
  `
  expect(jobs).toHaveLength(2)
  expect(jobs[0]).toMatchObject({ id: job.id, status: 'completed' })
  expect(jobs[1]).toMatchObject({ status: 'queued' })
  expect(jobs[1].id).not.toBe(job.id)
  expect(pageErrors).toEqual([])
})

suite('rejects stale-window and stale-source AI saves until the user converts the draft to manual', async ({ browser, page, budgetFixture }, testInfo) => {
  suite.setTimeout(120_000)
  const fixture = budgetFixture
  const primaryErrors: string[] = []
  let otherContext: Awaited<ReturnType<typeof browser.newContext>> | null = null
  page.on('pageerror', error => primaryErrors.push(error.message))
  try {
    await refreshCapabilities(fixture)
    await page.goto(`/budgets?month=${fixture.month}`)
    const job = await enqueueAndComplete(page, fixture)
    await page.getByRole('checkbox', { name: '식비 추천 선택', exact: true }).check()
    await page.getByRole('button', { name: '선택한 추천 가져오기', exact: true }).click()
    await page.getByLabel('식비 예산', { exact: true }).fill('310000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible({ timeout: 15_000 })
    await waitForCompletedBudgetPanel(page, fixture.month, () => page.reload())

    otherContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
    const other = await otherContext.newPage()
    const otherErrors: string[] = []
    other.on('pageerror', error => otherErrors.push(error.message))
    await other.emulateMedia({ reducedMotion: 'reduce' })
    await signIn(other, fixture.email, fixture.password)
    await waitForCompletedBudgetPanel(
      other,
      fixture.month,
      () => other.goto(`/budgets?month=${fixture.month}`),
    )
    await expect(other.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')

    await page.getByLabel('식비 예산', { exact: true }).fill('315000')
    await other.getByLabel('식비 예산', { exact: true }).fill('320000')
    let otherSavePostCount = 0
    const countOtherSavePost = (request: import('@playwright/test').Request) => {
      if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) otherSavePostCount += 1
    }
    other.on('request', countOtherSavePost)
    try {
      await other.getByRole('button', { name: '변경사항 저장', exact: true }).click()
      await expect(other.getByRole('button', { name: '저장됨', exact: true })).toBeVisible({ timeout: 15_000 })
    } finally {
      other.off('request', countOtherSavePost)
      const path = testInfo.outputPath('other-save-next-action-post-count.json')
      await writeFile(path, JSON.stringify({ nextActionPostCount: otherSavePostCount }))
      await testInfo.attach('other-save-next-action-post-count', { path, contentType: 'application/json' })
    }
    expect(otherSavePostCount, 'winning save must issue one Next-Action POST').toBe(1)
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(page.locator('section[aria-label="예산 충돌 비교"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '최신 예산 불러와 비교', exact: true })).toBeVisible()
    const [afterConflict] = await fixture.database`
      select amount::int as amount, recommendation_job_id from budgets
      where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
    `
    expect(afterConflict).toEqual({ amount: 320_000, recommendation_job_id: job.id })

    localEndpoint('DATABASE_URL')
    localEndpoint('NEXT_PUBLIC_SUPABASE_URL')
    await fixture.database`
      insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, source)
      values (${fixture.householdId}, ${`${fixture.month}-04`}, 'expense', 5000,
        ${fixture.foodCategoryId}, 'E2E 추가 장보기', 'e2e')
    `
    await other.reload()
    await expect(other.getByText('기록이 변경되어 재추천이 필요합니다.', { exact: true })).toBeVisible()
    await other.getByLabel('식비 예산', { exact: true }).fill('330000')
    await other.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(other.getByText(
      '추천 이후 근거가 변경되었습니다. 다시 추천받거나 수동 초안으로 전환해 주세요.', { exact: true },
    )).toBeVisible()
    const [afterStaleSave] = await fixture.database`
      select amount::int as amount, recommendation_job_id from budgets
      where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
    `
    expect(afterStaleSave).toEqual({ amount: 320_000, recommendation_job_id: job.id })

    await other.getByRole('button', { name: '식비 수동 초안으로 전환', exact: true }).click()
    await other.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(other.getByRole('button', { name: '저장됨', exact: true })).toBeVisible({ timeout: 15_000 })
    const [manual] = await fixture.database`
      select amount::int as amount, recommendation_job_id from budgets
      where household_id = ${fixture.householdId} and month = ${fixture.month} and major = '식비'
    `
    expect(manual).toEqual({ amount: 330_000, recommendation_job_id: null })
    await other.reload()
    await expect(other.getByLabel('식비 예산', { exact: true })).toHaveValue('330000')
    await expect(other.getByText('수동 예산', { exact: true })).toBeVisible()
    expect(otherErrors).toEqual([])
    expect(primaryErrors).toEqual([])
  } finally {
    if (otherContext) await otherContext.close()
  }
})

import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import type { BudgetRecommendationData } from '@/features/budget-recommendations/types'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Budget recommendation E2E requires local Supabase')
  }
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

test('reviews a recommendation in the single editor without persisting the fake job', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const admin = adminClient()
  const month = currentMonthInKorea()
  const previousMonth = shiftMonth(month, -1)
  const email = `budget-recommendation-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  const { data: auth, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (authError) throw authError
  let householdId: string | undefined
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  try {
    const { data: household, error: householdError } = await admin.from('households')
      .insert({ name: 'Budget recommendation E2E' }).select('id').single()
    if (householdError) throw householdError
    householdId = household.id
    const { error: memberError } = await admin.from('household_members')
      .insert({ household_id: householdId, user_id: auth.user!.id, role: 'owner' })
    if (memberError) throw memberError
    const { data: categories, error: categoryError } = await admin.from('categories')
      .insert([
        { household_id: householdId, kind: 'expense', major: '식비', sub: '식사' },
        { household_id: householdId, kind: 'expense', major: '건강', sub: '병원' },
      ]).select('id, major')
    if (categoryError) throw categoryError
    const food = categories.find(row => row.major === '식비')!
    const year = month.slice(0, 4)
    const { error: transactionError } = await admin.from('transactions').insert([
      { household_id: householdId, date: `${year}-01-02`, flow: 'income', amount: 1_000_000, source: 'e2e' },
      { household_id: householdId, date: `${month}-01`, flow: 'expense', amount: 100_000, category_id: food.id, source: 'e2e' },
    ])
    if (transactionError) throw transactionError
    const { error: budgetError } = await admin.from('budgets').insert([
      { household_id: householdId, month, major: '식비', amount: 350_000 },
      { household_id: householdId, month, major: '건강', amount: 100_000 },
      { household_id: householdId, month: previousMonth, major: '식비', amount: 330_000 },
      { household_id: householdId, month: previousMonth, major: '건강', amount: 90_000 },
    ])
    if (budgetError) throw budgetError

    const snapshot = makeBudgetSnapshot()
    snapshot.month = month
    snapshot.asOfDate = `${month}-10`
    snapshot.input.month = month
    snapshot.budgetState.month = month
    snapshot.budgetState.current[0].sourceMonth = month
    snapshot.basis.incomeStart = `${year}-01-01`
    snapshot.basis.incomeEnd = `${month}-01`
    snapshot.evidence[0].date = `${month}-01`
    const report = makeBudgetReport()
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const completed: BudgetRecommendationData = {
      month,
      latestJob: { id: jobId, status: 'completed', errorCode: null },
      completed: {
        id: jobId,
        completedAt: `${month}-10T03:00:00.000Z`,
        snapshot,
        promptInput: null,
        report,
        evaluation: evaluateBudget(snapshot, report.rows),
      },
      worker: 'ready',
      availability: 'available',
      freshness: 'current',
      instructionsChanged: false,
    }
    const rerunSnapshot = structuredClone(snapshot)
    rerunSnapshot.evidence[0].merchant = '두 번째 추천 마트'
    const rerunReport = structuredClone(report)
    rerunReport.rows[0].amount = 280_000
    rerunReport.rows[0].reason = '두 번째 추천의 식비 근거입니다.'
    const rerunJobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const rerun: BudgetRecommendationData = {
      ...completed,
      latestJob: { id: rerunJobId, status: 'completed', errorCode: null },
      completed: {
        id: rerunJobId,
        completedAt: `${month}-10T04:00:00.000Z`,
        snapshot: rerunSnapshot,
        promptInput: null,
        report: rerunReport,
        evaluation: evaluateBudget(rerunSnapshot, rerunReport.rows),
      },
    }
    const empty: BudgetRecommendationData = { ...completed, latestJob: null, completed: null }
    const postedBodies: Record<string, unknown>[] = []
    let activeResponse: BudgetRecommendationData = empty
    await page.route('**/api/budget-recommendations?month=*', async route => {
      if (route.request().method() === 'POST') {
        const request = route.request().postDataJSON() as Record<string, unknown>
        postedBodies.push(request)
        expect(request.month).toBe(month)
        expect(request.draftAmounts).toContainEqual({
          major: '식비',
          amount: postedBodies.length <= 3 ? 350_000 : postedBodies.length === 4 ? 300_000 : 310_000,
        })
        if (postedBodies.length === 1) {
          // A job ID is not a request ID: this other intent must not acknowledge ours.
          activeResponse = { ...empty, latestJob: {
            id: String(request.requestId), requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            status: 'failed', errorCode: 'cli_failed',
          } }
          await route.abort('connectionfailed')
          return
        }
        if (postedBodies.length === 2) {
          await route.fulfill({ status: 409, json: { error: 'request_conflict' } })
          return
        }
        if (postedBodies.length >= 5) {
          const recoveredJobId = postedBodies.length === 5
            ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
          activeResponse = {
            ...rerun,
            latestJob: { id: recoveredJobId, requestId: String(request.requestId), status: postedBodies.length === 5 ? 'running' : 'completed', errorCode: null },
            completed: postedBodies.length === 5 ? rerun.completed : { ...rerun.completed!, id: recoveredJobId, requestId: String(request.requestId) },
          }
          await route.abort('connectionfailed')
          return
        }
        const result = postedBodies.length === 3 ? completed : rerun
        activeResponse = { ...result,
          latestJob: { ...result.latestJob!, requestId: String(request.requestId) },
          completed: { ...result.completed!, requestId: String(request.requestId) },
        }
        await route.fulfill({ json: activeResponse })
        return
      }
      const lookup = new URL(route.request().url()).searchParams.get('requestId')
      if (lookup) expect(lookup).toBe(postedBodies.at(-1)?.requestId)
      else if (activeResponse.latestJob?.status === 'running') {
        activeResponse = { ...activeResponse,
          latestJob: { ...activeResponse.latestJob, status: 'completed' },
          completed: { ...rerun.completed!, id: activeResponse.latestJob.id, requestId: activeResponse.latestJob.requestId },
        }
      }
      await route.fulfill({ json: activeResponse })
    })

    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.goto(`/budgets?month=${month}`)
    const amount = page.getByLabel('식비 예산', { exact: true })
    const foodRow = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '식비', exact: true }) })
    const requestDialog = page.getByRole('dialog', { name: 'AI 예산 추천 요청', exact: true })
    const requestAgain = async () => {
      if (!await requestDialog.isVisible()) await page.getByRole('button', { name: /^(AI 추천 받기|다시 추천|다시 시도)$/, exact: true }).click()
      await requestDialog.getByRole('button', { name: '추천 요청', exact: true }).click()
    }
    await page.locator('.plan-toolbar__fills').getByRole('button', { name: '지난달 예산', exact: true }).click()
    if (await page.getByRole('dialog', { name: '전체 채우기 확인', exact: true }).isVisible()) await page.getByRole('button', { name: '모두 채우기', exact: true }).click()
    await expect(amount).toHaveValue('330000')
    await page.getByRole('button', { name: '실행 취소', exact: true }).click()
    await expect(amount).toHaveValue('350000')
    await requestAgain()
    await expect(requestDialog.getByRole('button', { name: '같은 요청 다시 보내기', exact: true })).toBeVisible()
    await page.getByLabel('참고 메모', { exact: true }).fill('충돌 다음 요청에는 이 메모를 사용합니다.')
    await requestDialog.getByRole('button', { name: '같은 요청 다시 보내기', exact: true }).click()
    await expect(requestDialog.getByRole('button', { name: '추천 요청', exact: true })).toBeVisible()
    expect(postedBodies[1]).toEqual(postedBodies[0])
    await requestAgain()
    await expect(page.getByRole('button', { name: '다시 추천', exact: true })).toBeVisible()
    expect(postedBodies[2].requestId).not.toBe(postedBodies[0].requestId)
    expect(postedBodies[2].notes).toBe('충돌 다음 요청에는 이 메모를 사용합니다.')
    await expect(amount).toHaveValue('350000')
    const selection = foodRow.getByRole('button', { name: /^AI 추천 / })
    await expect(selection).toHaveAttribute('aria-pressed', 'false')
    await selection.click()
    await expect(selection).toHaveAttribute('aria-pressed', 'true')
    await expect(amount).toHaveValue('300000')
    await expect(page.getByText('아직 저장하지 않은 편집안', { exact: true })).toBeVisible()
    await requestAgain()
    await expect(foodRow.locator('.plan-item__reason')).toHaveText('두 번째 추천의 식비 근거입니다.')
    await expect(foodRow.getByRole('button', { name: /^AI 추천 280,000/ })).toBeVisible()
    await expect(foodRow.getByText(/AI 추천.*300,000/)).toBeVisible()
    await page.locator('.plan-toolbar__fills').getByRole('button', { name: '지난달 예산', exact: true }).click()
    if (await page.getByRole('dialog', { name: '전체 채우기 확인', exact: true }).isVisible()) await page.getByRole('button', { name: '모두 채우기', exact: true }).click()
    await expect(amount).toHaveValue('330000')
    await page.getByRole('button', { name: '실행 취소', exact: true }).click()
    await expect(amount).toHaveValue('300000')
    await foodRow.getByRole('button', { name: '근거', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '식비 AI 추천 근거', exact: true }).getByText('기록된 장보기 비용을 포함해 배정했습니다.', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    const { data: untouched, error: untouchedError } = await admin.from('budgets').select('amount, recommendation_job_id')
      .eq('household_id', householdId).eq('month', month).eq('major', '식비').single()
    if (untouchedError) throw untouchedError
    expect(untouched).toEqual({ amount: 350_000, recommendation_job_id: null })

    const { error: competingSaveError } = await admin.from('budgets').upsert([
      { household_id: householdId, month, major: '식비', amount: 360_000 },
      { household_id: householdId, month, major: '건강', amount: 120_000 },
    ], { onConflict: 'household_id,major,month' })
    if (competingSaveError) throw competingSaveError
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '최신 예산 불러와 비교', exact: true })).toBeVisible()
    let releaseRefresh!: () => void
    let markRefreshStarted!: () => void
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve })
    const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve })
    await page.route(`**/budgets?month=${month}*`, async route => {
      if (route.request().method() === 'GET') {
        markRefreshStarted()
        await refreshGate
      }
      await route.continue()
    })
    await page.getByRole('button', { name: '최신 예산 불러와 비교', exact: true }).click()
    await refreshStarted
    await page.getByRole('button', { name: /목표 저축률 \d+%/ }).click()
    await page.getByLabel('목표 저축률', { exact: true }).fill('35')
    releaseRefresh()
    await expect(amount).toHaveValue('300000')
    await expect(page.getByLabel('건강 예산', { exact: true })).toHaveValue('120000')
    await expect(page.getByLabel('목표 저축률', { exact: true })).toHaveValue('35')
    await page.unroute(`**/budgets?month=${month}*`)
    await foodRow.getByRole('button', { name: /^지난달 예산 / }).click()
    await amount.fill('300000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    const savedAcknowledgement = page.locator('p').getByText('저장됨', { exact: true })
    await expect(savedAcknowledgement).toBeVisible()
    await amount.fill('310000')
    await expect(savedAcknowledgement).toHaveCount(0)
    await expect(page.getByRole('button', { name: '변경사항 저장', exact: true })).toBeEnabled()
    expect(await page.locator('[aria-label="식비 예산"]').count()).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('budget-recommendation-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      localStorage.setItem('finance-theme', 'dark')
      document.documentElement.dataset.theme = 'dark'
      document.documentElement.dataset.themePreference = 'dark'
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('budget-recommendation-mobile-dark.png'), fullPage: true })
    await foodRow.getByRole('button', { name: '더 보기', exact: true }).click()
    await page.getByLabel('식비 예산', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('budget-recommendation-mobile-row-dark.png'), fullPage: false })

    await page.keyboard.press('Escape')
    // Lost responses recover the matching running/completed job without replaying POST.
    await requestAgain()
    await expect(page.getByRole('button', { name: '분석 중…', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '같은 요청 다시 보내기', exact: true })).toHaveCount(0)
    // Normal polling is five seconds; allow one poll plus response/render time.
    await expect(page.getByRole('button', { name: '다시 추천', exact: true })).toBeEnabled({ timeout: 10_000 })
    expect(postedBodies).toHaveLength(5)
    expect(postedBodies[4].requestId).not.toBe(postedBodies[3].requestId)
    await requestAgain()
    await expect.poll(() => postedBodies.length).toBe(6)
    await expect(page.getByRole('button', { name: '다시 추천', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '같은 요청 다시 보내기', exact: true })).toHaveCount(0)
    expect(postedBodies[5].requestId).not.toBe(postedBodies[4].requestId)
    await expect(amount).toHaveValue('310000')
    expect(pageErrors).toEqual([])
  } finally {
    if (householdId) {
      const { error } = await admin.from('households').delete().eq('id', householdId)
      if (error) throw error
    }
    const { error } = await admin.auth.admin.deleteUser(auth.user!.id)
    if (error) throw error
  }
})

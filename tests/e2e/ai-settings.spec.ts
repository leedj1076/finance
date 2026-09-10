import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

test('AI settings preview, save, conflict and responsive dark layout', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const databaseUrl = process.env.DATABASE_URL!
  const budgetMonth = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date())
  const instructionA = '설명은 짧게, 육아 지출을 중점적으로 봐 주세요.'
  const instructionB = '공통 지침 B: 반복 지출을 먼저 설명해 주세요.'
  for (const value of [supabaseUrl, databaseUrl]) if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('AI settings E2E requires local Supabase')
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const database = postgres(databaseUrl, { prepare: false, max: 1 })
  const email = `ai-settings-e2e-${crypto.randomUUID()}@example.com`
  const password = randomBytes(20).toString('base64url')
  const auth = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error) throw auth.error
  let householdId: string | undefined
  try {
    const [household] = await database`insert into households (name) values ('AI settings E2E') returning id`
    householdId = household.id
    await database`insert into household_members (household_id, user_id) values (${householdId!}, ${auth.data.user.id})`
    const categories = await database`insert into categories (household_id, kind, major, sub) values
      (${householdId!}, 'income', '월급', '급여'), (${householdId!}, 'expense', '식비', '장보기') returning id, kind`
    await database`insert into transactions (household_id, date, flow, amount, category_id, raw_merchant, source) values
      (${householdId!}, '2026-07-01', 'income', 5000000, ${categories.find(row => row.kind === 'income')!.id}, '월급', 'e2e'),
      (${householdId!}, '2026-07-02', 'expense', 120000, ${categories.find(row => row.kind === 'expense')!.id}, 'E2E 마트', 'e2e'),
      (${householdId!}, ${`${budgetMonth}-01`}, 'income', 5000000, ${categories.find(row => row.kind === 'income')!.id}, '예산 월급', 'e2e'),
      (${householdId!}, ${`${budgetMonth}-02`}, 'expense', 120000, ${categories.find(row => row.kind === 'expense')!.id}, '예산 마트', 'e2e')`
    const token = randomBytes(32).toString('base64url')
    await database`insert into diagnosis_workers (household_id, token_hash, label, last_seen_at, prompt_protocol_version, prompt_last_seen_at, budget_protocol_version, budget_last_seen_at, configured_model, configured_timeout_ms)
      values (${householdId!}, ${createHash('sha256').update(token).digest('hex')}, 'E2E Mac', now(), 1, now(), 1, now(), null, 180000)`

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.goto('/settings?section=ai')
    await expect(page.getByRole('heading', { name: 'AI 진단 설정', exact: true })).toBeVisible()
    await expect(page.getByText('CLI 기본값', { exact: true })).toBeVisible()

    const common = page.getByLabel('공통 분석 지침', { exact: true })
    const ledger = page.getByLabel('내역 진단 지침', { exact: true })
    const budget = page.getByLabel('예산 추천 지침', { exact: true })
    await expect(common).toHaveValue(/한국어로/)

    const budgetDefault = await budget.inputValue()
    await budget.fill('')
    await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(page.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()
    expect((await database`select budget_instructions from ai_diagnosis_settings where household_id=${householdId!}`)[0].budget_instructions).toBe('')
    await page.getByRole('button', { name: '예산 추천 지침 기본값 복원', exact: true }).click()
    await expect(budget).toHaveValue(budgetDefault)
    expect((await database`select budget_instructions from ai_diagnosis_settings where household_id=${householdId!}`)[0].budget_instructions).toBe('')

    await common.fill(instructionA)
    await ledger.fill('내역 지침 A')
    await budget.fill('예산 지침 A')
    await page.getByLabel('대상 월', { exact: true }).fill('2026-07')
    const before = await database`select (select count(*)::int from diagnosis_jobs where household_id=${householdId!}) ledger,
      (select count(*)::int from budget_recommendation_jobs where household_id=${householdId!}) budget,
      (select revision from ai_diagnosis_settings where household_id=${householdId!}) revision`
    await page.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
    await expect(page.getByText('미저장 편집안 기준', { exact: false })).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: instructionA })).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: '내역 지침 A' })).toBeVisible()
    expect(await database`select (select count(*)::int from diagnosis_jobs where household_id=${householdId!}) ledger,
      (select count(*)::int from budget_recommendation_jobs where household_id=${householdId!}) budget,
      (select revision from ai_diagnosis_settings where household_id=${householdId!}) revision`).toEqual(before)

    await page.getByRole('combobox', { name: '진단 종류', exact: true }).selectOption('budget')
    await page.getByLabel('대상 월', { exact: true }).fill(budgetMonth)
    await page.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
    await expect(page.getByRole('heading', { name: `${budgetMonth} 예산 추천 프롬프트`, exact: true })).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: instructionA })).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: '예산 지침 A' })).toBeVisible()

    await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(page.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('공통 분석 지침', { exact: true })).toHaveValue(instructionA)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('ai-settings-desktop.png'), fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'AI 진단 설정', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('ai-settings-mobile-dark.png'), fullPage: true })

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto('/ledger?month=2026-07&tab=ai')
    const panel = page.getByRole('region', { name: '7월 AI 진단', exact: true })
    const requestIds: string[] = []
    let loseFirstResponse = true
    await page.route('**/api/diagnosis?month=2026-07', async route => {
      if (route.request().method() === 'POST') {
        requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId)
        if (loseFirstResponse) {
          loseFirstResponse = false
          await route.fetch()
          await route.abort('failed')
          return
        }
      }
      await route.continue()
    })
    await panel.getByRole('button', { name: '7월 AI 진단하기', exact: true }).first().click()
    await expect(panel.getByRole('alert')).toBeVisible()
    await expect(panel.getByRole('button', { name: '7월 AI 진단하기', exact: true }).first()).toBeEnabled()
    const [queuedA] = await database`select id, request_id, prompt_input from diagnosis_jobs where household_id=${householdId!}`
    expect(queuedA.request_id).toBe(requestIds[0])
    expect(queuedA.prompt_input.instructions.common).toBe(instructionA)

    const settingsPage = await context.newPage()
    await settingsPage.emulateMedia({ reducedMotion: 'reduce' })
    await settingsPage.goto('/settings?section=ai')
    await settingsPage.getByLabel('예산 추천 지침', { exact: true }).fill('예산 지침 B')
    await settingsPage.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(settingsPage.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()

    await panel.getByRole('button', { name: '7월 AI 진단하기', exact: true }).first().click()
    await expect(panel.getByRole('button', { name: '진단 대기 중', exact: true }).first()).toBeVisible()
    expect(requestIds.slice(0, 2)).toEqual([queuedA.request_id, queuedA.request_id])
    const queuedAfterSave = await database`select id, request_id, prompt_input from diagnosis_jobs where household_id=${householdId!}`
    expect(queuedAfterSave).toHaveLength(1)
    expect(queuedAfterSave[0].id).toBe(queuedA.id)
    expect(queuedAfterSave[0].prompt_input.instructions.common).toBe(instructionA)

    const [claimedA] = await database`select public.claim_configured_diagnosis_job(${token}) as job`
    const jobA = claimedA.job
    const report = {
      version: 1,
      headline: '지출 흐름을 확인했어요.',
      summary: '이번 달 수입과 지출을 기록 기준으로 비교했습니다.',
      changes: [],
      trend: { summary: '직전 기록과 함께 살펴봤습니다.', caveat: '기록 범위에 따라 비교가 달라질 수 있습니다.' },
      checks: [],
      actions: [{ title: '다음 달 반복 지출 확인', body: '반복될 지출을 다음 달 계획에 반영해 보세요.' }],
      positive: null,
    }
    expect((await database`select public.finish_diagnosis_job(${token}, ${jobA.id}, ${jobA.claimToken}, ${database.json(report)}, null) as ok`)[0].ok).toBe(true)
    await expect(panel.getByRole('heading', { name: report.headline, exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('진단 지침이 변경되었습니다.', { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: '사용한 프롬프트', exact: true }).click()
    await expect(panel.getByText('요청 당시 기록', { exact: true })).toBeVisible()
    await expect(panel.locator('pre').filter({ hasText: instructionA })).toBeVisible()

    await settingsPage.reload()
    await settingsPage.getByLabel('공통 분석 지침', { exact: true }).fill(instructionB)
    await settingsPage.getByRole('combobox', { name: '진단 종류', exact: true }).selectOption('ledger')
    await settingsPage.getByLabel('대상 월', { exact: true }).fill('2026-07')
    await settingsPage.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
    await expect(settingsPage.locator('pre').filter({ hasText: instructionB })).toBeVisible()
    await settingsPage.getByRole('combobox', { name: '진단 종류', exact: true }).selectOption('budget')
    await settingsPage.getByLabel('대상 월', { exact: true }).fill(budgetMonth)
    await settingsPage.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
    await expect(settingsPage.getByRole('heading', { name: `${budgetMonth} 예산 추천 프롬프트`, exact: true })).toBeVisible()
    await expect(settingsPage.locator('pre').filter({ hasText: instructionB })).toBeVisible()
    await settingsPage.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(settingsPage.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()

    await page.reload()
    await expect(panel.getByText('진단 지침이 변경되었습니다.', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '다시 진단하기', exact: true }).click()
    await expect(panel.getByRole('button', { name: '진단 대기 중', exact: true })).toBeVisible()
    await expect(panel.getByRole('heading', { name: report.headline, exact: true })).toBeVisible()
    const jobs = await database`select id, request_id, prompt_input from diagnosis_jobs where household_id=${householdId!} order by created_at, id`
    expect(jobs).toHaveLength(2)
    const queuedB = jobs.find(row => row.id !== queuedA.id)!
    expect(queuedB.request_id).toBe(requestIds[2])
    expect(queuedB.request_id).not.toBe(queuedA.request_id)
    expect(queuedB.prompt_input.instructions.common).toBe(instructionB)

    const [claimedB] = await database`select public.claim_configured_diagnosis_job(${token}) as job`
    expect(claimedB.job.id).toBe(queuedB.id)
    expect((await database`select public.finish_diagnosis_job(${token}, ${claimedB.job.id}, ${claimedB.job.claimToken}, null, 'cli_failed') as ok`)[0].ok).toBe(true)
    await expect(panel.getByText(/이전 보고서는 그대로 남아 있어요/)).toBeVisible({ timeout: 15_000 })
    await database`insert into diagnosis_jobs
      (household_id, month, snapshot, prompt_input, fingerprint, requested_by, report, status, completed_at)
      values (${householdId!}, '2026-07', ${database.json(jobA.snapshot)}, null, ${'c'.repeat(64)}, ${auth.data.user.id}, ${database.json(report)}, 'completed', now() + interval '1 second')`
    await page.reload()
    await panel.getByRole('button', { name: '사용한 프롬프트', exact: true }).click()
    await expect(panel.getByText('이전 결과 · 사용한 프롬프트 미기록', { exact: true })).toBeVisible()

    await database`update diagnosis_workers set prompt_protocol_version=0, prompt_last_seen_at=null, budget_protocol_version=0, budget_last_seen_at=null where household_id=${householdId!}`
    await page.reload()
    await expect(panel.getByText('Mac의 AI 작업기를 업데이트해 주세요.', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: '다시 진단하기', exact: true })).toBeDisabled()
    await expect(panel.getByRole('heading', { name: report.headline, exact: true })).toBeVisible()

    await settingsPage.reload()
    await expect(settingsPage.getByText('업데이트 필요', { exact: true }).first()).toBeVisible()
    await settingsPage.getByLabel('내역 진단 지침', { exact: true }).fill('내역 로컬 편집')
    await database`update ai_diagnosis_settings set common_instructions='다른 창 저장', revision=revision+1 where household_id=${householdId!}`
    await settingsPage.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(settingsPage.getByText('다른 창에서 AI 설정을 먼저 저장했습니다.', { exact: false })).toBeVisible()
    await expect(settingsPage.getByLabel('내역 진단 지침', { exact: true })).toHaveValue('내역 로컬 편집')
    await settingsPage.close()
  } finally {
    if (householdId) await database`delete from households where id = ${householdId}`
    await admin.auth.admin.deleteUser(auth.data.user.id)
    await database.end()
  }
})

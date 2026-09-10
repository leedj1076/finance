import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

test('AI settings preview, save, conflict and responsive dark layout', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const databaseUrl = process.env.DATABASE_URL!
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
      (${householdId!}, '2026-07-02', 'expense', 120000, ${categories.find(row => row.kind === 'expense')!.id}, 'E2E 마트', 'e2e')`
    const token = randomBytes(32).toString('base64url')
    await database`insert into diagnosis_workers (household_id, token_hash, label, last_seen_at, prompt_protocol_version, prompt_last_seen_at, budget_protocol_version, budget_last_seen_at, configured_model, configured_timeout_ms)
      values (${householdId!}, ${createHash('sha256').update(token).digest('hex')}, 'E2E Mac', now(), 1, now(), 1, now(), null, 180000)`

    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.goto('/settings?section=ai')
    await expect(page.getByRole('heading', { name: 'AI 진단 설정', exact: true })).toBeVisible()
    await expect(page.getByText('CLI 기본값', { exact: true })).toBeVisible()

    const common = page.getByLabel('공통 분석 지침', { exact: true })
    await expect(common).toHaveValue(/한국어로/)
    await common.fill('설명은 짧게, 육아 지출을 중점적으로 봐 주세요.')
    await page.getByLabel('대상 월', { exact: true }).fill('2026-07')
    const before = await database`select (select count(*)::int from diagnosis_jobs where household_id=${householdId!}) ledger,
      (select count(*)::int from budget_recommendation_jobs where household_id=${householdId!}) budget,
      (select revision from ai_diagnosis_settings where household_id=${householdId!}) revision`
    await page.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
    await expect(page.getByText('미저장 편집안 기준', { exact: false })).toBeVisible()
    expect(await database`select (select count(*)::int from diagnosis_jobs where household_id=${householdId!}) ledger,
      (select count(*)::int from budget_recommendation_jobs where household_id=${householdId!}) budget,
      (select revision from ai_diagnosis_settings where household_id=${householdId!}) revision`).toEqual(before)

    await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(page.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('공통 분석 지침', { exact: true })).toHaveValue('설명은 짧게, 육아 지출을 중점적으로 봐 주세요.')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('ai-settings-desktop.png'), fullPage: true })

    await page.getByLabel('내역 진단 지침', { exact: true }).fill('내역 로컬 편집')
    await database`update ai_diagnosis_settings set common_instructions='다른 창 저장', revision=revision+1 where household_id=${householdId!}`
    await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
    await expect(page.getByText('다른 창에서 AI 설정을 먼저 저장했습니다.', { exact: false })).toBeVisible()
    await expect(page.getByLabel('내역 진단 지침', { exact: true })).toHaveValue('내역 로컬 편집')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'AI 진단 설정', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('ai-settings-mobile-dark.png'), fullPage: true })
  } finally {
    if (householdId) await database`delete from households where id = ${householdId}`
    await admin.auth.admin.deleteUser(auth.data.user.id)
    await database.end()
  }
})

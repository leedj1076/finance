import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

test('investment space: account, manual trades, holdings totals, collapse, detail memo', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const databaseUrl = process.env.DATABASE_URL!
  for (const value of [supabaseUrl, databaseUrl]) {
    if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('investment E2E requires local Supabase')
  }
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const database = postgres(databaseUrl, { prepare: false, max: 1 })
  const email = `investment-e2e-${crypto.randomUUID()}@example.com`
  const password = randomBytes(20).toString('base64url')
  const auth = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error) throw auth.error
  const errors: string[] = []
  page.on('pageerror', error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`))
  let householdId: string | undefined
  try {
    const [household] = await database`insert into households (name) values ('investment E2E') returning id`
    householdId = household.id
    await database`insert into household_members (household_id, user_id) values (${householdId!}, ${auth.data.user.id})`
    await database`insert into fx_rates (household_id, date, pair, rate, source) values (${householdId!}, '2026-09-27', 'USDKRW', 1380.2, 'manual')`

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.getByRole('button', { name: '공간 전환' }).click()
    await page.getByRole('menuitem', { name: /우리집 투자/ }).click()
    await expect(page).toHaveURL('/investment')
    await expect(page.getByRole('heading', { name: /^보유/, level: 1 })).toBeVisible()
    await expect(page.getByText('계좌가 없습니다')).toBeVisible()

    await page.goto('/investment/settings')
    await page.getByLabel('소유자').fill('DJ')
    await page.getByLabel('계좌 이름').fill('DJ 키움 종합')
    await page.getByLabel('계좌번호').fill('12345678')
    await page.getByLabel('키체인 항목 이름').fill('dj-kiwoom')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await expect(page.getByText('계좌를 추가했습니다')).toBeVisible()

    await page.goto('/investment/watch')
    await page.getByLabel('종목코드').fill('005930')
    await page.getByLabel('이름', { exact: true }).fill('삼성전자')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await expect(page.getByText('관심 종목을 추가했습니다')).toBeVisible()

    await page.goto('/investment/transactions')
    await page.locator('summary').filter({ hasText: '거래 추가' }).click()
    const form = page.locator('form').filter({ has: page.locator('select[name="kind"]') })
    await form.locator('select[name="kind"]').selectOption('deposit')
    await form.getByLabel('금액', { exact: true }).fill('10000000')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('거래를 저장했습니다')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await form.locator('select[name="kind"]').selectOption('buy')
    await form.locator('select[name="securityId"]').selectOption({ label: '삼성전자 (005930)' })
    await form.getByLabel('수량', { exact: true }).fill('120')
    await form.getByLabel('단가', { exact: true }).fill('71200')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(2)
    await expect(page.getByText('거래를 저장했습니다')).toBeVisible()
    await form.locator('select[name="kind"]').selectOption('sell')
    await form.getByLabel('수량', { exact: true }).fill('200')
    await form.getByLabel('단가', { exact: true }).fill('80000')
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('보유 120주보다 많이 팔 수 없습니다')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(2)

    await page.goto('/investment')
    const table = page.locator('.investment-holdings')
    await expect(table.getByText('DJ 키움 종합', { exact: false })).toBeVisible()
    await expect(table.getByRole('link', { name: /삼성전자/ })).toBeVisible()
    await expect(table.getByText('시세 없음').first()).toBeVisible()
    await expect(table.getByText('71,200', { exact: true })).toBeVisible()
    await expect(table.getByText(/예수금 ₩1,456,000/)).toBeVisible()
    await expect(page.locator('.kpi-band').getByText('–', { exact: true }).first()).toBeVisible()
    const subgroup = table.getByRole('button', { name: /^국내/ })
    await subgroup.click()
    await expect(table.getByRole('link', { name: /삼성전자/ })).toHaveCount(0)
    await page.reload()
    await expect(subgroup).toHaveAttribute('aria-expanded', 'false')
    await expect(table.getByRole('link', { name: /삼성전자/ })).toHaveCount(0)
    await subgroup.click()
    await expect(table.getByRole('link', { name: /삼성전자/ })).toBeVisible()

    await table.getByRole('link', { name: /삼성전자/ }).click()
    await expect(page.getByRole('heading', { name: /^삼성전자/, level: 1 })).toBeVisible()
    const detailUrl = page.url()
    const memo = page.locator('form').filter({ has: page.locator('input[name="thesis"]') })
    await memo.getByLabel('매수 논지').fill('HBM 수요')
    await memo.getByLabel('투자 기간').fill('5')
    await memo.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('보유 메모를 저장했습니다')).toBeVisible()
    await page.reload()
    await expect(memo.getByLabel('매수 논지')).toHaveValue('HBM 수요')
    await expect(memo.getByLabel('투자 기간')).toHaveValue('5')

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/investment')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      if (width === 390) {
        await page.getByRole('button', { name: '삼성전자 보유 상세' }).click()
        await expect(page.getByRole('link', { name: '종목 상세 →' })).toHaveAttribute('href', new URL(detailUrl).pathname)
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await page.screenshot({ path: testInfo.outputPath(`investment-${width === 390 ? 'mobile' : 'desktop'}.png`), fullPage: true })
    }
    await page.getByRole('button', { name: '공간 전환' }).click()
    await page.getByRole('menuitem', { name: /우리집 가계부/ }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.goto('/')
    await expect(page).toHaveURL('/dashboard')
    expect(errors).toEqual([])
  } finally {
    try {
      if (householdId) await database`delete from households where id = ${householdId}`
      const removed = await admin.auth.admin.deleteUser(auth.data.user.id)
      if (removed.error) throw removed.error
    } finally {
      await database.end()
    }
  }
})

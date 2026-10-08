import { expect, test as base } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

const test = base.extend<{ portfolio: { database: ReturnType<typeof postgres>; householdId: string; yj: string } }>({
  portfolio: async ({ page }, providePortfolio) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const databaseUrl = process.env.DATABASE_URL!
    for (const value of [url, databaseUrl]) {
      if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('investment E2E requires local Supabase')
    }
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
    const database = postgres(databaseUrl, { prepare: false, max: 1 })
    const email = `investment-review-${crypto.randomUUID()}@example.com`
    const password = randomBytes(20).toString('base64url')
    const auth = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (auth.error) throw auth.error
    let householdId: string | undefined
    const errors: string[] = []
    page.on('pageerror', error => errors.push(`${new URL(page.url()).pathname}: ${error.message}`))
    try {
      const [household] = await database`insert into households (name) values ('investment review E2E') returning id`
      householdId = household.id
      await database`insert into household_members (household_id, user_id) values (${householdId!}, ${auth.data.user.id})`
      await database`insert into investment_accounts (household_id, owner, name, broker_account_no, credential_ref) values (${householdId!}, 'DJ', 'DJ 예시', '12345678', 'dj-test')`
      const [yj] = await database`insert into investment_accounts (household_id, owner, name, broker_account_no, credential_ref) values (${householdId!}, 'YJ', 'YJ 예시', '87654321', 'yj-test') returning id`
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/login')
      await page.getByPlaceholder('이메일').fill(email)
      await page.getByPlaceholder('비밀번호').fill(password)
      await page.getByRole('button', { name: '로그인', exact: true }).click()
      await expect(page).toHaveURL('/dashboard')
      await providePortfolio({ database, householdId: householdId!, yj: String(yj.id) })
      expect(errors).toEqual([])
    } finally {
      try {
        if (householdId) await database`delete from households where id = ${householdId}`
        const removed = await admin.auth.admin.deleteUser(auth.data.user.id)
        if (removed.error) throw removed.error
      } finally { await database.end() }
    }
  },
})

test('successful consecutive entries retain YJ account and date', async ({ page, portfolio }) => {
  await page.goto('/investment/transactions?month=2026-09')
  await page.getByText('거래 추가', { exact: true }).click()
  const form = page.locator('form').filter({ has: page.locator('select[name="kind"]') })
  await form.locator('select[name="kind"]').selectOption('deposit')
  await form.locator('select[name="accountId"]').selectOption(portfolio.yj)
  await form.getByLabel('날짜', { exact: true }).fill('2026-09-03')
  for (const amount of ['100000', '200000']) {
    await form.getByLabel('금액', { exact: true }).fill(amount)
    await form.getByLabel('메모', { exact: true }).fill(`입금 ${amount}`)
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(form.getByLabel('금액', { exact: true })).toHaveValue('')
    await expect(form.getByLabel('메모', { exact: true })).toHaveValue('')
    await expect(form.locator('select[name="accountId"]')).toHaveValue(portfolio.yj)
    await expect(form.getByLabel('날짜', { exact: true })).toHaveValue('2026-09-03')
  }
  const { database, householdId } = portfolio
  const rows = await database`select account_id::text, trade_date::text, amount from investment_transactions where household_id = ${householdId} order by id`
  expect(rows.map(row => ({ ...row, amount: Number(row.amount) }))).toEqual([
    { account_id: portfolio.yj, trade_date: '2026-09-03', amount: 100000 },
    { account_id: portfolio.yj, trade_date: '2026-09-03', amount: 200000 },
  ])
})

test('investment controls use normal tracking without changing label tracking', async ({ page, portfolio }, testInfo) => {
  expect(portfolio.householdId).toBeTruthy()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['settings', 'watch', 'transactions']) {
      await page.goto(`/investment/${route}`)
      if (route === 'transactions') await page.getByText('거래 추가', { exact: true }).click()
      const controls = page.locator('label.t-label input:not([type="hidden"]), label.t-label select')
      expect(await controls.count()).toBeGreaterThan(0)
      const styles = await controls.evaluateAll(elements => elements.map(element => {
        const css = getComputedStyle(element)
        return { spacing: Number.parseFloat(css.letterSpacing) || 0, transform: css.textTransform, size: css.fontSize, height: css.height }
      }))
      for (const style of styles) {
        expect.soft(style).toEqual({ spacing: 0, transform: 'none', size: '13px', height: '34px' })
      }
      await expect(page.locator('label.t-label').first()).toHaveCSS('letter-spacing', '1.1px')
      await page.screenshot({ path: testInfo.outputPath(`${route}-${width}.png`), fullPage: true })
    }
  }
})

test('deleting a transaction requires explicit confirmation and cancel preserves it', async ({ page, portfolio }) => {
  const { database, householdId, yj } = portfolio
  const [saved] = await database`insert into investment_transactions (household_id, account_id, kind, trade_date, amount, currency, source) values (${householdId}, ${yj}, 'deposit', '2026-09-03', 100000, 'KRW', 'manual') returning id`
  await page.goto('/investment/transactions?month=2026-09')
  const row = page.locator('tbody tr').filter({ hasText: 'YJ 예시' })
  const messages: string[] = []
  page.once('dialog', async dialog => { messages.push(dialog.message()); await dialog.dismiss() })
  await row.getByRole('button', { name: '삭제', exact: true }).click()
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatch(/2026-09-03[\s\S]*YJ 예시[\s\S]*입금[\s\S]*100,000/)
  await expect(row).toBeVisible()
  expect(await database`select id from investment_transactions where household_id = ${householdId} and id = ${saved.id}`).toHaveLength(1)
  page.once('dialog', async dialog => { await dialog.accept() })
  await row.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(await database`select id from investment_transactions where household_id = ${householdId} and id = ${saved.id}`).toHaveLength(0)
})

test('investment header exposes settings, account security and working signout', async ({ page, portfolio }) => {
  expect(portfolio.householdId).toBeTruthy()
  await page.goto('/investment')
  await page.getByRole('button', { name: '설정 메뉴', exact: true }).click({ timeout: 5000 })
  await expect(page.getByRole('menuitem', { name: /증권 계좌/ })).toHaveAttribute('href', '/investment/settings')
  await expect(page.getByRole('menuitem', { name: /계정 및 보안/ })).toHaveAttribute('href', '/settings?section=security')
  await page.getByRole('menuitem', { name: /증권 계좌/ }).click()
  await expect(page).toHaveURL('/investment/settings')
  await page.getByRole('button', { name: '설정 메뉴', exact: true }).click()
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/investment')
  await expect(page).toHaveURL(/\/login/)
})

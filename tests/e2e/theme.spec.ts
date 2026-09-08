import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

test.use({ colorScheme: 'dark' })

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase admin environment variables are required for E2E')

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function createTestUser(email: string, password: string) {
  const admin = createAdminClient()
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userError) throw userError
  if (!userData.user) throw new Error('test user was not created')

  const { data: household, error: householdError } = await admin
    .from('households')
    .insert({ name: `Theme E2E ${crypto.randomUUID()}` })
    .select('id')
    .single()
  if (householdError) throw householdError

  const { error: memberError } = await admin.from('household_members').insert({
    household_id: household.id,
    user_id: userData.user.id,
    role: 'owner',
  })
  if (memberError) throw memberError

  const { error: transactionError } = await admin.from('transactions').insert([
    { household_id: household.id, date: '2026-08-10', flow: 'income', amount: 4_000_000, source: 'e2e' },
    { household_id: household.id, date: '2026-08-12', flow: 'expense', amount: 2_500_000, raw_merchant: 'Theme E2E', source: 'e2e' },
  ])
  if (transactionError) throw transactionError

  return household.id as string
}

async function deleteTestUser(email: string, householdId?: string) {
  const admin = createAdminClient()
  if (householdId) {
    const { error } = await admin.from('households').delete().eq('id', householdId)
    if (error) throw error
  }

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1_000 })
  if (error) throw error
  const user = data.users.find((candidate) => candidate.email === email)
  if (user) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError
  }
}

test('theme follows system, persists manual choices, and updates charts without reloading', async ({ page }) => {
  test.slow()
  const email = `theme-e2e-${Date.now()}-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  const browserErrors: string[] = []
  let householdId: string | undefined

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      ;(window as typeof window & { __firstPaintTheme?: string }).__firstPaintTheme = document.documentElement.dataset.theme
    })
  })

  try {
    householdId = await createTestUser(email, password)
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')

    const desktopTheme = page.getByRole('group', { name: '화면 테마' })
    for (const width of [1024, 900]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(desktopTheme).toBeVisible()
      const headerFits = await page.locator('.finance-header-inner').evaluate((header) => {
        const navigation = header.querySelector('.finance-desktop-nav')?.getBoundingClientRect()
        const actions = header.querySelector('.finance-user-actions')?.getBoundingClientRect()
        return Boolean(navigation && actions && navigation.right <= actions.left && actions.right <= window.innerWidth)
      })
      expect(headerFits).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 720 })

    await desktopTheme.getByRole('button', { name: '라이트' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme)).toBe('light')
    expect(await page.evaluate(() => localStorage.getItem('finance-theme'))).toBe('light')

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    await page.waitForTimeout(500)
    const lightChart = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())

    await desktopTheme.getByRole('button', { name: '다크' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(lightChart)

    await desktopTheme.getByRole('button', { name: '시스템' }).click()
    const systemDarkChart = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(systemDarkChart)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await desktopTheme.getByRole('button', { name: '다크' }).click()

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '내역', exact: true }).click()
    await expect(page).toHaveURL('/ledger')
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __firstPaintTheme?: string }
    ).__firstPaintTheme)).toBe('dark')

    await page.getByRole('group', { name: '화면 테마' }).getByRole('button', { name: '시스템' }).click()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '더보기' }).click()
    const mobileTheme = page.getByRole('group', { name: '화면 테마' })
    await expect(mobileTheme).toBeVisible()
    await mobileTheme.getByRole('button', { name: '라이트' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(browserErrors).toEqual([])
  } finally {
    await deleteTestUser(email, householdId)
  }
})

test('system theme still initializes when browser storage is denied', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' })
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError') },
    })
  })
  const page = await context.newPage()

  try {
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally {
    await context.close()
  }
})

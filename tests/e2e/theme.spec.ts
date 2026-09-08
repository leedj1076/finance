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

    for (const width of [1024, 900]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(page.getByRole('button', { name: '화면 테마: 시스템', exact: true })).toHaveCount(1)
      const headerFits = await page.locator('.finance-header-inner').evaluate((header) => {
        const navigation = header.querySelector('.finance-desktop-nav')?.getBoundingClientRect()
        const actions = header.querySelector('.finance-user-actions')?.getBoundingClientRect()
        return Boolean(navigation && actions && navigation.right <= actions.left && actions.right <= window.innerWidth)
      })
      expect(headerFits).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 720 })

    const initialSystemTrigger = page.getByRole('button', { name: '화면 테마: 시스템', exact: true })
    await expect(initialSystemTrigger).toHaveAttribute('aria-controls', 'finance-theme-menu-desktop')
    await initialSystemTrigger.click()
    const themeMenu = page.getByRole('menu', { name: '화면 테마 선택' })
    await expect(themeMenu.getByRole('menuitemradio', { name: '시스템', exact: true })).toHaveAttribute('aria-checked', 'true')
    await themeMenu.screenshot({
      path: '.superpowers/sdd/2026-09-09-import-experience/task-2-desktop-theme-menu.png',
    })
    await themeMenu.getByRole('menuitemradio', { name: '라이트', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light')
    await expect(themeMenu).toHaveCount(0)
    expect(await page.locator('html').evaluate((element) => getComputedStyle(element).colorScheme)).toBe('light')
    expect(await page.evaluate(() => localStorage.getItem('finance-theme'))).toBe('light')

    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    await page.waitForTimeout(500)
    const lightChart = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())

    await page.getByRole('button', { name: '화면 테마: 라이트', exact: true }).click()
    await themeMenu.getByRole('menuitemradio', { name: '라이트', exact: true }).press('ArrowDown')
    const darkMenuItem = themeMenu.getByRole('menuitemradio', { name: '다크', exact: true })
    await expect(darkMenuItem).toBeFocused()
    await darkMenuItem.press('Space')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(themeMenu).toHaveCount(0)
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(lightChart)

    await page.getByRole('button', { name: '화면 테마: 다크', exact: true }).click()
    await darkMenuItem.press('End')
    const systemMenuItem = themeMenu.getByRole('menuitemradio', { name: '시스템', exact: true })
    await expect(systemMenuItem).toBeFocused()
    await systemMenuItem.press('Enter')
    const systemDarkChart = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(systemDarkChart)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    const systemTrigger = page.getByRole('button', { name: '화면 테마: 시스템', exact: true })
    await systemTrigger.click()
    await systemMenuItem.press('Home')
    await expect(themeMenu.getByRole('menuitemradio', { name: '라이트', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(darkMenuItem).toBeFocused()
    await darkMenuItem.press('Space')

    const darkTrigger = page.getByRole('button', { name: '화면 테마: 다크', exact: true })
    await darkTrigger.click()
    await page.keyboard.press('Escape')
    await expect(themeMenu).toHaveCount(0)
    await expect(darkTrigger).toBeFocused()

    const settingsTrigger = page.getByRole('button', { name: '설정 메뉴', exact: true })
    await darkTrigger.click()
    await page.keyboard.press('Tab')
    await expect(themeMenu).toHaveCount(0)
    await expect(settingsTrigger).toBeFocused()

    await darkTrigger.click()
    await settingsTrigger.click()
    await expect(themeMenu).toHaveCount(0)
    await expect(settingsTrigger).toBeFocused()
    await settingsTrigger.click()

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '내역', exact: true }).click()
    await expect(page).toHaveURL('/ledger')
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __firstPaintTheme?: string }
    ).__firstPaintTheme)).toBe('dark')

    await page.getByRole('button', { name: '화면 테마: 다크', exact: true }).click()
    await page.getByRole('menuitemradio', { name: '시스템', exact: true }).click()
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '더보기' }).click()
    const mobileThemeTrigger = page.getByRole('button', { name: '화면 테마: 시스템', exact: true })
    await expect(mobileThemeTrigger).toHaveCount(1)
    await expect(mobileThemeTrigger).toHaveAttribute('aria-controls', 'finance-theme-menu-mobile')
    await mobileThemeTrigger.click()
    const mobileThemeMenu = page.getByRole('menu', { name: '화면 테마 선택' })
    await expect(mobileThemeMenu.getByRole('menuitemradio', { name: '시스템', exact: true })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(mobileThemeMenu).toHaveCount(0)
    await expect(page.locator('.finance-mobile-more')).toBeVisible()
    await expect(mobileThemeTrigger).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.finance-mobile-more')).toHaveCount(0)
    await page.getByRole('button', { name: '더보기' }).click()
    await mobileThemeTrigger.click()
    await page.locator('.finance-theme-selector.is-mobile').screenshot({
      path: '.superpowers/sdd/2026-09-09-import-experience/task-2-mobile-theme-menu.png',
    })
    const mobileBounds = await mobileThemeMenu.boundingBox()
    expect(mobileBounds).not.toBeNull()
    expect(mobileBounds?.x).toBeGreaterThanOrEqual(0)
    expect((mobileBounds?.x ?? 0) + (mobileBounds?.width ?? 0)).toBeLessThanOrEqual(390)
    await mobileThemeMenu.getByRole('menuitemradio', { name: '라이트', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(mobileThemeMenu).toHaveCount(0)
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

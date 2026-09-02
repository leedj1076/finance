import { writeFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are required for E2E')
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function deleteTestState(email: string, householdId?: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1_000 })
  if (error) throw error
  const user = data.users.find((candidate) => candidate.email === email)
  const householdIds = householdId ? [householdId] : []
  if (!householdId && user) {
    const { data: memberships, error: membershipError } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', user.id)
    if (membershipError) throw membershipError
    householdIds.push(...memberships.map((membership) => membership.household_id as string))
  }

  for (const id of householdIds) {
    const { error: householdError } = await admin
      .from('households')
      .delete()
      .eq('id', id)
    if (householdError) throw householdError
  }

  if (!user) return

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) throw deleteError
}

async function createTestUser(
  email: string,
  password: string,
  options: { seedDashboard?: boolean } = {},
) {
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
    .insert({ name: `Parity E2E ${crypto.randomUUID()}` })
    .select('id')
    .single()
  if (householdError) throw householdError

  const { error: memberError } = await admin.from('household_members').insert({
    household_id: household.id,
    user_id: userData.user.id,
    role: 'owner',
  })
  if (memberError) throw memberError

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .insert({
      household_id: household.id,
      name: 'Parity E2E 카드',
      owner: 'DJ',
      active: true,
    })
    .select('id')
    .single()
  if (accountError) throw accountError

  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({
      household_id: household.id,
      kind: 'expense',
      major: '식비',
      sub: '카페',
      sort_order: 1,
    })
    .select('id')
    .single()
  if (categoryError) throw categoryError

  if (options.seedDashboard) {
    const currentMonth = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Seoul',
    }).slice(0, 7)
    const currentYear = Number(currentMonth.slice(0, 4))
    const dashboardYear = currentYear
    const { error: transactionError } = await admin.from('transactions').insert([
      {
        household_id: household.id,
        date: `${dashboardYear}-01-10`,
        flow: 'income',
        fixed: false,
        amount: 2_000_000,
        memo: 'Parity E2E 1월 수입',
        source: 'e2e',
      },
      {
        household_id: household.id,
        date: `${dashboardYear}-01-12`,
        flow: 'expense',
        fixed: false,
        category_id: category.id,
        amount: 500_000,
        raw_merchant: 'Parity E2E 대시보드 마트',
        memo: '1월 장보기',
        account_id: account.id,
        source: 'e2e',
      },
      {
        household_id: household.id,
        date: `${dashboardYear}-02-10`,
        flow: 'income',
        fixed: false,
        amount: 2_100_000,
        memo: 'Parity E2E 2월 수입',
        source: 'e2e',
      },
      {
        household_id: household.id,
        date: `${dashboardYear}-02-12`,
        flow: 'expense',
        fixed: false,
        category_id: category.id,
        amount: 300_000,
        raw_merchant: 'Parity E2E 대시보드 마트 2호점',
        memo: '2월 장보기',
        account_id: account.id,
        source: 'e2e',
      },
    ])
    if (transactionError) throw transactionError
  }

  return {
    accountId: Number(account.id),
    categoryId: Number(category.id),
    householdId: household.id as string,
  }
}

async function loginAs(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto('/login')
  await page.getByPlaceholder('이메일').fill(email)
  await page.getByPlaceholder('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/dashboard')
}

async function navigateFromHeader(page: Page, menu: '분석·예산' | '설정', link: string) {
  await page.waitForLoadState('networkidle')
  const item = page.getByRole('menuitem', { name: new RegExp(`^${link}`) })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: menu, exact: true }).click()
    await page.waitForTimeout(100)
    if (await item.isVisible()) { await item.click(); return }
  }
  throw new Error(`${menu} 메뉴에서 ${link} 링크를 열지 못했습니다.`)
}

test('card statement upload reaches inbox, applies to ledger, and keeps card source', async ({ page }, testInfo) => {
  test.slow()
  const email = `finance-parity-card-${Date.now()}-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  const merchant = `Parity E2E 카페 ${crypto.randomUUID().slice(0, 8)}`
  const transactionDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
  let householdId: string | undefined

  try {
    const setup = await createTestUser(email, password)
    householdId = setup.householdId
    await loginAs(page, email, password)

    const statementPath = testInfo.outputPath('samsung-card-statement.xls')
    await writeFile(statementPath, `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <table>
        <tr><th>이용일</th><th>가맹점</th><th>이용금액</th></tr>
        <tr><td>${transactionDate.replaceAll('-', '.')}</td><td>${merchant}</td><td>5,000</td></tr>
      </table>
    </body></html>`, 'utf8')

    await page.getByRole('link', { name: '인박스', exact: true }).click()
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('samsung')
    await page.locator('select[name="owner"]').selectOption('DJ')
    const fileInput = page.locator('input[name="file"]')
    await fileInput.setInputFiles(statementPath)
    expect(await fileInput.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name))
      .toBe('samsung-card-statement.xls')
    await page.getByRole('button', { name: '인박스로 불러오기' }).click({ noWaitAfter: true })

    await expect(page.getByText(/인박스에 1건 추가/)).toBeVisible()
    const inboxRow = page.getByRole('row').filter({ hasText: merchant })
    await expect(inboxRow).toHaveCount(1)
    await expect(inboxRow.getByRole('checkbox', { name: `${merchant} 선택` })).toBeChecked()
    await inboxRow.locator('select[name^="category_"]').selectOption(String(setup.categoryId))
    await inboxRow.locator('select[name^="account_"]').selectOption(String(setup.accountId))
    await page.getByRole('button', { name: '선택 반영' }).first().click()

    await expect(page).toHaveURL(/\/inbox\?notice=/)
    await expect(page.getByText(/1건을 가계부에 반영했습니다/)).toBeVisible()
    await page.getByRole('link', { name: '가계부', exact: true }).click()
    const ledgerRow = page.getByRole('row').filter({ hasText: merchant })
    await expect(ledgerRow).toHaveCount(1)
    await expect(ledgerRow).toContainText('5,000원')
    await expect(ledgerRow).toContainText('식비')
    await expect(ledgerRow).toContainText('Parity E2E 카드')

    const admin = createAdminClient()
    const { data: sourceRow, error: sourceError } = await admin
      .from('transactions')
      .select('source, raw_merchant')
      .eq('household_id', householdId)
      .eq('raw_merchant', merchant)
      .single()
    if (sourceError) throw sourceError
    expect(sourceRow).toEqual({ source: 'card:samsung', raw_merchant: merchant })
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('dashboard category detail interaction and annual report navigation render', async ({ page }) => {
  const email = `finance-parity-dashboard-${Date.now()}-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined

  try {
    const setup = await createTestUser(email, password, { seedDashboard: true })
    householdId = setup.householdId
    await loginAs(page, email, password)

    const cashflowChart = page.getByRole('img', { name: '월별 수입과 지출 막대 차트' })
    await cashflowChart.locator('[aria-label="1월 수입 2,000,000원"]').hover()
    await expect(page.getByRole('tooltip')).toContainText('1월')
    await expect(page.getByRole('tooltip')).toContainText('수입: 2,000,000원')

    const accountChart = page.getByRole('img', { name: '결제수단별 월간 금액 누적 막대 차트' })
    await accountChart.locator('[aria-label="1월 Parity E2E 카드 500,000원"]').hover()
    await expect(page.getByRole('tooltip')).toContainText('Parity E2E 카드: 500,000원')

    const categoryChart = page.getByRole('img', { name: '분류별 월간 추이' })
    await categoryChart.locator('[aria-label="분류별 차트 hover 영역"]').hover()
    await expect(page.getByRole('tooltip')).toContainText('식비')
    await expect(page.getByRole('tooltip')).toContainText(/1월\s+500,000원/)
    await expect(page.getByRole('tooltip')).toContainText(/2월\s+300,000원/)

    const detailSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '항목별 월별', exact: true }),
    })
    await expect(detailSection).toBeVisible()
    await expect(detailSection.getByRole('link', { name: '식비', exact: true })).toBeVisible()
    await expect(detailSection.getByRole('columnheader', { name: '1월', exact: true })).toBeVisible()

    const januaryCell = detailSection.locator('button[aria-label^="식비 카페 1월 500,000원,"]')
    await expect(januaryCell).toHaveAccessibleName(/합계에서 제외/)
    await januaryCell.hover()
    await expect(page.getByRole('tooltip')).toContainText('Parity E2E 대시보드 마트')
    await januaryCell.click()
    await expect(januaryCell).toHaveAttribute('aria-pressed', 'true')
    await expect(januaryCell).toHaveAccessibleName(/합계에 다시 포함/)

    await navigateFromHeader(page, '분석·예산', '연간결산')
    await expect(page).toHaveURL('/report')
    await expect(page.getByRole('heading', { name: '연간결산', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '6개월 현금흐름 예측' })).toBeVisible()
  } finally {
    await deleteTestState(email, householdId)
  }
})

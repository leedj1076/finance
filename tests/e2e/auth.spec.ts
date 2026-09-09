import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { closeFixtureMonths } from './close-fixture-months'

test.use({ actionTimeout: 10_000 })

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
  if (householdId) {
    const { error: householdError } = await admin
      .from('households')
      .delete()
      .eq('id', householdId)
    if (householdError) throw householdError
  }

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1_000 })
  if (error) throw error

  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) return

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) throw deleteError
}

async function createTestUser(email: string, password: string) {
  const admin = createAdminClient()
  const { data: userData, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  if (!userData.user) throw new Error('test user was not created')

  const { data: household, error: householdError } = await admin
    .from('households')
    .insert({ name: `E2E ${crypto.randomUUID()}` })
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
    .insert({ household_id: household.id, name: 'E2E 카드', owner: 'DJ', type: 'card', active: true })
    .select('id')
    .single()
  if (accountError) throw accountError

  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({ household_id: household.id, kind: 'expense', major: '식비', sub: '장보기' })
    .select('id')
    .single()
  if (categoryError) throw categoryError

  const { error: transactionError } = await admin.from('transactions').insert([
    { household_id: household.id, date: '2026-01-10', flow: 'income', amount: 5_000_000, source: 'e2e' },
    { household_id: household.id, date: '2026-01-12', flow: 'expense', amount: 3_000_000, category_id: category.id, raw_merchant: 'E2E 마트 1호점', source: 'e2e' },
    { household_id: household.id, date: '2026-02-10', flow: 'income', amount: 5_200_000, source: 'e2e' },
    { household_id: household.id, date: '2026-02-12', flow: 'expense', amount: 3_100_000, category_id: category.id, raw_merchant: 'E2E 마트 2호점', source: 'e2e' },
    { household_id: household.id, date: '2026-03-10', flow: 'income', amount: 5_300_000, source: 'e2e' },
    { household_id: household.id, date: '2026-03-12', flow: 'expense', amount: 3_200_000, category_id: category.id, raw_merchant: 'E2E 마트 3호점', source: 'e2e' },
    { household_id: household.id, date: '2026-03-15', flow: 'expense', amount: 7_777, account_id: account.id, raw_merchant: 'E2E 미분류 가맹점', source: 'e2e' },
  ])
  if (transactionError) throw transactionError

  const { error: recurringError } = await admin.from('recurring').insert({
    household_id: household.id,
    flow: 'expense',
    fixed: true,
    category_id: category.id,
    memo: 'E2E 정기비용',
    amount: 99_000,
    account_id: account.id,
    day: 15,
    active: true,
    sort_order: 1,
  })
  if (recurringError) throw recurringError

  const { data: assetRows, error: assetError } = await admin.from('asset_accounts').insert([
    { household_id: household.id, major: '현금', name: 'E2E 예금', kind: 'asset', sort_order: 1 },
    { household_id: household.id, major: '대출', name: 'E2E 대출', kind: 'liability', sort_order: 2 },
  ]).select('id, name')
  if (assetError) throw assetError
  const assetId = assetRows.find((row) => row.name === 'E2E 예금')?.id
  const debtId = assetRows.find((row) => row.name === 'E2E 대출')?.id
  if (!assetId || !debtId) throw new Error('test asset accounts were not created')

  const { error: snapshotError } = await admin.from('balance_snapshots').insert([
    { household_id: household.id, account_id: assetId, month: '2026-01', amount: 1_000_000 },
    { household_id: household.id, account_id: assetId, month: '2026-02', amount: 1_200_000 },
    { household_id: household.id, account_id: debtId, month: '2026-01', amount: 400_000 },
    { household_id: household.id, account_id: debtId, month: '2026-02', amount: 350_000 },
  ])
  if (snapshotError) throw snapshotError

  return {
    accountId: account.id as number,
    categoryId: category.id as number,
    householdId: household.id as string,
  }
}

async function openFromSettings(page: import('@playwright/test').Page, link: string) {
  await page.waitForLoadState('networkidle')
  const item = page.getByRole('menuitem', { name: new RegExp(`^${link}`) })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: '설정 메뉴' }).click()
    await page.waitForTimeout(100)
    if (await item.isVisible()) { await item.click(); return }
  }
  throw new Error(`설정 메뉴에서 ${link} 링크를 열지 못했습니다.`)
}

test('family user can manage a transaction and change their password', async ({ page }) => {
  test.slow()
  const email = `finance-e2e-${Date.now()}-${crypto.randomUUID()}@example.com`
  const currentPassword = 'passw0rd!'
  const newPassword = 'new-passw0rd!'
  const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  let householdId: string | undefined

  try {
    const setup = await createTestUser(email, currentPassword)
    householdId = setup.householdId
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(currentPassword)
    await page.getByRole('button', { name: '로그인', exact: true }).click()

    await expect(page).toHaveURL('/dashboard')
    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '내역', exact: true }).click()
    await expect(page).toHaveURL('/ledger')
    const transactionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: '거래 추가' }),
    })
    await transactionForm.locator('select[name="categoryId"]').selectOption(String(setup.categoryId))
    await transactionForm.getByLabel('금액').fill('12,500')
    await transactionForm.locator('select[name="accountId"]').selectOption(String(setup.accountId))
    await transactionForm.getByLabel('사용내역').fill('E2E 장보기')
    await transactionForm.getByRole('button', { name: '거래 추가' }).click()

    const transactionRow = page.getByRole('row', { name: /E2E 장보기/ })
    await expect(transactionRow).toContainText('12,500원')
    await transactionRow.click()
    const editingRow = page.getByRole('row', { name: /E2E 장보기/ })
    await editingRow.getByLabel('금액').fill('15,000')
    let fullPageNavigations = 0
    const navigationCounter = (request: import('@playwright/test').Request) => {
      // framenavigated also fires for same-document history updates, which
      // are not reloads. Observe actual main-document requests instead.
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) fullPageNavigations += 1
    }
    const documentBeforeSave = await page.evaluate(() => performance.timeOrigin)
    page.on('request', navigationCounter)
    await editingRow.getByRole('button', { name: '거래 수정 저장' }).click()
    await expect(page.getByRole('row', { name: /E2E 장보기/ })).toContainText('15,000원')
    await expect(page.getByText('저장됨')).toBeVisible()
    page.off('request', navigationCounter)
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentBeforeSave)
    expect(fullPageNavigations).toBe(0)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('row', { name: /E2E 장보기/ }).getByRole('button', { name: '삭제' }).click()
    await expect(page.getByText('E2E 장보기')).toHaveCount(0)

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '예산', exact: true }).click()
    await expect(page).toHaveURL('/budgets')
    await page.getByLabel('예산 월').fill('2026-03')
    await page.getByRole('button', { name: '보기', exact: true }).click()
    await expect(page).toHaveURL('/budgets?month=2026-03')
    await expect(page.getByRole('heading', { name: '2026년 03월 예산', exact: true })).toBeVisible()
    await page.getByLabel('식비 예산').fill('500000')
    await expect(page.getByText('입력 합계 500,000원')).toBeVisible()
    await page.getByLabel('목표 저축률').fill('35')
    await page.getByRole('button', { name: '변경사항 저장' }).click()
    await expect(page.getByLabel('식비 예산')).toHaveValue('500000')
    await expect(page.getByText('입력 합계 500,000원')).toBeVisible()

    await page.getByRole('link', { name: /^(월말 리뷰|다음 달 예산 만들기) →$/ }).click()
    await expect(page).toHaveURL('/budgets/review?month=2026-04')
    await expect(page.getByRole('heading', { name: '월말 리뷰' })).toBeVisible()
    await expect(page.getByText('2026-03 결산 → 2026-04 예산 만들기')).toBeVisible()
    await page.getByLabel('식비 다음 달 예산').fill('450000')
    await page.getByRole('button', { name: '2026-04 예산으로 저장' }).click()
    await expect(page).toHaveURL('/budgets?month=2026-04&reviewSaved=1')
    await expect(page.getByText('월말 리뷰에서 2026-04 예산을 저장했습니다.')).toBeVisible()
    await expect(page.getByLabel('식비 예산')).toHaveValue('450000')

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '홈', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByRole('heading', { name: '홈' })).toBeVisible()
    expect(browserErrors).toEqual([])

    // Report smoke check here; parity.spec covers chart hover and selection.
    await closeFixtureMonths(createAdminClient(), householdId, ['2026-01', '2026-02'])
    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '통계', exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/report')
    await expect(page.getByRole('heading', { name: '연간 통계' })).toBeVisible()
    await expect(page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })).toBeVisible()

    await openFromSettings(page, '정기거래 규칙')
    await expect(page).toHaveURL('/recurring')
    await expect(page.getByRole('heading', { name: '정기거래 규칙' })).toBeVisible()
    await page.getByLabel('E2E 정기비용 금액').fill('105000')
    await page.getByRole('button', { name: '정기거래 저장' }).click()
    await expect(page).toHaveURL(`/recurring?month=${currentMonth}&saved=1`)
    await expect(page.getByText('정기거래 규칙을 저장했습니다.')).toBeVisible()

    // Applying a month lives on 내역 now: the banner offers it only while
    // something is unposted, and posting twice is a no-op.
    await page.goto('/ledger?month=2026-04&tab=list')
    await page.getByRole('button', { name: /미반영 1건 반영/ }).click()
    await expect(page).toHaveURL('/ledger?month=2026-04&tab=list&recurringAdded=1&recurringSkipped=0')
    await expect(page.getByText('방금 1건 추가')).toBeVisible()
    await expect(page.getByRole('row', { name: /E2E 정기비용/ })).toContainText('105,000원')
    await expect(page.getByText('활성 1건 중 1건 반영')).toBeVisible()
    await expect(page.getByRole('button', { name: /미반영/ })).toHaveCount(0)

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '자산', exact: true }).click()
    await expect(page).toHaveURL('/assets')
    await expect(page.getByRole('heading', { name: '자산', exact: true })).toBeVisible()
    await expect(page.locator('article').filter({ hasText: '순자산' }).first()).toContainText('850,000원')
    await expect(page.getByRole('img', { name: '월별 순자산 추이' })).toBeVisible()
    await page.locator('#balance-adjustment > summary').click()
    await page.getByLabel('E2E 예금 잔액').fill('1400000')
    await page.getByRole('button', { name: '이달 자산 저장' }).click()
    await expect(page).toHaveURL('/assets?month=2026-02&saved=1')
    await expect(page.getByText('2026-02 자산 잔액을 저장했습니다.')).toBeVisible()
    await expect(page.locator('article').filter({ hasText: '순자산' }).first()).toContainText('1,050,000원')
    expect(browserErrors).toEqual([])

    await openFromSettings(page, '결제수단')
    await expect(page).toHaveURL('/manage?tab=accounts')
    await expect(page.getByRole('heading', { name: '가계부 관리' })).toBeVisible()
    await page.getByRole('textbox', { name: 'E2E 카드 메모' }).fill('가족 공용 테스트 카드')
    await page.getByRole('button', { name: '변경사항 저장' }).click()
    await expect(page.getByText('결제수단과 표시 순서를 저장했습니다.')).toBeVisible()

    await page.goto('/inbox?tab=unclassified')
    const unclassifiedRow = page.getByRole('row').filter({ hasText: 'E2E 미분류 가맹점' })
    await unclassifiedRow.getByRole('combobox', { name: 'E2E 미분류 가맹점 카테고리' })
      .selectOption(String(setup.categoryId))
    await unclassifiedRow.getByRole('checkbox', { name: 'E2E 미분류 가맹점 선택' }).check()
    await page.getByRole('button', { name: '선택 거래 저장' }).click()
    await expect(page.getByText(/1건을 분류하고 다음 추천에 반영했습니다/)).toBeVisible()
    await expect(page.getByText('E2E 미분류 가맹점')).toHaveCount(0)

    await page.goto('/manage?tab=rules')
    await page.getByLabel('가맹점 사전 검색').fill('ee미분류가맹점')
    await page.getByRole('button', { name: '검색' }).click()
    await expect(page.getByText('정규화: ee미분류가맹점', { exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])

    await openFromSettings(page, '계정 및 보안')
    await expect(page).toHaveURL('/settings?section=security')
    await page.getByLabel('현재 비밀번호').fill(currentPassword)
    await page.getByLabel('새 비밀번호', { exact: true }).fill(newPassword)
    await page.getByLabel('새 비밀번호 확인').fill(newPassword)
    await page.getByRole('button', { name: '비밀번호 변경' }).click()
    await expect(page.getByText('비밀번호를 변경했습니다.')).toBeVisible()
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('anonymous visitor is redirected to login', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await expect(page.getByText('등록된 가족 계정만 로그인할 수 있습니다.')).toBeVisible()
  await expect(page.getByText('계정이 없으신가요? 가입')).toHaveCount(0)
})

test('anonymous visitor cannot open settings', async ({ page }) => {
  await page.goto('/settings')

  await expect(page).toHaveURL('/login')
})

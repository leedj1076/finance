import { expect, test } from '@playwright/test'
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
    .insert({ household_id: household.id, name: 'E2E 카드', owner: 'DJ', active: true })
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

test('family user can manage a transaction and change their password', async ({ page }) => {
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
    await page.getByRole('link', { name: '가계부', exact: true }).click()
    await expect(page).toHaveURL('/ledger')
    await page.getByLabel('분류').selectOption(String(setup.categoryId))
    await page.getByLabel('금액').fill('12,500')
    await page.getByLabel('결제수단').selectOption(String(setup.accountId))
    await page.getByLabel('사용내역').fill('E2E 장보기')
    await page.getByRole('button', { name: '거래 추가' }).click()

    const transactionRow = page.getByRole('row', { name: /E2E 장보기/ })
    await expect(transactionRow).toContainText('12,500원')
    await transactionRow.getByRole('link', { name: '수정' }).click()
    await expect(page.getByRole('heading', { name: '거래 수정' })).toBeVisible()
    await page.getByLabel('금액').fill('15,000')
    await page.getByRole('button', { name: '수정 저장' }).click()
    await expect(page.getByRole('row', { name: /E2E 장보기/ })).toContainText('15,000원')

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('row', { name: /E2E 장보기/ }).getByRole('button', { name: '삭제' }).click()
    await expect(page.getByText('E2E 장보기')).toHaveCount(0)

    await page.getByRole('link', { name: '예산' }).click()
    await page.getByLabel('식비 예산').fill('500000')
    await page.getByLabel('목표 저축률').fill('35')
    await page.getByRole('button', { name: '이달 예산 저장' }).click()
    await expect(page.getByLabel('식비 예산')).toHaveValue('500000')
    await expect(page.locator('article').filter({ hasText: '총 예산' })).toContainText('500,000원')

    await page.getByRole('link', { name: '월말 리뷰 →' }).click()
    await expect(page).toHaveURL('/budgets/review?month=2026-04')
    await expect(page.getByRole('heading', { name: '월말 리뷰' })).toBeVisible()
    await expect(page.getByText('2026-03 결산 → 2026-04 예산 만들기')).toBeVisible()
    await page.getByLabel('식비 다음 달 예산').fill('450000')
    await page.getByRole('button', { name: '2026-04 예산으로 저장' }).click()
    await expect(page).toHaveURL('/budgets?month=2026-04&reviewSaved=1')
    await expect(page.getByText('월말 리뷰에서 2026-04 예산을 저장했습니다.')).toBeVisible()
    await expect(page.getByLabel('식비 예산')).toHaveValue('450000')

    await page.getByRole('link', { name: '대시보드' }).click()
    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible()
    expect(browserErrors).toEqual([])

    await page.getByRole('link', { name: '분석', exact: true }).click()
    await expect(page).toHaveURL('/analysis')
    await expect(page.getByRole('heading', { name: '분석' })).toBeVisible()

    await page.getByRole('link', { name: '정기거래', exact: true }).click()
    await expect(page).toHaveURL('/recurring')
    await expect(page.getByRole('heading', { name: '정기거래', exact: true })).toBeVisible()
    await page.getByLabel('E2E 정기비용 금액').fill('105000')
    await page.getByRole('button', { name: '정기거래 저장' }).click()
    await expect(page).toHaveURL(`/recurring?month=${currentMonth}&saved=1`)
    await expect(page.getByText('정기거래 규칙을 저장했습니다.')).toBeVisible()
    await page.getByLabel('정기거래 적용 월').fill('2026-04')
    await page.getByRole('button', { name: '선택한 달에 반영' }).click()
    await expect(page).toHaveURL('/ledger?month=2026-04&recurringAdded=1&recurringSkipped=0')
    await expect(page.getByText('정기거래 1건을 추가했습니다.')).toBeVisible()
    await expect(page.getByRole('row', { name: /E2E 정기비용/ })).toContainText('105,000원')

    await page.getByRole('link', { name: '정기거래', exact: true }).click()
    await page.getByLabel('정기거래 적용 월').fill('2026-04')
    await page.getByRole('button', { name: '선택한 달에 반영' }).click()
    await expect(page).toHaveURL('/ledger?month=2026-04&recurringAdded=0&recurringSkipped=1')
    await expect(page.getByText('정기거래 0건을 추가했습니다. 이미 반영된 1건은 건너뛰었습니다.')).toBeVisible()
    await expect(page.getByRole('row', { name: /E2E 정기비용/ })).toHaveCount(1)

    await page.getByRole('link', { name: '자산', exact: true }).click()
    await expect(page).toHaveURL('/assets')
    await expect(page.getByRole('heading', { name: '자산', exact: true })).toBeVisible()
    await expect(page.locator('article').filter({ hasText: '순자산' }).first()).toContainText('850,000원')
    await page.getByLabel('E2E 예금 잔액').fill('1400000')
    await page.getByRole('button', { name: '이달 자산 저장' }).click()
    await expect(page).toHaveURL('/assets?month=2026-02&saved=1')
    await expect(page.getByText('2026-02 자산 잔액을 저장했습니다.')).toBeVisible()
    await expect(page.locator('article').filter({ hasText: '순자산' }).first()).toContainText('1,050,000원')
    expect(browserErrors).toEqual([])

    await page.getByRole('link', { name: '관리', exact: true }).click()
    await expect(page).toHaveURL('/manage')
    await expect(page.getByRole('heading', { name: '가계부 관리' })).toBeVisible()
    const accountForm = page.locator('form').filter({ has: page.locator('input[name="name"][value="E2E 카드"]') })
    await accountForm.locator('input[name="memo"]').fill('가족 공용 테스트 카드')
    await accountForm.getByRole('button', { name: '저장' }).click()
    await expect(page.getByText('결제수단을 저장했습니다.')).toBeVisible()

    await page.getByRole('link', { name: /미분류 거래/ }).click()
    const unclassifiedForm = page.locator('form').filter({ hasText: 'E2E 미분류 가맹점' })
    await unclassifiedForm.locator('select[name="categoryId"]').selectOption(String(setup.categoryId))
    await unclassifiedForm.getByRole('button', { name: '분류' }).click()
    await expect(page.getByText('거래를 분류하고 다음 추천에 반영했습니다.')).toBeVisible()
    await expect(page.getByText('E2E 미분류 가맹점')).toHaveCount(0)

    await page.getByRole('link', { name: /추천 규칙/ }).click()
    await page.getByLabel('분류 규칙 검색').fill('ee미분류가맹점')
    await page.getByRole('button', { name: '검색' }).click()
    await expect(page.getByText('ee미분류가맹점', { exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])

    await page.getByRole('link', { name: '설정' }).click()
    await expect(page).toHaveURL('/settings')
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

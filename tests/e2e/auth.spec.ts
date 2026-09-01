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
  let householdId: string | undefined

  try {
    const setup = await createTestUser(email, currentPassword)
    householdId = setup.householdId
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(currentPassword)
    await page.getByRole('button', { name: '로그인', exact: true }).click()

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

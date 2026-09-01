import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

async function deleteTestUser(email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are required for E2E cleanup')
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1_000 })
  if (error) throw error

  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) return

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) throw deleteError
}

async function createTestUser(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are required for E2E setup')
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
}

test('registered user can log in and change their password', async ({ page }) => {
  const email = `finance-e2e-${Date.now()}-${crypto.randomUUID()}@example.com`
  const currentPassword = 'passw0rd!'
  const newPassword = 'new-passw0rd!'

  try {
    await createTestUser(email, currentPassword)
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(currentPassword)
    await page.getByRole('button', { name: '로그인', exact: true }).click()

    await expect(page).toHaveURL('/ledger')
    await expect(page.getByText('가구에 연결되지 않았습니다')).toBeVisible()

    await page.getByRole('link', { name: '설정' }).click()
    await expect(page).toHaveURL('/settings')
    await page.getByLabel('현재 비밀번호').fill(currentPassword)
    await page.getByLabel('새 비밀번호', { exact: true }).fill(newPassword)
    await page.getByLabel('새 비밀번호 확인').fill(newPassword)
    await page.getByRole('button', { name: '비밀번호 변경' }).click()
    await expect(page.getByText('비밀번호를 변경했습니다.')).toBeVisible()
  } finally {
    await deleteTestUser(email)
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

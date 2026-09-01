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

test('new user can sign up and reach the protected home page', async ({ page }) => {
  const email = `finance-e2e-${Date.now()}-${crypto.randomUUID()}@example.com`

  try {
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill('passw0rd!')
    await page.getByRole('button', { name: '계정이 없으신가요? 가입' }).click()
    await expect(page.getByRole('heading', { name: '계정 만들기' })).toBeVisible()
    await page.getByRole('button', { name: '가입', exact: true }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByText(`로그인됨: ${email}`)).toBeVisible()
    await expect(page.getByText('아직 가구에 연결되지 않았습니다.')).toBeVisible()
  } finally {
    await deleteTestUser(email)
  }
})

test('anonymous visitor is redirected to login', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
})

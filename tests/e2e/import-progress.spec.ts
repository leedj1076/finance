import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'

test.use({ actionTimeout: 10_000 })

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase admin environment variables are required for E2E')
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function createTestHousehold(email: string, password: string) {
  const admin = createAdminClient()
  const { data: userData, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (userError || !userData.user) throw userError ?? new Error('test user was not created')
  const { data: household, error: householdError } = await admin
    .from('households')
    .insert({ name: `Import progress E2E ${crypto.randomUUID()}` })
    .select('id')
    .single()
  if (householdError) throw householdError
  const { error: memberError } = await admin.from('household_members').insert({
    household_id: household.id,
    user_id: userData.user.id,
    role: 'owner',
  })
  if (memberError) throw memberError
  return household.id as string
}

async function deleteTestState(email: string, householdId?: string) {
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

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByPlaceholder('이메일').fill(email)
  await page.getByPlaceholder('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/dashboard')
}

async function banksaladWorkbook(merchant: string) {
  const workbook = new ExcelJS.Workbook()
  const status = workbook.addWorksheet('뱅샐현황')
  status.getCell('B2').value = '이동재'
  const ledger = workbook.addWorksheet('가계부 내역')
  ledger.addRow(['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '통화', '결제수단', '메모'])
  ledger.addRow([new Date(Date.UTC(2026, 7, 31)), null, '지출', '식비', '외식', merchant, -12_500, 'KRW', '테스트카드', null])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

test('a real Banksalad workbook streams through the route and reaches review unselected', async ({ page }) => {
  test.slow()
  const email = `finance-banksalad-route-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  const merchant = `Banksalad E2E ${crypto.randomUUID().slice(0, 8)}`
  let householdId: string | undefined
  try {
    householdId = await createTestHousehold(email, password)
    await loginAs(page, email, password)
    await page.goto('/inbox?tab=upload')
    await page.locator('input[name="files"]').setInputFiles({
      name: 'banksalad-real-route.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await banksaladWorkbook(merchant),
    })
    await page.getByRole('button', { name: '인박스로 불러오기', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '거래 파일 처리 진행' })
    await expect(dialog.getByText(/인박스에 1건 추가/)).toBeVisible()

    const admin = createAdminClient()
    const { data: rows, error } = await admin.from('import_inbox')
      .select('merchant, amount, status')
      .eq('household_id', householdId)
      .eq('merchant', merchant)
    if (error) throw error
    expect(rows).toEqual([{ merchant, amount: 12_500, status: 'pending' }])

    await dialog.getByRole('button', { name: '검토 대기 보기', exact: true }).click()
    await expect(page).toHaveURL('/inbox?tab=review')
    await expect(page.getByRole('navigation', { name: '가져오기 작업' })).toContainText('검토 대기1')
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('a delayed import stream stays modal and keeps its real result until dismissed', async ({ page }, testInfo) => {
  const email = `finance-progress-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined
  try {
    householdId = await createTestHousehold(email, password)
    await loginAs(page, email, password)
    await page.goto('/inbox?tab=upload')

    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.endsWith('/api/import')) return originalFetch(input, init)
        const data = init?.body
        if (!(data instanceof FormData) || data.get('mode') !== 'banksalad') {
          return Promise.resolve(Response.json({ type: 'error', code: 'invalid_input', message: 'mode missing' }, { status: 400 }))
        }
        const encoder = new TextEncoder()
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            Reflect.set(window, 'emitImportProgress', (event: object) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            })
            Reflect.set(window, 'closeImportProgress', () => controller.close())
          },
        }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
      }
    })

    await page.locator('input[name="files"]').setInputFiles({
      name: 'banksalad.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('synthetic stream interception'),
    })
    await page.getByRole('button', { name: '인박스로 불러오기', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: '거래 파일 처리 진행' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('파일 전송 중', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    await page.evaluate(() => {
      const emit = Reflect.get(window, 'emitImportProgress') as (event: object) => void
      emit({ type: 'stage', phase: 'reading', completed: 1, total: 3 })
    })
    await expect(dialog.getByText('1/3', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('max', '3')
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '1')
    await expect(page.getByRole('tab', { name: '카드사 명세서' })).toBeDisabled()
    await expect(page.locator('input[name="files"]')).toBeDisabled()
    expect(await page.evaluate(() => {
      const modal = document.querySelector('dialog')
      return modal?.parentElement === document.body && modal.matches(':modal')
    })).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await page.mouse.click(2, 2)
    await expect(dialog).toBeVisible()
    const backgroundBlocked = await page.getByRole('navigation', { name: '주 메뉴', exact: true })
      .getByRole('link', { name: '내역', exact: true })
      .click({ trial: true, timeout: 500 })
      .then(() => false, () => true)
    expect(backgroundBlocked).toBe(true)
    await page.evaluate(() => {
      document.body.style.minHeight = '1800px'
      window.scrollTo(0, 600)
      Reflect.set(window, 'importProgressDocument', document)
    })
    await page.screenshot({ path: testInfo.outputPath('progress-desktop.png') })
    await page.waitForTimeout(6_000)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('거래 내역 읽기', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const emit = Reflect.get(window, 'emitImportProgress') as (event: object) => void
      emit({ type: 'heartbeat' })
      emit({ type: 'stage', phase: 'saving', completed: 2, total: 3 })
    })
    await expect(dialog.getByText('인박스에 저장', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const emit = Reflect.get(window, 'emitImportProgress') as (event: object) => void
      emit({
        type: 'result',
        result: { message: '인박스에 3건 추가했습니다.', added: 3, alreadyProcessed: 0, automatic: 2, review: 1 },
      })
      const close = Reflect.get(window, 'closeImportProgress') as () => void
      close()
    })
    await expect(page.getByRole('button', { name: '검토 대기 보기', exact: true })).toBeVisible()
    expect(await page.evaluate(() => Reflect.get(window, 'importProgressDocument') === document)).toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBe(600)
    await page.waitForTimeout(300)
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('result-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await page.screenshot({ path: testInfo.outputPath('result-mobile.png') })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await expect.poll(() => dialog.getByRole('button', { name: '검토 대기 보기', exact: true })
      .evaluate((button) => getComputedStyle(button).color)).toBe('rgb(244, 244, 245)')
    await page.screenshot({ path: testInfo.outputPath('result-mobile-dark.png') })
    const submit = page.getByRole('button', { name: '인박스로 불러오기', exact: true })
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '거래 파일 처리 진행' })).toHaveCount(0)
    await expect(submit).toBeFocused()

    await page.locator('input[name="files"]').setInputFiles({
      name: 'banksalad-retry.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('synthetic processing failure'),
    })
    await submit.click()
    await page.evaluate(() => {
      const emit = Reflect.get(window, 'emitImportProgress') as (event: object) => void
      emit({ type: 'stage', phase: 'finalizing' })
      emit({ type: 'error', code: 'processing_failed', message: '마무리 확인에 실패했습니다.' })
      const close = Reflect.get(window, 'closeImportProgress') as () => void
      close()
    })
    await expect(dialog).toContainText('마무리 확인에 실패했습니다.')
    await expect(dialog).toContainText('일부 거래가 이미 저장되었을 수 있습니다.')
    await expect(dialog.getByRole('button', { name: '검토 대기 보기', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '입력으로 돌아가기', exact: true })).toBeVisible()
    const darkReviewColor = await dialog.getByRole('button', { name: '검토 대기 보기', exact: true })
      .evaluate((button) => getComputedStyle(button).color)
    expect(darkReviewColor).toBe('rgb(244, 244, 245)')
    await page.screenshot({ path: testInfo.outputPath('error-mobile-dark.png') })
    await page.waitForTimeout(300)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '입력으로 돌아가기', exact: true }).click()

    await submit.click()
    await page.evaluate(() => {
      const emit = Reflect.get(window, 'emitImportProgress') as (event: object) => void
      emit({ type: 'stage', phase: 'saving', completed: 2, total: 3 })
      const close = Reflect.get(window, 'closeImportProgress') as () => void
      close()
    })
    await expect(dialog).toContainText('완료 여부를 확인하지 못했습니다.')
    await expect(dialog.getByRole('button', { name: '검토 대기 보기', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '입력으로 돌아가기', exact: true }).click()
  } finally {
    await deleteTestState(email, householdId)
  }
})

import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { closeFixtureMonths } from './close-fixture-months'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only')
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
}

const suite = test.extend<{ household: string }>({
  household: async ({ page }, provide) => {
    const admin = adminClient()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const email = `month-close-${crypto.randomUUID()}@example.com`
    const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password: 'passw0rd!', email_confirm: true })
    if (userError) throw userError
    let id: string | undefined
    try {
      const { data, error } = await admin.from('households').insert({ name: 'E2E month close' }).select('id').single()
      if (error) throw error
      id = data.id
      const member = await admin.from('household_members').insert({ household_id: id, user_id: user.user!.id, role: 'owner' })
      if (member.error) throw member.error
      await page.goto('/login')
      await page.getByPlaceholder('이메일').fill(email)
      await page.getByPlaceholder('비밀번호').fill('passw0rd!')
      await page.getByRole('button', { name: '로그인', exact: true }).click()
      await expect(page).toHaveURL('/dashboard')
      await provide(id!)
      expect(errors).toEqual([])
    } finally {
      if (id) {
        const removed = await admin.from('households').delete().eq('id', id)
        if (removed.error) throw removed.error
      }
      await admin.auth.admin.deleteUser(user.user!.id)
    }
  },
})

async function seed(household: string, sparse = false) {
  const admin = adminClient()
  const { data: category, error } = await admin.from('categories').insert({ household_id: household, kind: 'expense', major: '식비', sub: '카페' }).select('id').single()
  if (error) throw error
  const rows = sparse ? [
    { date: '2026-01-15', flow: 'expense', amount: 400, memo: '1월 커피', category_id: category.id },
    { date: '2026-02-15', flow: 'expense', amount: 999, memo: '미마감 비용', category_id: category.id },
    { date: '2026-03-15', flow: 'expense', amount: 200, memo: '3월 커피', category_id: category.id },
  ] : [
    { date: '2026-08-15', flow: 'expense', amount: 42000, memo: '마감커피', category_id: category.id },
    { date: '2026-08-16', flow: 'expense', amount: 58000, memo: '다른 비용', category_id: category.id },
    { date: '2026-08-17', flow: 'income', amount: 500000, memo: '수입', category_id: null },
  ]
  const result = await admin.from('transactions').insert(rows.map(row => ({ ...row, household_id: household, source: 'e2e' })))
  if (result.error) throw result.error
}

async function closeVisibleMonth(page: Page, month: string) {
  await page.getByRole('button', { name: `${month} 월 마감`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/^전체 거래 \d+건$/)).toBeVisible()
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check()
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('region', { name: '월 마감 상태' })).toContainText(`${month} · 마감`)
}

suite('filtered ledger closes the whole month, inline edits invalidate it without reload, and reclose restores statistics', async ({ page, household }, info) => {
  await seed(household)
  await page.goto('/ledger?month=2026-08&q=마감커피')
  const draft = page.locator('#transaction-form input[name="memo"]')
  await draft.fill('유지할 작성 중 입력')
  await page.getByRole('button', { name: '2026-08 월 마감', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('전체 거래 3건')
  await expect(dialog).toContainText('100,000원')
  await expect(dialog).toContainText('500,000원')
  await expect(dialog).toContainText('필터와 무관')
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(draft).toHaveValue('유지할 작성 중 입력')
  await page.goto('/report?year=2026')
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: '8월 마감', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })).toBeVisible()
  await page.goto('/ledger?month=2026-08&q=마감커피')
  await page.getByRole('row').filter({ hasText: '마감커피' }).click()
  const edit = page.getByRole('row').filter({ has: page.getByRole('button', { name: '거래 수정 저장' }) })
  await edit.getByRole('textbox', { name: '금액', exact: true }).fill('43000')
  const origin = await page.evaluate(() => performance.timeOrigin)
  await edit.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect(page.getByRole('region', { name: '월 마감 상태' })).toContainText('재확인 필요')
  await expect(page.getByRole('status').filter({ hasText: '마감이 해제' })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await page.goto('/report?year=2026')
  await expect(page.getByRole('heading', { name: '마감한 월이 없습니다', exact: true })).toBeVisible()
  await page.goto('/ledger?month=2026-08')
  await closeVisibleMonth(page, '2026-08')
  await page.goto('/report?year=2026')
  await expect(page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('closed-statistics.png'), fullPage: true })
})

suite('sparse closed months keep gaps in every chart and tooltip, while closed zero remains selectable', async ({ page, household }, info) => {
  await seed(household, true)
  await closeFixtureMonths(adminClient(), household, ['2026-01', '2026-03', '2026-04'])
  await page.goto('/report?year=2026')
  const section = page.locator('#category-detail')
  await section.getByLabel('상세 항목 선택').selectOption({ label: '식비' })
  await expect(section.getByRole('button', { name: '식비 2월 미마감', exact: true })).toBeDisabled()
  await expect(section.getByRole('button', { name: '식비 4월 0원, 합계에서 제외', exact: true })).toHaveText('0')
  await expect(section.getByRole('img', { name: '식비 최근 추세', exact: true })).toBeVisible()
  const popup = section.locator('.pointer-events-none.absolute.top-2')
  for (const kind of ['누적 막대', '선', '100% 누적 영역']) {
    await section.getByRole('button', { name: kind, exact: true }).click()
    const canvas = section.locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    const bounds = (await canvas.boundingBox())!
    await canvas.hover({ position: { x: bounds.width * 1.5 / 12, y: bounds.height / 2 } })
    await expect(popup).not.toBeVisible()
  }
  await section.getByRole('button', { name: '선', exact: true }).click()
  const canvas = section.locator('canvas')
  const bounds = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: bounds.width * 2.5 / 12, y: bounds.height / 2 } })
  await expect(popup).toContainText('200')
  await expect(popup).toContainText('전월 대비 –')
  const response = page.waitForResponse(response => response.url().includes('/api/cell-tx?'))
  await section.getByRole('button', { name: '식비 카페 1월 400원, 합계에서 제외', exact: true }).hover()
  expect((await response).url()).toContain('scope=closed')
  await expect(page.getByRole('tooltip')).toContainText('1월 커피')
  // March has not been fetched/cached yet; invalidate it behind the current report.
  const update = await adminClient().from('transactions').update({ amount: 250 }).eq('household_id', household).eq('date', '2026-03-15')
  if (update.error) throw update.error
  const staleResponse = page.waitForResponse(response => response.url().includes('/api/cell-tx?') && response.status() === 409)
  await section.getByRole('button', { name: '식비 카페 3월 200원, 합계에서 제외', exact: true }).hover()
  await staleResponse
  await expect(section.getByRole('alert')).toContainText('마감 상태 또는 내역이 바뀌었습니다')
  await expect(page.getByRole('tooltip')).not.toBeVisible()
  await page.screenshot({ path: info.outputPath('sparse-closed-months.png'), fullPage: true })

  // Refresh this mounted chart, rather than navigating/remounting it: February
  // becomes eligible while March is reopened, and the selected row must survive.
  await closeFixtureMonths(adminClient(), household, ['2026-02'])
  const origin = await page.evaluate(() => performance.timeOrigin)
  await section.getByRole('button', { name: '최신 통계 확인', exact: true }).click()
  await expect(section.getByRole('button', { name: '식비 2월 999원, 합계에서 제외', exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: '식비 3월 미마감', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  const refreshedBounds = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: refreshedBounds.width * 1.5 / 12, y: refreshedBounds.height / 2 } })
  await expect(popup).toContainText('999')
  await canvas.hover({ position: { x: refreshedBounds.width * 2.5 / 12, y: refreshedBounds.height / 2 } })
  await expect(popup).not.toBeVisible()
})

suite('current month is restricted and empty ended months require explicit consent in mobile dark mode', async ({ page, household }, info) => {
  void household
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7)
  await page.goto(`/ledger?month=${current}`)
  await page.getByRole('button', { name: `${current} 월 마감`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('끝난 월만 마감')
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: `${current} 월 마감`, exact: true })).toBeFocused()
  await page.goto('/ledger?month=2026-04')
  await page.getByRole('button', { name: '2026-04 월 마감', exact: true }).click()
  await expect(dialog).toContainText('전체 거래 0건')
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: '거래 없는 월로 마감합니다.' }).check()
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('empty-month-dialog-dark-mobile.png') })
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: '2026-04 마감 확인 · 해제', exact: true }).click()
  await dialog.getByRole('button', { name: '마감 해제', exact: true }).click()
  await expect(page.getByRole('region', { name: '월 마감 상태' })).toContainText('재확인 필요')
})

suite('a stale confirmation reloads totals and clears consent; new inbox-only rows leave the month closed with a notice', async ({ page, household }) => {
  await seed(household)
  await page.goto('/ledger?month=2026-08')
  await page.getByRole('button', { name: '2026-08 월 마감', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/^전체 거래 3건$/)).toBeVisible()
  await dialog.getByRole('checkbox').check()
  const update = await adminClient().from('transactions').update({ amount: 43000 }).eq('household_id', household).eq('memo', '마감커피')
  if (update.error) throw update.error
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog).toContainText('101,000원')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const queued = await adminClient().from('import_inbox').insert({ household_id: household, import_uid: crypto.randomUUID(), date: '2026-08-19', amount: 100, flow: 'expense', owner: 'DJ', merchant: '추가 검토', status: 'pending' })
  if (queued.error) throw queued.error
  await page.reload()
  const status = page.getByRole('region', { name: '월 마감 상태' })
  await expect(status).toContainText('2026-08 · 마감')
  await expect(status).toContainText('이 달 가져오기 대기 1건')
  await page.goto('/report?year=2026')
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: '8월 마감', exact: true })).toBeVisible()
})

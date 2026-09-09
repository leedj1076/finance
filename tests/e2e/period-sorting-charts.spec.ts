import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { closeFixtureMonths } from './close-fixture-months'

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('These fixtures must only run against local Supabase')
  }
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const suite = test.extend<{ household: string }>({
  household: async ({ page }, runWithHousehold) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    const admin = adminClient()
    const email = `finance-navigation-${crypto.randomUUID()}@example.com`
    const password = 'passw0rd!'
    const { data: auth, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (authError) throw authError
    const user = auth.user!
    let householdId: string | undefined
    try {
      const { data, error } = await admin.from('households').insert({ name: 'Navigation test' }).select('id').single()
      if (error) throw error
      householdId = data.id
      const { error: memberError } = await admin.from('household_members').insert({ household_id: householdId, user_id: user.id, role: 'owner' })
      if (memberError) throw memberError
      await page.goto('/login')
      await page.getByPlaceholder('이메일').fill(email)
      await page.getByPlaceholder('비밀번호').fill(password)
      await page.getByRole('button', { name: '로그인', exact: true }).click()
      await expect(page).toHaveURL('/dashboard')
      await runWithHousehold(householdId!)
      expect(pageErrors).toEqual([])
    } finally {
      if (householdId) {
        const { error } = await admin.from('households').delete().eq('id', householdId)
        if (error) throw error
      }
      const { error } = await admin.auth.admin.deleteUser(user.id)
      if (error) throw error
    }
  },
})

async function seedBudget(household: string) {
  const admin = adminClient()
  const { data: category, error } = await admin.from('categories').insert({ household_id: household, kind: 'expense', major: '식비', sub: '식사' }).select('id').single()
  if (error) throw error
  const { error: budgetError } = await admin.from('budgets').insert([
    { household_id: household, month: '2026-06', major: '식비', amount: 300001 },
    { household_id: household, month: '2026-07', major: '식비', amount: 500001 },
  ])
  if (budgetError) throw budgetError
  const { error: txError } = await admin.from('transactions').insert([
    { household_id: household, date: '2026-06-10', amount: 123457, flow: 'expense', category_id: category.id, source: 'e2e' },
    { household_id: household, date: '2026-07-10', amount: 723693, flow: 'expense', category_id: category.id, source: 'e2e' },
  ])
  if (txError) throw txError
}

suite('budget month navigation replaces stale picker and month-specific amounts', async ({ page, household }) => {
  await seedBudget(household)
  await page.goto('/budgets?month=2026-07')
  const month = page.locator('input[type="month"]')
  const amount = page.getByRole('spinbutton', { name: '식비 예산', exact: true })
  await expect(amount).toHaveValue('500001')
  await month.fill('2026-09')
  await amount.fill('900001')
  await page.getByRole('link', { name: '이전 달', exact: true }).click()
  await expect(page).toHaveURL('/budgets?month=2026-06')
  await expect(month).toHaveValue('2026-06')
  await expect(amount).toHaveValue('300001')
  await page.getByRole('link', { name: '다음 달', exact: true }).click()
  await expect(month).toHaveValue('2026-07')
  await expect(amount).toHaveValue('500001')
  await page.goBack()
  await expect(month).toHaveValue('2026-06')
  await expect(amount).toHaveValue('300001')
})

suite('asset month navigation replaces stale balance drafts', async ({ page, household }) => {
  const admin = adminClient()
  const { data: account, error } = await admin.from('asset_accounts').insert({ household_id: household, major: '현금', name: '테스트 잔고', kind: 'asset' }).select('id').single()
  if (error) throw error
  const { error: snapshotError } = await admin.from('balance_snapshots').insert([
    { household_id: household, account_id: account.id, month: '2026-06', amount: 300001 },
    { household_id: household, account_id: account.id, month: '2026-07', amount: 500001 },
  ])
  if (snapshotError) throw snapshotError
  await page.goto('/assets?month=2026-07')
  await page.locator('#balance-adjustment summary').click()
  const month = page.getByLabel('자산 기준 월')
  const amount = page.getByLabel('테스트 잔고 잔액')
  await month.fill('2026-09')
  await amount.fill('900001')
  await page.getByRole('link', { name: '이전 달', exact: true }).click()
  await expect(month).toHaveValue('2026-06')
  await expect(amount).toHaveValue('300001')
  await page.getByRole('link', { name: '다음 달', exact: true }).click()
  await expect(month).toHaveValue('2026-07')
  await expect(amount).toHaveValue('500001')
})

suite('budget money fields accept single won amounts, but not negatives or fractions', async ({ page, household }) => {
  await seedBudget(household)
  await page.goto('/budgets?month=2026-07')
  const budget = page.getByRole('spinbutton', { name: '식비 예산', exact: true })
  await budget.fill('723693')
  expect(await budget.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  const cut = page.getByRole('spinbutton', { name: '식비 감축액' })
  await page.locator('summary').filter({ hasText: '절약 시뮬레이션' }).click()
  await cut.fill('123')
  expect(await cut.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible()
  const { data, error } = await adminClient().from('budgets').select('amount').eq('household_id', household).eq('month', '2026-07').eq('major', '식비').single()
  if (error) throw error
  expect(Number(data.amount)).toBe(723693)
  await page.goto('/budgets/review?month=2026-07')
  const review = page.getByRole('spinbutton', { name: '식비 다음 달 예산' })
  await review.fill('723693')
  expect(await review.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  for (const value of ['-1', '1.5']) {
    await review.fill(value)
    expect(await review.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false)
  }
})

suite('ledger synchronizes month chips, picker and new-transaction date', async ({ page, household }) => {
  await seedBudget(household)
  await page.goto('/ledger?month=2026-07&flow=expense')
  const month = page.getByLabel('조회 월')
  await month.fill('2026-01')
  await page.locator('#transaction-form input[name="date"]').fill('2026-07-21')
  await page.getByRole('link', { name: '2026-06 · 1건', exact: true }).click()
  await expect(month).toHaveValue('2026-06')
  await expect(page.locator('#transaction-form input[name="date"]')).toHaveValue('2026-06-01')
  await expect(page.getByLabel('거래 유형 필터')).toHaveValue('expense')
  await page.goBack()
  await expect(month).toHaveValue('2026-07')
  await page.goForward()
  await expect(month).toHaveValue('2026-06')
})

function ledgerTitles(page: Page) {
  return page.locator('table tbody tr[title="클릭해서 수정"] td:nth-child(2)')
}

suite('recurring schedule saves without preposting, renders occurrences, and stops at the last month', async ({ page, household }) => {
  const admin = adminClient()
  await page.goto('/recurring?month=2026-09')
  await page.getByRole('button', { name: '+ 새 규칙', exact: true }).click()
  await page.getByLabel('새 정기거래 사용내역', { exact: true }).fill('부모급여 (X회)')
  await page.getByLabel('부모급여 (X회) 구분', { exact: true }).selectOption('saving')
  await page.getByLabel('부모급여 (X회) 금액', { exact: true }).fill('500000')
  await page.getByLabel('부모급여 (X회) 결제일', { exact: true }).fill('25')
  await page.locator('summary').filter({ hasText: '기간·회차·휴일 설정' }).click()
  await page.getByLabel('부모급여 (X회) 시작 월', { exact: true }).fill('2026-09')
  await page.getByLabel('부모급여 (X회) 종료 월', { exact: true }).fill('2027-04')
  await page.getByLabel('부모급여 (X회) 시작 회차', { exact: true }).fill('17')
  await page.getByLabel('부모급여 (X회) 이전 영업일 조정', { exact: true }).check()
  await expect(page.getByText('마지막: 2027-04 · 부모급여 (24회)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '정기거래 저장', exact: true }).click()
  await expect(page).toHaveURL('/recurring?month=2026-09&saved=1')
  await page.reload()
  await expect(page.locator('summary').filter({ hasText: '기간·회차·휴일 설정' })).toContainText('시작 17회')
  const { data: before, error: beforeError } = await admin.from('transactions').select('id').eq('household_id', household)
  if (beforeError) throw beforeError
  expect(before).toEqual([])
  await page.goto('/ledger?month=2026-09')
  await page.getByRole('button', { name: '미반영 1건 반영', exact: true }).click()
  await expect(page.locator('table')).toContainText('부모급여 (17회)')
  await expect(page.locator('table')).toContainText('09-23')
  await page.goto('/ledger?month=2027-04')
  await page.getByRole('button', { name: '미반영 1건 반영', exact: true }).click()
  await expect(page.locator('table')).toContainText('부모급여 (24회)')
  await expect(page.locator('table')).toContainText('04-23')
  await page.goto('/ledger?month=2027-05')
  await expect(page.getByRole('button', { name: /미반영.*반영/ })).toHaveCount(0)
  const { data: after, error: afterError } = await admin.from('transactions').select('id').eq('household_id', household)
  if (afterError) throw afterError
  expect(after).toHaveLength(2)
  await page.goto('/recurring?month=2027-05')
  await expect(page.getByText('기간 종료', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('summary').filter({ hasText: '기간·회차·휴일 설정' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

suite('report year navigation and browser history keep the displayed year and chart view aligned', async ({ page, household }) => {
  await seedBudget(household)
  await closeFixtureMonths(adminClient(), household, ['2026-06', '2026-07'])
  await page.goto('/report?year=2026&chart=line&axis=account&flow=expense')
  const previous = page.getByRole('link', { name: '이전 해', exact: true })
  const next = page.getByRole('link', { name: '다음 해', exact: true })
  await expect(previous.locator('..')).toContainText('2026년')
  await next.click()
  await expect(previous.locator('..')).toContainText('2027년')
  await expect(previous).toHaveAttribute('href', /year=2026.*chart=line.*axis=account/)
  await previous.click()
  await page.locator('#category-detail').getByRole('button', { name: '100% 누적 영역', exact: true }).click()
  await expect(next).toHaveAttribute('href', /year=2027.*chart=area/)
  await page.goBack()
  await expect(previous.locator('..')).toContainText('2027년')
  await expect(previous).toHaveAttribute('href', /year=2026.*chart=line.*axis=account/)
})

suite('ledger sorts filtered transactions and retains order through navigation and inline saves', async ({ page, household }) => {
  const { error } = await adminClient().from('transactions').insert([
    { household_id: household, date: '2026-07-01', amount: 10000, memo: '대상 큰 금액', flow: 'expense', source: 'e2e' },
    { household_id: household, date: '2026-07-02', amount: 2000, memo: '대상 작은 금액', flow: 'expense', source: 'e2e' },
    { household_id: household, date: '2026-07-03', amount: -1000, memo: '대상 환불', flow: 'expense', source: 'e2e' },
    { household_id: household, date: '2026-07-04', amount: 999999, memo: '숨겨진 수입', flow: 'income', source: 'e2e' },
  ])
  if (error) throw error
  await page.goto('/ledger?month=2026-07&flow=expense&q=대상')
  const sort = page.getByRole('combobox', { name: '거래 정렬' })
  await expect(sort).toHaveValue('date-desc')
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 작은 금액', '대상 큰 금액'])
  await sort.selectOption('date-asc')
  await expect(ledgerTitles(page)).toHaveText(['대상 큰 금액', '대상 작은 금액', '대상 환불'])
  await sort.selectOption('amount-desc')
  await expect(ledgerTitles(page)).toHaveText(['대상 큰 금액', '대상 작은 금액', '대상 환불'])
  await sort.selectOption('amount-asc')
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 작은 금액', '대상 큰 금액'])
  await page.reload()
  await expect(sort).toHaveValue('amount-asc')
  await page.getByRole('link', { name: '이전 달', exact: true }).click()
  await expect(page.getByLabel('조회 월')).toHaveValue('2026-06')
  await expect(sort).toHaveValue('amount-asc')
  await page.getByRole('link', { name: '다음 달', exact: true }).click()
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 작은 금액', '대상 큰 금액'])
  await page.getByRole('row').filter({ hasText: '대상 작은 금액' }).click()
  const edit = page.getByRole('row').filter({ has: page.getByRole('button', { name: '거래 수정 저장' }) })
  await edit.getByRole('textbox', { name: '금액', exact: true }).fill('20000')
  await edit.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 큰 금액', '대상 작은 금액'])
  await expect(sort).toHaveValue('amount-asc')
  await expect(page.getByLabel('사용내역 검색')).toHaveValue('대상')

  const draft = page.locator('#transaction-form')
  await draft.locator('input[name="memo"]').fill('대상 수동 추가')
  await draft.locator('input[name="amount"]').fill('40000')
  await draft.getByRole('button', { name: '거래 추가', exact: true }).click()
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 큰 금액', '대상 작은 금액', '대상 수동 추가'])
  await expect(sort).toHaveValue('amount-asc')
  page.once('dialog', (dialog) => dialog.accept())
  const created = page.getByRole('row').filter({ hasText: '대상 수동 추가' })
  await created.hover()
  await created.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 큰 금액', '대상 작은 금액'])
  await expect(sort).toHaveValue('amount-asc')
  await page.getByRole('navigation', { name: '거래 보기' }).getByRole('link', { name: '요약', exact: true }).click()
  await expect(page).toHaveURL(/tab=summary$/)
  await expect(page.getByRole('heading', { name: '큰 거래 TOP 10', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '거래 보기' }).getByRole('link', { name: '목록', exact: true }).click()
  await expect(page).toHaveURL(/tab=list$/)
  await expect(ledgerTitles(page)).toHaveText(['대상 환불', '대상 큰 금액', '대상 작은 금액'])
  await expect(sort).toHaveValue('amount-asc')
  await page.getByRole('link', { name: '초기화', exact: true }).click()
  await expect(page).toHaveURL('/ledger?month=2026-07&sort=amount-asc&tab=list')
  await expect(sort).toHaveValue('amount-asc')
  await expect(page.getByLabel('사용내역 검색')).toHaveValue('')
  await expect(page.getByLabel('거래 유형 필터')).toHaveValue('')
})

suite('stacked area selects the visible band, and leaving the chart clears only its tooltip', async ({ page, household }, testInfo) => {
  const admin = adminClient()
  const { data: categories, error } = await admin.from('categories').insert([
    { household_id: household, kind: 'expense', major: '아래 항목', sub: '상세' },
    { household_id: household, kind: 'expense', major: '중간 항목', sub: '상세' },
    { household_id: household, kind: 'expense', major: '위 항목', sub: '상세' },
  ]).select('id,major')
  if (error) throw error
  const amounts: Record<string, number> = { '아래 항목': 60000, '중간 항목': 30000, '위 항목': 10000 }
  const { error: txError } = await admin.from('transactions').insert(categories.flatMap((category) => [1, 2].map((month) => ({
    household_id: household, category_id: category.id, date: `2026-0${month}-10`, amount: amounts[category.major], flow: 'expense', source: 'e2e',
  }))))
  if (txError) throw txError
  await closeFixtureMonths(admin, household, ['2026-01', '2026-02'])
  await page.goto('/report?year=2026&chart=area')
  const section = page.locator('#category-detail')
  const canvas = section.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  const x = bounds.x + bounds.width * 0.75 / 12
  const y = bounds.y + bounds.height * 0.35
  const popup = section.locator('.pointer-events-none.absolute.top-2')
  // Move within the painted interval, rather than the rounded edge of Jan's
  // center. Poll movement while Chart.js completes its initial animation.
  await expect(async () => {
    await page.mouse.move(x, y)
    await expect(popup).toContainText('중간 항목', { timeout: 200 })
  }).toPass({ timeout: 5000 })
  await expect(popup).toContainText('30,000')
  await page.mouse.click(x, y)
  await page.mouse.move(bounds.x - 10, bounds.y + 80)
  await expect(popup).not.toBeVisible()
  await expect(section.getByText('중간 항목 · 1월 선택')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('area-selected.png'), fullPage: true })
  await section.getByRole('button', { name: /중간 항목 1월.*제외/ }).hover()
  await expect(popup).not.toBeVisible()
  // Both chart implementations must clear hover without clearing selection.
  for (const kind of ['선', '누적 막대']) {
    await section.getByRole('button', { name: kind, exact: true }).click()
    await canvas.hover({ position: { x: bounds.width / 24, y: bounds.height * 0.35 } })
    await expect(popup).toBeVisible()
    await section.getByRole('heading').hover()
    await expect(popup).not.toBeVisible()
  }
})

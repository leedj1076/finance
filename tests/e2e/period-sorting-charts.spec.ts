import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { currentMonthInKorea, shiftMonth } from '@/lib/finance'
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

function localDatabase() {
  const url = process.env.DATABASE_URL!
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('These fixtures must only run against local Postgres')
  }
  return postgres(url, { max: 1 })
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

suite('category selection keeps rankings visible and subcategories filter inline and list transactions', async ({ page, household }) => {
  const admin = adminClient()
  const majors = ['식비', '주거', '교통', '자녀', '보험', '통신', '문화', '여행', '경조사']
  const { data: cats, error } = await admin.from('categories').insert([
    ...majors.map(major => ({ household_id: household, kind: 'expense', major, sub: major === '식비' ? '카페' : '기본' })),
    { household_id: household, kind: 'expense', major: '식비', sub: '장보기' },
  ]).select('id, major, sub')
  if (error) throw error
  const { error: txError } = await admin.from('transactions').insert(cats!.map((cat, index) => ({
    household_id: household, category_id: cat.id, date: '2026-07-10', flow: 'expense',
    amount: cat.sub === '카페' ? 12000 : cat.sub === '장보기' ? 34000 : 9000 - index * 100,
    memo: `분류테스트 ${cat.major} ${cat.sub}`, source: 'e2e',
  })))
  if (txError) throw txError
  await page.goto('/ledger?month=2026-07&tab=categories&flow=expense&q=분류테스트')
  const ranks = page.getByRole('heading', { name: '카테고리 순위', exact: true }).locator('..')
  await ranks.getByRole('link', { name: '식비', exact: true }).click()
  await expect(ranks.getByRole('link', { name: '주거', exact: true })).toBeVisible()
  await expect(ranks.getByRole('link', { name: '식비', exact: true })).toHaveAttribute('aria-current', 'true')
  await expect(ranks.getByRole('link', { name: '경조사', exact: true })).toHaveCount(0)
  await ranks.getByRole('button', { name: '전체 보기' }).click()
  await expect(ranks.getByRole('link', { name: '경조사', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '소분류 카페', exact: true }).click()
  const rows = page.getByRole('region', { name: '카테고리 거래 내역' })
  await expect(rows.getByText('분류테스트 식비 카페', { exact: true })).toBeVisible()
  await expect(rows.getByText('분류테스트 식비 장보기', { exact: true })).toHaveCount(0)
  await expect(rows).toContainText('1건 · 12,000원')
  await expect(page.getByRole('link', { name: '소분류 장보기', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/category-selection-1440.png', fullPage: true })
  await page.getByRole('link', { name: '거래 보기 →', exact: true }).click()
  await expect(page).toHaveURL(/sub=/)
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('분류테스트 식비 카페')
  await page.getByRole('combobox', { name: '거래 정렬' }).selectOption('amount-desc')
  await expect(page).toHaveURL(/sub=/)
  await page.getByRole('navigation', { name: '거래 보기' }).getByRole('link', { name: '카테고리', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: '전체 소분류', exact: true }).click()
  await expect(rows.getByText('분류테스트 식비 장보기', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '카테고리 선택 해제', exact: true }).click()
  await expect(page).not.toHaveURL(/major=|sub=/)
  await expect(page.getByRole('searchbox', { name: '사용내역 검색' })).toHaveValue('분류테스트')
  await expect(ranks.getByRole('link', { name: '주거', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/category-selection-390.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

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
  for (const value of ['-1', '1.5']) {
    await budget.fill(value)
    expect(await budget.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false)
  }
  await budget.fill('723693')
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  // Consent is asked for in a dialog now, after the server refuses, not pre-ticked below the table.
  await page.getByRole('dialog', { name: '상한 초과 저장 확인', exact: true })
    .getByRole('button', { name: '초과를 확인하고 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible()
  const { data, error } = await adminClient().from('budgets').select('amount').eq('household_id', household).eq('month', '2026-07').eq('major', '식비').single()
  if (error) throw error
  expect(Number(data.amount)).toBe(723693)

  const admin = adminClient()
  const aiMonth = currentMonthInKorea()
  const { data: incomeCategory, error: incomeCategoryError } = await admin.from('categories')
    .insert({ household_id: household, kind: 'income', major: '월급', sub: '급여' }).select('id').single()
  if (incomeCategoryError) throw incomeCategoryError
  const { error: incomeError } = await admin.from('transactions').insert({
    household_id: household,
    date: `${shiftMonth(aiMonth, -1)}-01`,
    amount: 1_000_000,
    flow: 'income',
    category_id: incomeCategory.id,
    source: 'e2e',
  })
  if (incomeError) throw incomeError
  const database = localDatabase()
  try {
    await database`insert into diagnosis_workers
      (household_id, token_hash, label, prompt_protocol_version, prompt_last_seen_at, budget_protocol_version, budget_last_seen_at)
      values (${household}, ${'0'.repeat(64)}, 'E2E budget numeric worker', 1, now(), 1, now())`
  } finally {
    await database.end()
  }
  await page.goto(`/budgets?month=${aiMonth}`)
  await page.getByRole('button', { name: 'AI 추천 받기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI 예산 추천 요청', exact: true })
  const plannedAmount = dialog.getByLabel('예정 지출 금액', { exact: true })
  await plannedAmount.fill('123')
  await dialog.getByRole('button', { name: '추가', exact: true }).click()
  const addedAmount = dialog.getByLabel('예정 지출 1 금액', { exact: true })
  await expect(addedAmount).toHaveValue('123')
  for (const value of ['-1', '1.5']) {
    await addedAmount.fill(value)
    await dialog.getByRole('button', { name: '추천 요청', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('예정 지출의 카테고리와 금액을 확인해 주세요.')
  }
})

suite('ledger synchronizes month chips, picker and new-transaction date', async ({ page, household }) => {
  await seedBudget(household)
  await page.goto('/ledger?month=2026-07&flow=expense')
  const month = page.getByLabel('조회 월')
  await month.fill('2026-01')
  await page.locator('#transaction-form summary').click()
  await page.locator('#transaction-form input[name="date"]').fill('2026-07-21')
  await page.getByRole('link', { name: '2026-06 · 1건', exact: true }).click()
  await expect(month).toHaveValue('2026-06')
  await page.locator('#transaction-form summary').click()
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

for (const [targetMonth, width] of [[currentMonthInKorea(), 1280], ['2026-07', 390]] as const) {
  suite(`recurring selection popup posts only checked rows and remains open at ${width}px`, async ({ page, household }) => {
    const admin = adminClient()
    const { error } = await admin.from('recurring').insert([
      { household_id: household, flow: 'expense', memo: '선택 테스트 월세', amount: 500000, day: 10 },
      { household_id: household, flow: 'saving', memo: '선택 테스트 저축', amount: 100000, day: 20 },
    ])
    if (error) throw error
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/ledger?month=${targetMonth}&tab=list&flow=expense&q=선택`)
    const originalUrl = page.url()
    await page.getByRole('button', { name: '미반영 2건 반영', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `${targetMonth} 정기거래 선택 반영`, exact: true })
    await expect(dialog).toBeVisible()
    const rent = dialog.getByRole('checkbox', { name: '선택 테스트 월세', exact: true })
    const saving = dialog.getByRole('checkbox', { name: '선택 테스트 저축', exact: true })
    await expect(rent).not.toBeChecked()
    await expect(saving).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: '선택한 0건 반영', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '전체 선택', exact: true }).click()
    await expect(rent).toBeChecked()
    await expect(saving).toBeChecked()
    await dialog.getByRole('button', { name: '전체 해제', exact: true }).click()
    await rent.check()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/recurring-selection-list-${width}.png`, fullPage: true })

    // Pause the action transport, then fail it: no transaction reaches the server.
    let failRequest!: () => void
    const held = new Promise<void>(resolve => { failRequest = resolve })
    await page.route('**/ledger?*', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await held
      await route.abort('failed')
    })
    await dialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '반영 중…', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    failRequest()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(rent).toBeChecked()
    await page.unroute('**/ledger?*')

    await dialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('1건 반영')
    await expect(dialog.getByRole('status')).toContainText('미반영 1건')
    await expect(dialog).toBeVisible()
    await expect(rent).toHaveCount(0)
    await expect(saving).not.toBeChecked()
    const { data: posted } = await admin.from('transactions').select('memo').eq('household_id', household)
    expect(posted).toEqual([{ memo: '선택 테스트 월세' }])
    expect(page.url()).toBe(originalUrl)
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByRole('button', { name: '미반영 1건 반영', exact: true }).click()
    await expect(saving).not.toBeChecked()
    await saving.check()
    await dialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('미반영 0건')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('미반영 정기거래가 없습니다.', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/recurring-selection-${width}.png`, fullPage: true })
    await dialog.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.getByRole('button', { name: /미반영.*반영/ })).toHaveCount(0)
  })
}

suite('AI wrap-up selection reconciles rules already posted in another tab', async ({ page, household }) => {
  const admin = adminClient()
  const { data: rules, error } = await admin.from('recurring').insert([
    { household_id: household, flow: 'expense', memo: '이 창에서 반영', amount: 500000, day: 10 },
    { household_id: household, flow: 'saving', memo: '다른 창에서 반영', amount: 100000, day: 20 },
  ]).select('id, memo')
  if (error) throw error
  await page.goto('/ledger?month=2026-07&tab=ai')
  await page.getByRole('button', { name: '미반영 2건 반영', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '2026-07 정기거래 선택 반영', exact: true })
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  const otherId = rules.find(rule => rule.memo === '다른 창에서 반영')!.id
  const { error: postingError } = await admin.from('transactions').insert({
    household_id: household, flow: 'saving', amount: 100000, date: '2026-07-20',
    memo: '다른 창에서 반영', source: 'recurring', recurring_id: otherId, import_uid: `recurring:${otherId}:2026-07`,
  })
  if (postingError) throw postingError
  await dialog.getByRole('checkbox', { name: '이 창에서 반영', exact: true }).check()
  await dialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('미반영 0건')
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.getByText('미반영 정기거래가 없습니다.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL('/ledger?month=2026-07&tab=ai')
})

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
  const postingDialog = page.getByRole('dialog', { name: /정기거래 선택 반영/ })
  await postingDialog.getByRole('checkbox', { name: '부모급여 (17회)', exact: true }).check()
  await postingDialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
  await expect(postingDialog.getByRole('status')).toContainText('1건 반영')
  await postingDialog.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(page.locator('table')).toContainText('부모급여 (17회)')
  await expect(page.locator('table')).toContainText('09-23')
  await page.goto('/ledger?month=2027-04')
  await page.getByRole('button', { name: '미반영 1건 반영', exact: true }).click()
  await postingDialog.getByRole('checkbox', { name: '부모급여 (24회)', exact: true }).check()
  await postingDialog.getByRole('button', { name: '선택한 1건 반영', exact: true }).click()
  await expect(postingDialog.getByRole('status')).toContainText('1건 반영')
  await postingDialog.getByRole('button', { name: '닫기', exact: true }).click()
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
  await draft.locator('summary').click()
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
  await page.getByRole('link', { name: '전체 필터 초기화', exact: true }).click()
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
  const popup = page.getByRole('tooltip', { name: '월별 차트 상세' })
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

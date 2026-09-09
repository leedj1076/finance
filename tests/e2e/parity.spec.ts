import { writeFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { closeFixtureMonths } from './close-fixture-months'
import { HYUNDAI_TEST_PASSWORD, secureHyundaiFixture } from '../fixtures/hyundai-secure'
import { NH_TEST_PASSWORD, syntheticNhPdf } from '../fixtures/nh-pdf'
import { SHINHAN_STATEMENT_HTML } from '../fixtures/shinhan-statement'

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
      name: 'DJ 삼성카드',
      owner: 'DJ',
      type: 'card',
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
    await closeFixtureMonths(admin, household.id, [`${dashboardYear}-01`, `${dashboardYear}-02`])
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

async function openCardReview(page: Page, date: string, cardName = 'DJ 삼성카드') {
  await page.getByRole('button', { name: '검토 대기 보기', exact: true }).click()
  const [year, month] = date.split('-')
  const monthGroup = page.getByRole('button', { name: new RegExp(`${year}년 ${Number(month)}월`) })
  await expect(monthGroup).toHaveAttribute('aria-expanded', 'false')
  await monthGroup.click()
  const ownerGroup = page.getByRole('button', { name: /^DJ 1건 결제수단 1개$/ })
  await expect(ownerGroup).toHaveAttribute('aria-expanded', 'false')
  await ownerGroup.click()
  const cardGroup = page.getByRole('button', { name: new RegExp(`^${cardName} 1건`) })
  await expect(cardGroup).toHaveAttribute('aria-expanded', 'false')
  await cardGroup.click()
}

async function watchMutationFeedback(page: Page) {
  await page.evaluate(() => {
    const observed = window as typeof window & { mutationAnimations: string[] }
    observed.mutationAnimations = []
    document.addEventListener('animationstart', (event) => {
      if (event.animationName === 'page-enter') observed.mutationAnimations.push(event.animationName)
    })
  })
}

async function expectNoPageFlash(page: Page) {
  expect(await page.evaluate(() => (
    window as typeof window & { mutationAnimations: string[] }
  ).mutationAnimations)).toEqual([])
}

function inboxRowBySourceTitle(page: Page, sourceTitle: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('textbox', { name: `${sourceTitle} 거래명`, exact: true }),
  })
}

test('ledger inline save keeps the page, draft and scroll while refreshing filtered totals', async ({ page }) => {
  const email = `finance-inline-ledger-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, password)
    householdId = setup.householdId
    const { error } = await createAdminClient().from('transactions').insert({
      household_id: householdId, date: '2026-08-12', flow: 'expense',
      amount: 5000, memo: '수정할 거래', category_id: setup.categoryId,
      account_id: setup.accountId, source: 'e2e',
    })
    if (error) throw error
    await loginAs(page, email, password)
    const url = '/ledger?month=2026-08&tab=list&flow=expense'
    await page.goto(url)
    const draft = page.locator('#transaction-form input[name="memo"]')
    await draft.fill('저장하지 않은 새 거래')
    await page.getByRole('row').filter({ hasText: '수정할 거래' }).click()
    const edit = page.getByRole('row').filter({ has: page.getByRole('button', { name: '거래 수정 저장' }) })
    await edit.getByRole('textbox', { name: '사용내역', exact: true }).fill('수정할 거래 변경')
    await edit.getByRole('textbox', { name: '금액', exact: true }).fill('0')
    await edit.getByRole('button', { name: '거래 수정 저장' }).click()
    await expect(page.getByText('금액은 0이 아닌 정수로 입력해 주세요.')).toBeVisible()
    await expect(edit.getByRole('textbox', { name: '사용내역', exact: true })).toHaveValue('수정할 거래 변경')
    await expect(edit.getByRole('textbox', { name: '금액', exact: true })).toHaveValue('0')
    await edit.getByRole('textbox', { name: '금액', exact: true }).fill('7000')
    await watchMutationFeedback(page)
    const scroll = await page.evaluate(() => window.scrollY)
    await edit.getByRole('button', { name: '거래 수정 저장' }).click()
    await expect(page.getByRole('row').filter({ hasText: '수정할 거래' })).toContainText('7,000원')
    await expect(page.getByText('지출', { exact: false }).filter({ has: page.locator('strong', { hasText: '7,000원' }) }).first()).toBeVisible()
    await expect(draft).toHaveValue('저장하지 않은 새 거래')
    await expect(page).toHaveURL(url)
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll)
    await expectNoPageFlash(page)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('inbox title edits survive review operations and save through single and bulk apply', async ({ page }, testInfo) => {
  const email = `finance-inline-inbox-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, password)
    householdId = setup.householdId
    const { error } = await createAdminClient().from('import_inbox').insert(
      ['제외할 거래', '반영할 거래', '수정 중인 거래'].map((merchant, index) => ({
        household_id: householdId, import_uid: crypto.randomUUID(), owner: 'DJ',
        date: '2026-08-12', merchant, amount: 5000, flow: 'expense',
        account_id: setup.accountId,
        confidence: index === 1 ? 'high' : 'review',
      })),
    )
    if (error) throw error
    await loginAs(page, email, password)
    // No explicit tab: processing the last item must not switch to upload.
    await page.goto('/inbox')
    await page.getByRole('button', { name: '모든 그룹 펼치기' }).click()
    await page.evaluate(() => {
      (window as typeof window & { inboxTitleDocument?: Document }).inboxTitleDocument = document
    })
    const excludedRow = inboxRowBySourceTitle(page, '제외할 거래')
    const bulkRow = inboxRowBySourceTitle(page, '반영할 거래')
    const singleRow = inboxRowBySourceTitle(page, '수정 중인 거래')
    await expect(excludedRow).toHaveCount(1)
    await expect(bulkRow).toHaveCount(1)
    await expect(singleRow).toHaveCount(1)
    const bulkTitle = bulkRow.getByRole('textbox', { name: '반영할 거래 거래명' })
    const singleTitle = singleRow.getByRole('textbox', { name: '수정 중인 거래 거래명' })
    await bulkTitle.fill('일괄 편집 거래명')
    await singleTitle.fill('개별 편집 초안')
    await page.getByRole('combobox', { name: '수정 중인 거래 카테고리' }).selectOption(String(setup.categoryId))
    await page.screenshot({ path: testInfo.outputPath('pending-title-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: '모든 그룹 접기' }).click()
    await expect(singleTitle).toHaveCount(0)
    await page.getByRole('button', { name: '모든 그룹 펼치기' }).click()
    await expect(page.getByRole('textbox', { name: '반영할 거래 거래명' })).toHaveValue('일괄 편집 거래명')
    await expect(page.getByRole('textbox', { name: '수정 중인 거래 거래명' })).toHaveValue('개별 편집 초안')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('pending-title-390.png'), fullPage: true })
    await page.setViewportSize({ width: 1280, height: 720 })
    await watchMutationFeedback(page)
    await page.getByRole('checkbox', { name: '제외할 거래 선택', exact: true }).check()
    await page.getByRole('button', { name: '선택 제외', exact: true }).first().click()
    await expect(inboxRowBySourceTitle(page, '제외할 거래')).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: '1건을 인박스에서 제외' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '수정 중인 거래 카테고리' })).toHaveValue(String(setup.categoryId))
    await expect(page.getByRole('textbox', { name: '수정 중인 거래 거래명' })).toHaveValue('개별 편집 초안')
    await expect(page.getByRole('navigation', { name: '가져오기 작업' })).toContainText('검토 대기2')
    await expect(page).toHaveURL('/inbox')
    await expectNoPageFlash(page)
    await page.getByRole('textbox', { name: '수정 중인 거래 거래명' }).fill('')
    await page.getByRole('checkbox', { name: '반영할 거래 선택', exact: true }).check()
    await page.getByRole('button', { name: '선택 반영', exact: true }).first().click()
    await expect(inboxRowBySourceTitle(page, '반영할 거래')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '수정 중인 거래 카테고리' })).toHaveValue(String(setup.categoryId))
    const retainedTitle = page.getByRole('textbox', { name: '수정 중인 거래 거래명' })
    await expect(retainedTitle).toHaveValue('')
    await retainedTitle.fill('개별 편집 초안')
    await retainedTitle.press('Enter')
    await expect(inboxRowBySourceTitle(page, '수정 중인 거래')).toHaveCount(1)
    await retainedTitle.fill('   ')
    await page.getByRole('checkbox', { name: '수정 중인 거래 선택', exact: true }).check()
    await page.getByRole('button', { name: '선택 반영', exact: true }).first().click()
    await expect(page.getByRole('status')).toContainText('거래명')
    await expect(retainedTitle).toHaveValue('   ')
    await expect(page.getByRole('checkbox', { name: '수정 중인 거래 선택', exact: true })).toBeChecked()
    await expect(page.getByRole('button', { name: /^2026년 8월/ })).toHaveAttribute('aria-expanded', 'true')
    expect(await page.evaluate(() => (
      window as typeof window & { inboxTitleDocument?: Document }
    ).inboxTitleDocument === document)).toBe(true)
    await retainedTitle.fill('개별 편집 거래명')
    await page.getByRole('button', { name: '수정 중인 거래 바로 반영' }).click()
    await expect(page.getByText('모든 대기 거래를 처리했습니다.')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '가계부에 반영했습니다.' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '가져오기 작업' })).toContainText('검토 대기0')
    await expect(page).toHaveURL('/inbox')
    await expectNoPageFlash(page)
    await page.getByRole('navigation', { name: '주 메뉴', exact: true })
      .getByRole('link', { name: '내역', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: '일괄 편집 거래명' })).toHaveCount(1)
    await expect(page.getByRole('row').filter({ hasText: '개별 편집 거래명' })).toHaveCount(1)

    const { data: saved, error: savedError } = await createAdminClient()
      .from('transactions')
      .select('memo, raw_merchant')
      .eq('household_id', householdId)
      .order('memo')
    if (savedError) throw savedError
    expect(saved).toEqual([
      { memo: '개별 편집 거래명', raw_merchant: '수정 중인 거래' },
      { memo: '일괄 편집 거래명', raw_merchant: '반영할 거래' },
    ])
  } finally {
    await deleteTestState(email, householdId)
  }
})

for (const applyPath of ['single', 'bulk'] as const) {
  test(`untouched legacy title over 200 characters applies through ${applyPath}`, async ({ page }) => {
    const email = `finance-long-title-${applyPath}-${crypto.randomUUID()}@example.com`
    const password = 'passw0rd!'
    const merchant = `${applyPath === 'single' ? '개별' : '일괄'} 긴 원문 ${'가'.repeat(201)}`
    let householdId: string | undefined
    try {
      const setup = await createTestUser(email, password)
      householdId = setup.householdId
      const { error } = await createAdminClient().from('import_inbox').insert({
        household_id: householdId,
        import_uid: crypto.randomUUID(),
        owner: 'DJ',
        date: '2026-08-12',
        merchant,
        amount: 6100,
        flow: 'expense',
        account_id: setup.accountId,
        confidence: applyPath === 'bulk' ? 'high' : 'review',
      })
      if (error) throw error

      await loginAs(page, email, password)
      await page.goto('/inbox')
      await page.getByRole('button', { name: '모든 그룹 펼치기' }).click()
      const row = inboxRowBySourceTitle(page, merchant)
      await expect(row).toHaveCount(1)
      await expect(row.getByRole('textbox', { name: `${merchant} 거래명` })).toHaveValue(merchant)

      if (applyPath === 'single') {
        await row.getByRole('button', { name: `${merchant} 바로 반영` }).click()
      } else {
        await row.getByRole('checkbox', { name: `${merchant} 선택` }).check()
        await expect(page.locator('input[name^="title_"]')).toHaveCount(0)
        await page.getByRole('button', { name: '선택 반영', exact: true }).first().click()
      }

      await expect(page.getByText('모든 대기 거래를 처리했습니다.')).toBeVisible()
      await page.getByRole('navigation', { name: '주 메뉴', exact: true })
        .getByRole('link', { name: '내역', exact: true }).click()
      await expect(page.getByRole('row').filter({ hasText: merchant })).toHaveCount(1)

      const { data: saved, error: savedError } = await createAdminClient()
        .from('transactions')
        .select('memo, raw_merchant')
        .eq('household_id', householdId)
        .eq('raw_merchant', merchant)
        .single()
      if (savedError) throw savedError
      expect(saved).toEqual({ memo: merchant, raw_merchant: merchant })
    } finally {
      await deleteTestState(email, householdId)
    }
  })
}

test('processing history shows its own rows and restores excluded items inline without ledger navigation', async ({ page }, testInfo) => {
  const email = `finance-history-${crypto.randomUUID()}@example.com`
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, 'passw0rd!')
    householdId = setup.householdId
    const { error } = await createAdminClient().from('import_inbox').insert([
      { merchant: '반영 완료 기록', status: 'done' },
      { merchant: '제외 기록 하나', status: 'dismissed' },
      { merchant: '제외 기록 둘', status: 'dismissed' },
      { merchant: '대기 기록', status: 'pending' },
    ].map((row) => ({ ...row, household_id: householdId, import_uid: crypto.randomUUID(), owner: 'DJ',
      date: '2026-08-12', amount: 5000, flow: 'expense', account_id: setup.accountId,
      bs_cat1: '__source:card:samsung', created_at: '2026-09-02T15:00:00Z',
    })))
    if (error) throw error
    await loginAs(page, email, 'passw0rd!')
    await page.goto('/inbox?tab=history')
    await page.getByRole('button', { name: '거래 보기', exact: true }).click()
    const details = page.getByRole('region', { name: '가져온 항목' })
    await expect(details.getByText('반영 완료 기록', { exact: true })).toBeVisible()
    await expect(details.getByText('대기 기록', { exact: true })).toBeVisible()
    await details.getByRole('button', { name: '전체', exact: true }).click()
    await expect(details.getByText('대기 기록', { exact: true })).toBeVisible()
    await expect(details.getByRole('checkbox', { checked: true })).toHaveCount(0)
    await details.getByRole('button', { name: '선택 제외', exact: true }).click()
    await expect(details.getByText('반영 완료 기록', { exact: true })).toHaveCount(0)
    await expect(details.getByText('제외 기록 하나', { exact: true })).toBeVisible()
    await watchMutationFeedback(page)
    await details.getByRole('button', { name: '제외 기록 하나 검토 대기로 보내기', exact: true }).click()
    await expect(details.getByRole('status')).toContainText('1건을 검토 대기로')
    await expect(details.getByText('제외 기록 하나', { exact: true })).toHaveCount(0)
    await details.getByRole('checkbox', { name: '제외 기록 둘 복원 선택', exact: true }).check()
    await details.getByRole('button', { name: '선택 항목 검토 대기로 보내기', exact: true }).click()
    await expect(details.getByText('이 상태의 항목이 없습니다.')).toBeVisible()
    await details.getByRole('button', { name: '검토 대기', exact: true }).click()
    await expect(details.getByText('제외 기록 하나', { exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '가져오기 작업' })).toContainText('검토 대기3')
    await expect(page).toHaveURL('/inbox?tab=history')
    await expectNoPageFlash(page)
    await page.screenshot({ path: testInfo.outputPath('history-desktop.png'), fullPage: true })
    for (const width of [640, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath('history-mobile.png'), fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: '거래 보기', exact: true }).click()
    await expect(page.getByRole('region', { name: '가져온 항목' }).getByText('제외 기록 둘', { exact: true })).toBeVisible()
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('history filter changes abort obsolete reads and ignore late data after filter changes or closing', async ({ page }) => {
  const email = `finance-history-read-${crypto.randomUUID()}@example.com`
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, 'passw0rd!')
    householdId = setup.householdId
    const { error } = await createAdminClient().from('import_inbox').insert({
      household_id: householdId, import_uid: crypto.randomUUID(), owner: 'DJ', date: '2026-08-12',
      merchant: '조회 경계 기록', status: 'pending', amount: 5000, flow: 'expense',
      account_id: setup.accountId, bs_cat1: '__source:card:samsung', created_at: '2026-09-02T15:00:00Z',
    })
    if (error) throw error
    await loginAs(page, email, 'passw0rd!')
    await page.goto('/inbox?tab=history')
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window)
      const reads: Array<{ status: string; signal: AbortSignal; cache?: RequestCache; release: () => void }> = []
      Reflect.set(window, 'historyReads', reads)
      window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin)
        if (url.pathname !== '/api/inbox/history') return originalFetch(input, init)
        const status = url.searchParams.get('status')!
        // Deliberately deliver even aborted requests to exercise the component's stale-result guard.
        return new Promise<Response>((resolve) => {
          reads.push({ status, signal: init!.signal as AbortSignal, cache: init?.cache, release: () => resolve(Response.json({
            data: { items: [{ id: 1, owner: 'DJ', date: '2026-08-12', merchant: `${status} 조회 결과`, amount: 5000,
              flow: 'expense', status: status === 'all' ? 'dismissed' : status, accountName: null,
              categoryMajor: null, categorySub: null, dupNote: null, canRestore: status === 'dismissed' }],
            total: 1, page: 1, pageSize: 50 },
          })) })
        })
      }
    })
    await page.getByRole('button', { name: '거래 보기', exact: true }).click()
    const details = page.getByRole('region', { name: '가져온 항목' })
    // The dev server's StrictMode may abort and repeat the mount read. Assert
    // live requests rather than treating that extra cancelled read as a failure.
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'historyReads').filter((read: { signal: AbortSignal }) => !read.signal.aborted).length)).toBe(1)
    const initialReads = await page.evaluate(() => Reflect.get(window, 'historyReads').length)
    await details.getByRole('button', { name: '검토 대기', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'historyReads').length)).toBe(initialReads + 1)
    expect(await page.evaluate(() => Reflect.get(window, 'historyReads').map((read: { signal: AbortSignal; cache: RequestCache }) => ({ aborted: read.signal.aborted, cache: read.cache })))).toEqual([
      ...Array.from({ length: initialReads }, () => ({ aborted: true, cache: 'no-store' })), { aborted: false, cache: 'no-store' },
    ])
    await page.evaluate(() => Reflect.get(window, 'historyReads').at(-1).release())
    await expect(details.getByText('pending 조회 결과', { exact: true })).toBeVisible()
    await page.evaluate(async () => {
      Reflect.get(window, 'historyReads').slice(0, -1).forEach((read: { release: () => void }) => read.release())
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    await expect(details).toHaveAttribute('aria-busy', 'false')
    await expect(details.getByText('pending 조회 결과', { exact: true })).toBeVisible()
    await expect(details.getByText('all 조회 결과', { exact: true })).toHaveCount(0)
    await details.getByRole('button', { name: '선택 제외', exact: true }).click()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'historyReads').length)).toBe(initialReads + 2)
    await page.getByRole('button', { name: '거래 접기', exact: true }).click()
    expect(await page.evaluate(() => Reflect.get(window, 'historyReads').at(-1).signal.aborted)).toBe(true)
    await page.evaluate(() => Reflect.get(window, 'historyReads').at(-1).release())
    await expect(details).toHaveCount(0)
  } finally {
    await deleteTestState(email, householdId)
  }
})

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
    const admin = createAdminClient()
    const { data: secondCard, error: secondCardError } = await admin
      .from('accounts')
      .insert({
        household_id: householdId,
        name: 'DJ 삼성 제휴카드',
        owner: 'DJ',
        type: 'card',
        active: true,
      })
      .select('id')
      .single()
    if (secondCardError) throw secondCardError
    await loginAs(page, email, password)

    const statementPath = testInfo.outputPath('samsung-card-statement.xls')
    await writeFile(statementPath, `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <table>
        <tr><th>이용일</th><th>가맹점</th><th>이용금액</th></tr>
        <tr><td>${transactionDate.replaceAll('-', '.')}</td><td>${merchant}</td><td>5,000</td></tr>
      </table>
    </body></html>`, 'utf8')

    // 가져오기 opens on 검토 대기 once anything is pending, so the upload tab
    // is addressed directly.
    await page.goto('/inbox?tab=upload')
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('samsung')
    await page.locator('select[name="owner"]').selectOption('DJ')
    const defaultCard = page.getByRole('combobox', { name: '기본 카드', exact: true })
    await expect(defaultCard).toHaveValue('')
    await defaultCard.selectOption(String(secondCard.id))
    await page.locator('select[name="owner"]').selectOption('YJ')
    await expect(page.getByRole('link', { name: '결제수단 관리', exact: true }))
      .toHaveAttribute('href', '/manage?tab=accounts')
    await expect(page.getByRole('button', { name: '인박스로 불러오기' })).toBeDisabled()
    await page.locator('select[name="owner"]').selectOption('DJ')
    await expect(defaultCard).toHaveValue('')
    await defaultCard.selectOption(String(secondCard.id))
    const fileInput = page.locator('input[name="file"]')
    await fileInput.setInputFiles(statementPath)
    expect(await fileInput.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name))
      .toBe('samsung-card-statement.xls')
    await page.getByRole('button', { name: '인박스로 불러오기' }).click({ noWaitAfter: true })

    await expect(page.getByText(/인박스에 1건 추가/)).toBeVisible()
    await openCardReview(page, transactionDate, 'DJ 삼성 제휴카드')
    const inboxRow = inboxRowBySourceTitle(page, merchant)
    await expect(inboxRow).toHaveCount(1)
    await expect(inboxRow.getByRole('checkbox', { name: `${merchant} 선택` })).not.toBeChecked()
    await expect(inboxRow.getByRole('combobox', { name: `${merchant} 결제수단` }))
      .toHaveValue(String(secondCard.id))
    await page.getByRole('checkbox', { name: 'DJ 삼성 제휴카드 그룹 선택' }).check()
    await expect(inboxRow.getByRole('checkbox', { name: `${merchant} 선택` })).toBeChecked()
    await inboxRow.getByRole('combobox', { name: `${merchant} 카테고리` }).selectOption(String(setup.categoryId))
    await page.getByRole('button', { name: '선택 반영' }).first().click()

    await expect(page).toHaveURL('/inbox?tab=review')
    await expect(page.getByText(/1건을 가계부에 반영했습니다/)).toBeVisible()
    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '내역', exact: true }).click()
    const ledgerRow = page.getByRole('row').filter({ hasText: merchant })
    await expect(ledgerRow).toHaveCount(1)
    await expect(ledgerRow).toContainText('5,000원')
    await expect(ledgerRow).toContainText('식비')
    await expect(ledgerRow).toContainText('DJ 삼성 제휴카드')

    const { data: sourceRow, error: sourceError } = await admin
      .from('transactions')
      .select('source, raw_merchant')
      .eq('household_id', householdId)
      .eq('raw_merchant', merchant)
      .single()
    if (sourceError) throw sourceError
    expect(sourceRow).toEqual({ source: 'card:samsung', raw_merchant: merchant })

    const repeatStatementPath = testInfo.outputPath('samsung-card-statement-repeat.xls')
    await writeFile(repeatStatementPath, `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <table>
        <tr><th>이용일</th><th>가맹점</th><th>이용금액</th></tr>
        <tr><td>${transactionDate.replaceAll('-', '.')}</td><td>${merchant}</td><td>5,100</td></tr>
      </table>
    </body></html>`, 'utf8')

    await page.goto('/inbox?tab=upload')
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('samsung')
    await page.locator('select[name="owner"]').selectOption('DJ')
    await page.getByRole('combobox', { name: '기본 카드', exact: true })
      .selectOption(String(secondCard.id))
    await page.locator('input[name="file"]').setInputFiles(repeatStatementPath)
    await page.getByRole('button', { name: '인박스로 불러오기' }).click({ noWaitAfter: true })

    await expect(page.getByText(/자동 분류 1건/).first()).toBeVisible()
    await openCardReview(page, transactionDate, 'DJ 삼성 제휴카드')
    const repeatRow = inboxRowBySourceTitle(page, merchant)
    await expect(repeatRow.getByText('자동 분류')).toBeVisible()
    await repeatRow.getByRole('button', { name: `${merchant} 바로 반영` }).click()
    await expect(page.getByText('모든 대기 거래를 처리했습니다.')).toBeVisible()

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '내역', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: merchant })).toHaveCount(2)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('Shinhan billing headers upload through the real route into review without benefit duplicates', async ({ page }) => {
  const email = `finance-shinhan-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, password)
    householdId = setup.householdId
    const admin = createAdminClient()
    const { data: card, error: cardError } = await admin.from('accounts').insert({
      household_id: householdId, name: 'YJ 신한카드', owner: 'YJ', type: 'card', active: true,
    }).select('id').single()
    if (cardError) throw cardError
    await loginAs(page, email, password)
    await page.goto('/inbox?tab=upload')
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('shinhan')
    await page.locator('select[name="owner"]').selectOption('YJ')
    await page.locator('input[name="file"]').setInputFiles({
      name: '신한 테스트 이용대금명세서.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(SHINHAN_STATEMENT_HTML),
    })
    await page.getByRole('button', { name: '인박스로 불러오기', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '거래 파일 처리 진행' })
    await expect(dialog.getByText(/인박스에 4건 추가/)).toBeVisible()
    const { data: rows, error } = await admin.from('import_inbox').select('amount, status, account_id')
      .eq('household_id', householdId).order('id')
    if (error) throw error
    expect(rows).toEqual([
      { amount: 6500, status: 'pending', account_id: card.id },
      { amount: 20000, status: 'pending', account_id: card.id },
      { amount: -2000, status: 'pending', account_id: card.id },
      { amount: -5000, status: 'pending', account_id: card.id },
    ])
    await dialog.getByRole('button', { name: '검토 대기 보기', exact: true }).click()
    await expect(page).toHaveURL('/inbox?tab=review')
    await expect(page.getByRole('navigation', { name: '가져오기 작업' })).toContainText('검토 대기4')
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('Hyundai HTML upload retries a password without losing its file and never stores the password', async ({ page }) => {
  test.slow()
  const email = `finance-hyundai-${crypto.randomUUID()}@example.com`
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, 'passw0rd!')
    householdId = setup.householdId
    const admin = createAdminClient()
    const { error } = await admin.from('accounts').update({ name: 'DJ 현대카드' }).eq('household_id', householdId).eq('id', setup.accountId)
    if (error) throw error
    await loginAs(page, email, 'passw0rd!')
    await page.goto('/inbox?tab=upload')
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('hyundai')
    const fileInput = page.locator('input[name="file"]')
    await expect(fileInput).toHaveAttribute('accept', /\.html/)
    await fileInput.setInputFiles({ name: 'hyundai.html', mimeType: 'text/html', buffer: Buffer.from(secureHyundaiFixture()) })
    const password = page.getByLabel('보안 명세서 비밀번호', { exact: true })
    await password.fill('wrong-password')
    await page.getByRole('button', { name: '인박스로 불러오기' }).click()
    await expect(page.getByText(/비밀번호가 맞지 않거나/)).toBeVisible()
    await expect(password).toHaveValue('')
    expect(await fileInput.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe('hyundai.html')

    await page.getByRole('button', { name: '입력으로 돌아가기', exact: true }).click()
    await password.fill(HYUNDAI_TEST_PASSWORD)
    await page.getByRole('button', { name: '인박스로 불러오기' }).click()
    await expect(page.getByText(/인박스에 2건 추가/)).toBeVisible()
    await expect(password).toHaveValue('')
    const { data: rows, error: queryError } = await admin.from('import_inbox').select('*').eq('household_id', householdId)
    if (queryError) throw queryError
    expect(rows).toHaveLength(2)
    expect(rows?.every((row) => row.status === 'pending' && row.account_id === setup.accountId)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain(HYUNDAI_TEST_PASSWORD)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(HYUNDAI_TEST_PASSWORD)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('NH PDF upload retries its password, keeps the chosen card and stages signed principal', async ({ page }) => {
  test.slow()
  const email = `finance-nh-${crypto.randomUUID()}@example.com`
  let householdId: string | undefined
  try {
    const setup = await createTestUser(email, 'passw0rd!')
    householdId = setup.householdId
    const admin = createAdminClient()
    const { error } = await admin.from('accounts').update({ name: 'DJ 농협카드' }).eq('household_id', householdId).eq('id', setup.accountId)
    if (error) throw error
    const { data: secondCard, error: secondError } = await admin.from('accounts').insert({ household_id: householdId, name: 'DJ 농협 두번째카드', owner: 'DJ', type: 'card' }).select('id').single()
    if (secondError) throw secondError
    await loginAs(page, email, 'passw0rd!')
    await page.goto('/inbox?tab=upload')
    await page.getByRole('tab', { name: '카드사 명세서' }).click()
    await page.locator('select[name="issuer"]').selectOption('nonghyup')
    const card = page.getByRole('combobox', { name: '기본 카드', exact: true })
    await card.selectOption(String(secondCard.id))
    const fileInput = page.locator('input[name="file"]')
    await expect(fileInput).toHaveAttribute('accept', /\.pdf/)
    await fileInput.setInputFiles({ name: 'nh.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('synthetic selection only') })
    await expect(page.getByLabel('보안 명세서 비밀번호', { exact: true })).toHaveCount(0)
    await fileInput.setInputFiles({ name: 'nh.pdf', mimeType: 'application/pdf', buffer: syntheticNhPdf({ encrypted: true }) })
    const password = page.getByLabel('보안 명세서 비밀번호', { exact: true })
    await password.fill('wrong-password')
    await page.getByRole('button', { name: '인박스로 불러오기' }).click()
    await expect(page.getByText(/비밀번호가 맞지 않습니다/)).toBeVisible()
    await expect(password).toHaveValue('')
    await expect(card).toHaveValue(String(secondCard.id))
    expect(await fileInput.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe('nh.pdf')
    await page.getByRole('button', { name: '입력으로 돌아가기', exact: true }).click()
    await password.fill(NH_TEST_PASSWORD)
    await page.getByRole('button', { name: '인박스로 불러오기' }).click()
    await expect(page.getByText(/인박스에 2건 추가/)).toBeVisible()
    await expect(password).toHaveValue('')
    const { data: rows, error: queryError } = await admin.from('import_inbox').select('*').eq('household_id', householdId).order('date')
    if (queryError) throw queryError
    expect(rows?.map((row) => [row.date, row.amount, row.account_id, row.status])).toEqual([
      ['2026-07-12', 12500, secondCard.id, 'pending'], ['2026-07-15', -2500, secondCard.id, 'pending'],
    ])
    expect(JSON.stringify(rows)).not.toContain(NH_TEST_PASSWORD)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(NH_TEST_PASSWORD)
  } finally {
    await deleteTestState(email, householdId)
  }
})

test('annual chart hover and selection show values, and cell exclusion updates the chart', async ({ page }) => {
  const email = `finance-parity-dashboard-${Date.now()}-${crypto.randomUUID()}@example.com`
  const password = 'passw0rd!'
  let householdId: string | undefined

  try {
    const setup = await createTestUser(email, password, { seedDashboard: true })
    householdId = setup.householdId
    await loginAs(page, email, password)

    await expect(page.getByRole('img', { name: '월별 수입과 지출 막대 차트' })).toBeVisible()

    await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('link', { name: '통계', exact: true }).click()
    await expect(page).toHaveURL((url) => url.pathname === '/report')
    await expect(page.getByRole('heading', { name: '연간 통계' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /앞으로 6개월/ })).toBeVisible()

    const detailSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: '달마다 어떻게 달랐나', exact: true }),
    })
    await expect(detailSection).toBeVisible()
    await expect(detailSection.getByLabel('월별 그래프와 항목별 표').getByText('전체 항목', { exact: true })).toBeVisible()
    await expect(detailSection.getByRole('button', { name: '▾ 식비', exact: true })).toBeVisible()
    const chart = detailSection.getByRole('img', { name: '누적 막대 월별 차트' }).locator('canvas')
    const bounds = await chart.boundingBox()
    if (!bounds) throw new Error('Monthly chart did not render')
    // Hidden axes and 12 equal columns: January is at the first column's center.
    const january = { x: bounds.width / 24, y: bounds.height / 2 }
    await chart.hover({ position: january })
    await expect(detailSection.getByText('월 합계 500,000원의', { exact: false })).toContainText('100.0%')
    await chart.click({ position: january })
    await expect(detailSection.getByText('식비 · 1월 선택', { exact: true })).toBeVisible()
    const subCell = detailSection.getByRole('button', { name: '식비 카페 1월 500,000원, 합계에서 제외', exact: true })
    await subCell.hover()
    await expect(page.getByRole('tooltip')).toContainText('Parity E2E 대시보드 마트')
    await expect(page.getByRole('tooltip')).toContainText('500,000')
    const januaryCell = detailSection.locator('button[aria-label^="식비 1월 "]').first()
    await expect(januaryCell).toHaveAccessibleName(/합계에서 제외/)
    await januaryCell.click()
    await expect(januaryCell).toHaveAttribute('aria-pressed', 'true')
    await expect(januaryCell).toHaveAccessibleName(/합계에 다시 포함/)
    await chart.hover({ position: january })
    await expect(detailSection.getByText('월 합계 0원의', { exact: false })).toContainText('0.0%')
    await januaryCell.click()
    await expect(januaryCell).toHaveAttribute('aria-pressed', 'false')
    await chart.hover({ position: january })
    await expect(detailSection.getByText('월 합계 500,000원의', { exact: false })).toContainText('100.0%')
    await detailSection.getByRole('button', { name: '선', exact: true }).click()
    const line = detailSection.getByRole('img', { name: '선 월별 차트' }).locator('canvas')
    const lineBounds = await line.boundingBox()
    if (!lineBounds) throw new Error('Monthly line chart did not render')
    // January is the known 500k maximum, so its line point is in the first column near the chart top.
    const januaryLine = { x: lineBounds.width / 24, y: lineBounds.height / 24 }
    await line.hover({ position: januaryLine })
    await expect(detailSection.getByText('월 합계 500,000원의', { exact: false })).toContainText('100.0%')
    await detailSection.getByRole('button', { name: '100% 누적 영역', exact: true }).click()
    const area = detailSection.getByRole('img', { name: '100% 누적 영역 월별 차트' }).locator('canvas')
    // Area hits require painted fill, not the old nearest-point fallback in
    // the margin to the left of January's center. Move inside the Jan-Feb band.
    await expect(async () => {
      await area.hover({ position: { x: lineBounds.width * 0.75 / 12, y: lineBounds.height / 2 } })
      await expect(detailSection.getByText('월 합계 500,000원의', { exact: false })).toContainText('100.0%', { timeout: 200 })
    }).toPass({ timeout: 5000 })
    await detailSection.getByRole('button', { name: '선택 해제', exact: true }).click()
    await expect(detailSection.getByLabel('월별 그래프와 항목별 표').getByText('전체 항목', { exact: true })).toBeVisible()
    await expect(detailSection.getByRole('button', { name: '▾ 식비', exact: true })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 520 })
    await detailSection.scrollIntoViewIfNeeded()
    const tableScroller = detailSection.getByLabel('월별 그래프와 항목별 표')
    await tableScroller.evaluate((element) => { element.scrollLeft = 150 })
    await expect.poll(() => tableScroller.evaluate((element) => element.scrollLeft)).toBe(150)
    await tableScroller.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const visibleMainCell = detailSection.getByRole('button', { name: '식비 2월 300,000원, 합계에서 제외', exact: true })
    await visibleMainCell.hover()
    const tableTooltip = page.getByRole('tooltip')
    await expect(tableTooltip).toContainText('식비 · 2월')
    const [cellBox, tooltipBox, viewport] = await Promise.all([
      visibleMainCell.boundingBox(), tableTooltip.boundingBox(), Promise.resolve(page.viewportSize()),
    ])
    if (!cellBox || !tooltipBox || !viewport) throw new Error('Expected a visible table cell tooltip')
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0)
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0)
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewport.width)
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewport.height)
    expect(Math.abs(tooltipBox.x - cellBox.x)).toBeLessThan(160)

    const visibleSubCell = detailSection.getByRole('button', { name: '식비 카페 2월 300,000원, 합계에서 제외', exact: true })
    await visibleSubCell.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const subPointerBox = await visibleSubCell.boundingBox()
    if (!subPointerBox) throw new Error('Expected a visible detailed transaction cell')
    const transactionResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/cell-tx' && url.searchParams.get('month') === '2'
    })
    await page.mouse.move(subPointerBox.x + (subPointerBox.width / 2), subPointerBox.y + (subPointerBox.height / 2))
    expect((await transactionResponse).status()).toBe(200)
    await expect(tableTooltip).toContainText('Parity E2E 대시보드 마트 2호점')
    const [subCellBox, detailedTooltipBox] = await Promise.all([visibleSubCell.boundingBox(), tableTooltip.boundingBox()])
    if (!subCellBox || !detailedTooltipBox) throw new Error('Expected a visible detailed transaction tooltip')
    expect(detailedTooltipBox.x).toBeGreaterThanOrEqual(0)
    expect(detailedTooltipBox.y).toBeGreaterThanOrEqual(0)
    expect(detailedTooltipBox.x + detailedTooltipBox.width).toBeLessThanOrEqual(viewport.width)
    expect(detailedTooltipBox.y + detailedTooltipBox.height).toBeLessThanOrEqual(viewport.height)
    expect(Math.abs(detailedTooltipBox.x - subCellBox.x)).toBeLessThan(160)
    await tableTooltip.getByRole('link', { name: '이 달 거래 보기 →', exact: true }).hover()
    await expect(tableTooltip).toBeVisible()
    await visibleSubCell.focus()
    await page.keyboard.press('Escape')
    await expect(tableTooltip).not.toBeVisible()
  } finally {
    await deleteTestState(email, householdId)
  }
})

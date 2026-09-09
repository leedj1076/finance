import { expect, test, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { closeFixtureMonths } from './close-fixture-months'

function shiftMonth(month: string, offset: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function fixtureCalendar(currentMonth: string) {
  const closeMonth = shiftMonth(currentMonth, -1)
  return {
    currentMonth,
    currentYear: Number(currentMonth.slice(0, 4)),
    currentMonthNumber: Number(currentMonth.slice(5, 7)),
    closeMonth,
    closeYear: Number(closeMonth.slice(0, 4)),
    closeMonthNumber: Number(closeMonth.slice(5, 7)),
    // Closed/open sparse roles always live in an already-ended year. Current
    // and future masks are verified separately in the real current year.
    sparseYear: Number(currentMonth.slice(0, 4)) - 1,
  }
}

const KST_TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
const {
  currentMonth: CURRENT_MONTH,
  currentYear: CURRENT_YEAR,
  currentMonthNumber: CURRENT_MONTH_NUMBER,
  closeMonth: CLOSE_MONTH,
  closeYear: CLOSE_YEAR,
  closeMonthNumber: CLOSE_MONTH_NUMBER,
  sparseYear: SPARSE_YEAR,
} = fixtureCalendar(KST_TODAY.slice(0, 7))

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

async function expectFitsViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('Expected a rendered element inside a fixed viewport')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
}

function rowForCell(cell: Locator) {
  return cell.locator('xpath=..')
}

function rowTotal(row: Locator) {
  return row.locator(':scope > div:nth-last-child(3)')
}

async function waitForCanvasAnimations(canvases: Locator) {
  expect(await canvases.count()).toBeGreaterThan(0)
  let previous = ''
  let stableSamples = 0
  await expect.poll(async () => {
    const current = await canvases.evaluateAll(elements => elements
      .map(element => (element as HTMLCanvasElement).toDataURL())
      .join('\n'))
    stableSamples = current === previous ? stableSamples + 1 : 0
    previous = current
    return stableSamples
  }, { intervals: [100, 100, 100, 100, 100], timeout: 5_000 }).toBeGreaterThanOrEqual(2)
}

async function captureAnnualStatistics(
  page: Page,
  path: string,
  axisMax: number,
  expectedBars: Array<{ month: number; value: number; color: 'blue' | 'ink' | 'faint' }>,
) {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Expected a fixed statistics viewport')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      .map(animation => animation.finished.catch(() => {})))
  })
  // Chromium's beyond-viewport capture can corrupt bar pixels while Chart.js
  // coordinates stay correct. Capture the normal page in a real full-height viewport.
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: viewport.width, height })
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height)
  await waitForCanvasAnimations(page.locator('canvas'))
  const chart = page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })
  const bounds = await chart.boundingBox()
  if (!bounds) throw new Error('Expected the annual chart in the statistics capture')
  const screenshot = await page.screenshot({ path, fullPage: true })
  await page.setViewportSize(viewport)
  // Verify the delivered PNG itself, independently of Chart.js element state.
  const geometry = await page.evaluate(async ({ png, bounds, colors }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bounds.width)
    canvas.height = Math.round(bounds.height)
    const context = canvas.getContext('2d')!
    context.drawImage(image, Math.round(bounds.x), Math.round(bounds.y), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const styles = getComputedStyle(document.documentElement)
    const rgb = (color: string) => {
      context.fillStyle = styles.getPropertyValue(`--finance-${color}`).trim()
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
    }
    const matches = (x: number, y: number, color: number[]) => {
      const offset = (y * canvas.width + x) * 4
      return color.every((value, channel) => Math.abs(data[offset + channel] - value) <= 2)
    }
    const track = rgb('track')
    const gridRows: number[] = []
    for (let y = 0; y < canvas.height - 20; y += 1) {
      let pixels = 0
      for (let x = 0; x < canvas.width; x += 1) if (matches(x, y, track)) pixels += 1
      if (pixels > canvas.width * 0.8) gridRows.push(y)
    }
    const top = Math.min(...gridRows)
    const bottom = Math.max(...gridRows)
    let plotLeft = 0
    while (plotLeft < canvas.width && !matches(plotLeft, top, track)) plotLeft += 1
    const bars = colors.map(color => {
      const fill = rgb(color)
      const groups: Array<{ left: number; right: number; top: number; bottom: number }> = []
      for (let x = plotLeft; x < canvas.width; x += 1) {
        const ys: number[] = []
        for (let y = top; y < bottom; y += 1) if (matches(x, y, fill)) ys.push(y)
        // Grid text, antialiasing and explicit zero bars are not nonzero bars.
        if (ys.length < 5) continue
        const previous = groups.at(-1)
        if (previous && previous.right === x - 1) {
          previous.right = x
          previous.top = Math.min(previous.top, ys[0])
          previous.bottom = Math.max(previous.bottom, ys.at(-1)!)
        } else {
          groups.push({ left: x, right: x, top: ys[0], bottom: ys.at(-1)! })
        }
      }
      return { color, groups }
    })
    return { width: canvas.width, plotLeft, plotHeight: bottom - top, bars }
  }, { png: screenshot.toString('base64'), bounds, colors: [...new Set(expectedBars.map(bar => bar.color))] })
  expect(geometry.plotHeight).toBeGreaterThan(150)
  for (const { color, groups } of geometry.bars) {
    const expected = expectedBars.filter(bar => bar.color === color)
    expect(groups, `${color} bar count in ${path}`).toHaveLength(expected.length)
    for (const [index, bar] of groups.entries()) {
      const fixture = expected[index]
      const center = ((bar.left + bar.right) / 2 - geometry.plotLeft) / (geometry.width - geometry.plotLeft)
      expect(Math.abs(center - (fixture.month - 0.5) / 12), `${fixture.month}월 ${color} position`).toBeLessThan(0.04)
      expect((bar.right - bar.left + 1) / geometry.width, `${fixture.month}월 ${color} width`).toBeGreaterThan(0.008)
      expect(Math.abs((bar.bottom - bar.top + 1) - fixture.value / axisMax * geometry.plotHeight), `${fixture.month}월 ${color} amount proportion`).toBeLessThan(3)
    }
  }
}

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
  const { data: account, error: accountError } = await admin.from('accounts').insert({ household_id: household, name: '생활 카드', owner: 'DJ', type: 'card', active: true }).select('id').single()
  if (accountError) throw accountError
  const rows = sparse ? [
    { date: `${SPARSE_YEAR}-01-15`, flow: 'expense', amount: 450, memo: '1월 커피', category_id: category.id, account_id: account.id },
    { date: `${SPARSE_YEAR}-01-20`, flow: 'expense', amount: -50, memo: '1월 환불', category_id: category.id, account_id: account.id },
    { date: `${SPARSE_YEAR}-02-15`, flow: 'expense', amount: 999, memo: '미마감 비용', category_id: category.id, account_id: account.id },
    { date: `${SPARSE_YEAR}-03-15`, flow: 'expense', amount: 200, memo: '3월 커피', category_id: category.id, account_id: account.id },
    { date: `${CURRENT_MONTH}-05`, flow: 'expense', amount: 300, memo: '이번 달 커피', category_id: category.id, account_id: account.id },
  ] : [
    { date: `${CLOSE_MONTH}-15`, flow: 'expense', amount: 42000, memo: '마감커피', category_id: category.id, account_id: account.id },
    { date: `${CLOSE_MONTH}-16`, flow: 'expense', amount: 58000, memo: '다른 비용', category_id: category.id, account_id: account.id },
    { date: `${CLOSE_MONTH}-17`, flow: 'income', amount: 500000, memo: '수입', category_id: null, account_id: account.id },
  ]
  const result = await admin.from('transactions').insert(rows.map(row => ({ ...row, household_id: household, source: 'e2e' })))
  if (result.error) throw result.error
  return { accountId: account.id as number, categoryId: category.id as number }
}

async function seedUnpostedRecurring(household: string, accountId: number, categoryId: number) {
  const result = await adminClient().from('recurring').insert({
    household_id: household,
    flow: 'expense',
    fixed: true,
    category_id: categoryId,
    memo: '마감 전 정기비용',
    amount: 1000,
    account_id: accountId,
    day: 5,
    active: true,
    sort_order: 1,
  })
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

suite('fixture calendar keeps January rollover and sparse/current roles in separate years', async () => {
  expect(fixtureCalendar('2027-01')).toEqual({
    currentMonth: '2027-01',
    currentYear: 2027,
    currentMonthNumber: 1,
    closeMonth: '2026-12',
    closeYear: 2026,
    closeMonthNumber: 12,
    sparseYear: 2026,
  })
  const january = fixtureCalendar('2027-01')
  expect(new Set([
    monthKey(january.sparseYear, 1),
    monthKey(january.sparseYear, 2),
    monthKey(january.sparseYear, 3),
    monthKey(january.sparseYear, 4),
    january.currentMonth,
  ]).size).toBe(5)
})

suite('filtered ledger closes the whole month, inline edits invalidate it without reload, and reclose restores statistics', async ({ page, household }, info) => {
  suite.slow()
  const setup = await seed(household)
  await page.goto('/dashboard')
  const dashboardHeading = page.getByRole('heading', { level: 1 })
  await expect(dashboardHeading).toContainText('홈')
  await expect(dashboardHeading).toContainText(`${CURRENT_YEAR}년 ${CURRENT_MONTH_NUMBER}월 · 진행 중`)
  await expectFitsViewport(page, dashboardHeading)
  const kpis = page.locator('main > section').first()
  await expect(kpis.locator('article')).toHaveCount(2)
  await expect(kpis).toContainText('목표대로 가고 있나')
  await expect(kpis).toContainText('이번 달 더 써도 되나')
  await expect(page.getByText('자산이 늘고 있나', { exact: true })).toHaveCount(0)
  await expect(page.getByText('순자산 추이', { exact: true })).toHaveCount(0)
  await expect(page.getByText('이번 달 돈의 흐름', { exact: true })).toHaveCount(0)
  const todos = page.getByRole('region', { name: '해야 할 일' })
  const closeTodo = todos.getByRole('link').first()
  await expect(closeTodo).toHaveAccessibleName(new RegExp(`${CLOSE_MONTH_NUMBER}월 마무리하기`))
  await expect(closeTodo).toContainText('미분류 1건 · 마감 전')

  await page.goto(`/report?year=${CLOSE_YEAR}`)
  await expect(page.getByRole('heading', { name: '마감한 월이 없습니다', exact: true })).toHaveCount(0)
  await expect(page.getByText(`마감 0개월 · 잠정 1개월 (${CLOSE_MONTH_NUMBER}월)`)).toBeVisible()
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: `${CLOSE_MONTH_NUMBER}월 미마감`, exact: true })).toBeVisible()
  await expect(page.getByText('잠정 · 마감 0개월').first()).toBeVisible()
  await expect(page.getByText('미마감 · 잠정', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  await expectFitsViewport(page, page.getByRole('heading', { level: 1 }))
  await expect(page.locator('main > section').first().locator('article')).toHaveCount(2)
  const mobileCloseTodo = page.getByRole('region', { name: '해야 할 일' }).getByRole('link').first()
  await expectFitsViewport(page, mobileCloseTodo)
  await mobileCloseTodo.click()
  await expect(page).toHaveURL(`/ledger?month=${CLOSE_MONTH}`)
  const wrapUp = page.getByRole('region', { name: `${CLOSE_MONTH_NUMBER}월 마무리` })
  await expect(wrapUp).toContainText('정리 2 / 3')
  await expect(wrapUp).toContainText('미분류 거래')
  await expect(wrapUp).toContainText('1건')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`내역${CLOSE_YEAR}년 ${CLOSE_MONTH_NUMBER}월 · 미마감 · 잠정`)
  await expectFitsViewport(page, page.getByRole('heading', { level: 1 }))
  await expectFitsViewport(page, wrapUp)

  await seedUnpostedRecurring(household, setup.accountId, setup.categoryId)
  await page.reload()
  await expect(page.getByRole('button', { name: '미반영 1건 반영', exact: true })).toHaveCount(1)
  await expect(page.getByRole('region', { name: `${CLOSE_MONTH_NUMBER}월 마무리` })).toContainText('정기거래 미반영')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await expectFitsViewport(page, page.getByRole('heading', { level: 1 }))
  await expectFitsViewport(page, page.getByRole('region', { name: `${CLOSE_MONTH_NUMBER}월 마무리` }))
  await page.goto(`/ledger?month=${CLOSE_MONTH}&q=마감커피`)
  const draft = page.locator('#transaction-form input[name="memo"]')
  await draft.fill('유지할 작성 중 입력')
  await page.getByRole('button', { name: `${CLOSE_MONTH} 월 마감`, exact: true }).click()
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
  await expect(page.getByRole('region', { name: `${CLOSE_MONTH_NUMBER}월 마무리` })).toHaveCount(0)
  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: new RegExp(`${CLOSE_MONTH_NUMBER}월 마무리하기`) })).toHaveCount(0)
  await page.goto(`/report?year=${CLOSE_YEAR}`)
  await expect(page.getByText('마감 1개월 · 잠정 0개월')).toBeVisible()
  await expect(page.getByText('확정').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: `${CLOSE_MONTH_NUMBER}월 마감`, exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })).toBeVisible()
  await page.goto(`/ledger?month=${CLOSE_MONTH}&q=마감커피`)
  await page.getByRole('row').filter({ hasText: '마감커피' }).click()
  const edit = page.getByRole('row').filter({ has: page.getByRole('button', { name: '거래 수정 저장' }) })
  await edit.getByRole('textbox', { name: '금액', exact: true }).fill('43000')
  const origin = await page.evaluate(() => performance.timeOrigin)
  await edit.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect(page.getByRole('region', { name: '월 마감 상태' })).toContainText('재확인 필요')
  await expect(page.getByRole('status').filter({ hasText: '마감이 해제' })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)
  await page.goto(`/report?year=${CLOSE_YEAR}`)
  await expect(page.getByRole('heading', { name: '마감한 월이 없습니다', exact: true })).toHaveCount(0)
  await expect(page.getByText(`마감 0개월 · 잠정 1개월 (${CLOSE_MONTH_NUMBER}월)`)).toBeVisible()
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: `${CLOSE_MONTH_NUMBER}월 재확인 필요`, exact: true })).toBeVisible()
  await expect(page.getByText('잠정 · 마감 0개월').first()).toBeVisible()
  await expect(page.getByText('미마감 · 잠정', { exact: true })).toBeVisible()
  const provisionalSection = page.locator('#category-detail')
  await provisionalSection.getByLabel('상세 항목 선택').selectOption({ label: '식비' })
  const provisionalRow = rowForCell(provisionalSection.getByRole('button', { name: '▾ 식비', exact: true }))
  const mutableProvisionalCell = provisionalRow.locator(':scope > button').nth(CLOSE_MONTH_NUMBER)
  await expect(rowTotal(provisionalRow)).toHaveText('101,000')
  await mutableProvisionalCell.click()
  await expect(rowTotal(provisionalRow)).toHaveText('0')
  await mutableProvisionalCell.click()
  await expect(rowTotal(provisionalRow)).toHaveText('101,000')
  await page.goto(`/ledger?month=${CLOSE_MONTH}`)
  await closeVisibleMonth(page, CLOSE_MONTH)
  await page.goto(`/report?year=${CLOSE_YEAR}`)
  await expect(page.getByText('마감 1개월 · 잠정 0개월')).toBeVisible()
  await expect(page.getByText('확정').first()).toBeVisible()
  await expect(page.getByRole('img', { name: '월별 수입 지출 저축 막대 차트' })).toBeVisible()
  await captureAnnualStatistics(page, info.outputPath('closed-statistics.png'), 600_000, [
    { month: CLOSE_MONTH_NUMBER, value: 500_000, color: 'blue' },
    { month: CLOSE_MONTH_NUMBER, value: 101_000, color: 'ink' },
  ])
})

suite('sparse closed months keep gaps in every chart and tooltip, while closed zero remains selectable', async ({ page, household }, info) => {
  suite.slow()
  await seed(household, true)
  const closedMonths = [`${SPARSE_YEAR}-01`, `${SPARSE_YEAR}-03`, `${SPARSE_YEAR}-04`]
  await closeFixtureMonths(adminClient(), household, closedMonths)
  const { data: ledgerMonths, error: ledgerError } = await adminClient()
    .from('ledger_months')
    .select('month,revision')
    .eq('household_id', household)
    .in('month', closedMonths)
  if (ledgerError) throw ledgerError
  const revisions = new Map(ledgerMonths.map(row => [row.month, Number(row.revision)]))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/report?year=${SPARSE_YEAR}`)
  const reportHeading = page.getByRole('heading', { level: 1 })
  await expect(reportHeading).toContainText(`연간 통계${SPARSE_YEAR}년 · 마감 3개월 · 잠정 1개월 (2월)`)
  await expectFitsViewport(page, reportHeading)
  const annualFlow = page.locator('section').filter({ has: page.getByRole('heading', { name: '수입 · 지출 · 저축', exact: true }) })
  await expectFitsViewport(page, annualFlow.getByText(/마감 3개월/).last())
  const provisionalLegend = annualFlow.getByText('미마감 · 잠정', { exact: true })
  await expect(provisionalLegend).toBeVisible()
  await expect(provisionalLegend.locator('i')).toHaveCSS('background-image', /repeating-linear-gradient/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  const section = page.locator('#category-detail')
  await section.getByLabel('상세 항목 선택').selectOption({ label: '식비' })
  await expect(section.getByRole('button', { name: '▾ 식비', exact: true })).toBeVisible()
  await section.getByRole('button', { name: '▾ 식비', exact: true }).click()
  await expect(section.getByRole('button', { name: '식비 카페 1월 400원, 합계에서 제외', exact: true })).toHaveCount(0)
  await section.getByRole('button', { name: '▸ 식비', exact: true }).click()

  const majorJanuary = section.getByRole('button', { name: '식비 1월 400원, 합계에서 제외', exact: true })
  const majorFebruary = section.getByRole('button', { name: '식비 2월 999원, 합계에서 제외', exact: true })
  const majorMarch = section.getByRole('button', { name: '식비 3월 200원, 합계에서 제외', exact: true })
  const majorApril = section.getByRole('button', { name: '식비 4월 0원, 합계에서 제외', exact: true })
  const subJanuary = section.getByRole('button', { name: '식비 카페 1월 400원, 합계에서 제외', exact: true })
  const subFebruary = section.getByRole('button', { name: '식비 카페 2월 999원, 합계에서 제외', exact: true })
  const subMarch = section.getByRole('button', { name: '식비 카페 3월 200원, 합계에서 제외', exact: true })
  const subApril = section.getByRole('button', { name: '식비 카페 4월 0원, 합계에서 제외', exact: true })

  for (const cell of [majorJanuary, subJanuary, majorMarch, subMarch, majorApril, subApril]) {
    await expect(cell).toBeEnabled()
    await expect(cell).toHaveClass(/text-finance-ink/)
    await expect(cell).not.toHaveClass(/italic/)
  }
  for (const cell of [majorFebruary, subFebruary]) {
    await expect(cell).toBeEnabled()
    await expect(cell).toHaveClass(/text-finance-faint/)
    await expect(cell).not.toHaveClass(/italic/)
  }
  await expect(majorApril).toHaveText('0')
  await expect(subApril).toHaveText('0')
  for (const prefix of ['식비', '식비 카페']) {
    for (let month = 5; month <= 12; month += 1) {
      const cell = section.getByRole('button', { name: `${prefix} ${month}월 기록 없음`, exact: true })
      await expect(cell).toBeDisabled()
      await expect(cell).toHaveText('–')
      await expect(cell).toHaveClass(/text-finance-faint/)
    }
  }

  const majorRow = rowForCell(section.getByRole('button', { name: '▾ 식비', exact: true }))
  const subRow = section.getByText('카페', { exact: true }).locator('..')
  await expect(rowTotal(majorRow)).toHaveText('600')
  await expect(rowTotal(subRow)).toHaveText('600')
  const majorSpark = majorRow.getByRole('img', { name: '식비 최근 추세', exact: true })
  const subSpark = subRow.getByRole('img', { name: '식비 카페 최근 추세', exact: true })
  await expect(majorSpark).toBeVisible()
  await expect(subSpark).toBeVisible()
  for (const spark of [majorSpark, subSpark]) {
    const points = await spark.locator('polyline').getAttribute('points')
    expect(points?.trim().split(/\s+/)).toHaveLength(4)
  }

  const topMonthGrid = section.locator('div.mb-2.grid').first()
  const tableHeader = section.getByText('항목', { exact: true }).locator('..')
  await expect(topMonthGrid.locator(':scope > div')).toHaveCount(14)
  await expect(tableHeader.locator(':scope > div')).toHaveCount(16)
  for (const month of [1, 6, 12]) {
    const chartLabel = await topMonthGrid.locator(':scope > div').nth(month).boundingBox()
    const tableLabel = await tableHeader.locator(':scope > div').nth(month).boundingBox()
    const valueCell = await majorRow.locator(':scope > button').nth(month).boundingBox()
    if (!chartLabel || !tableLabel || !valueCell) throw new Error(`Month ${month} alignment target did not render`)
    const chartCenter = chartLabel.x + chartLabel.width / 2
    expect(Math.abs(chartCenter - (tableLabel.x + tableLabel.width / 2))).toBeLessThan(1)
    expect(Math.abs(chartCenter - (valueCell.x + valueCell.width / 2))).toBeLessThan(1)
  }

  const popup = section.locator('.pointer-events-none.absolute.top-2')
  for (const kind of ['누적 막대', '선', '100% 누적 영역']) {
    await section.getByRole('button', { name: kind, exact: true }).click()
    const canvas = section.getByRole('img', { name: `${kind} 월별 차트`, exact: true }).locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    const bounds = (await canvas.boundingBox())!
    await canvas.hover({ position: { x: bounds.width * 1.5 / 12, y: bounds.height / 2 } })
    await expect(popup).toContainText('999')
    await expect(popup).toContainText('전월 대비 ▲ 599')
    await expect(popup.locator('span.border')).toHaveText('잠정')
    await section.getByRole('heading', { name: '달마다 어떻게 달랐나', exact: true }).hover()
    await expect(popup).not.toBeVisible()
  }
  await section.getByRole('button', { name: '선', exact: true }).click()
  const canvas = section.getByRole('img', { name: '선 월별 차트', exact: true }).locator('canvas')
  const bounds = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: bounds.width * 2.5 / 12, y: bounds.height / 2 } })
  await expect(popup).toContainText('200')
  await expect(popup).toContainText('전월 대비 ▼ 799')
  await expect(popup.locator('span.border')).toHaveText('잠정')
  await canvas.hover({ position: { x: bounds.width * 3.5 / 12, y: bounds.height / 2 } })
  await expect(popup).toContainText('전월 대비 ▼ 200')
  await expect(popup.locator('span.border')).toHaveText('확정')

  const mutableMajorFebruary = majorRow.locator(':scope > button').nth(2)
  const mutableSubFebruary = subRow.locator(':scope > button').nth(1)
  await mutableMajorFebruary.click()
  await expect(mutableMajorFebruary).toHaveAttribute('aria-pressed', 'true')
  await expect(rowTotal(majorRow)).toHaveText('600')
  await expect(section.getByText('제외된 셀 1개')).toBeVisible()
  await canvas.hover({ position: { x: bounds.width * 1.5 / 12, y: bounds.height / 2 } })
  await expect(popup).toContainText('0원')
  await mutableMajorFebruary.click()
  await expect(mutableMajorFebruary).toHaveAttribute('aria-pressed', 'false')
  await canvas.hover({ position: { x: bounds.width * 1.5 / 12, y: bounds.height / 2 } })
  await expect(popup).toContainText('999')

  const cellResponse = (month: number) => page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/cell-tx' && url.searchParams.get('month') === String(month)
  })
  let response = cellResponse(1)
  await subJanuary.focus()
  let responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('closed')
  expect(responseUrl.searchParams.get('revision')).toBe(String(revisions.get(`${SPARSE_YEAR}-01`)))
  await expect(page.getByRole('tooltip')).toContainText('1월 커피')
  await expect(page.getByRole('tooltip')).toContainText('1월 환불')
  await page.keyboard.press('Escape')

  await section.getByRole('button', { name: '선', exact: true }).focus()
  response = cellResponse(2)
  await subFebruary.focus()
  responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('live')
  expect(responseUrl.searchParams.has('revision')).toBe(false)
  await page.keyboard.press('Escape')

  await section.getByRole('button', { name: '선', exact: true }).focus()
  response = cellResponse(4)
  await subApril.focus()
  responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('closed')
  expect(responseUrl.searchParams.get('revision')).toBe(String(revisions.get(`${SPARSE_YEAR}-04`)))
  await expect(page.getByRole('tooltip')).toContainText('0건 · 0원')
  await page.keyboard.press('Escape')

  let absentRequests = 0
  const countAbsentRequest = (request: import('@playwright/test').Request) => {
    if (request.url().includes('/api/cell-tx?')) absentRequests += 1
  }
  page.on('request', countAbsentRequest)
  await section.getByRole('button', { name: '식비 카페 5월 기록 없음', exact: true }).hover()
  await page.waitForTimeout(250)
  page.off('request', countAbsentRequest)
  expect(absentRequests).toBe(0)
  await mutableSubFebruary.click()
  await expect(rowTotal(subRow)).toHaveText('600')
  await mutableSubFebruary.click()

  await section.getByRole('button', { name: '결제수단', exact: true }).click()
  await section.getByLabel('상세 항목 선택').selectOption({ label: '생활 카드' })
  const accountJanuary = section.getByRole('button', { name: '생활 카드 1월 400원, 합계에서 제외', exact: true })
  const accountFebruary = section.getByRole('button', { name: '생활 카드 2월 999원, 합계에서 제외', exact: true })
  const accountApril = section.getByRole('button', { name: '생활 카드 4월 0원, 합계에서 제외', exact: true })
  await expect(accountJanuary).toHaveClass(/text-finance-ink/)
  await expect(accountFebruary).toHaveClass(/text-finance-faint/)
  await expect(accountApril).toHaveText('0')
  await expect(accountApril).toBeEnabled()
  for (let month = 5; month <= 12; month += 1) {
    await expect(section.getByRole('button', { name: `생활 카드 ${month}월 기록 없음`, exact: true })).toBeDisabled()
  }
  const accountRow = rowForCell(section.getByRole('button', { name: '생활 카드', exact: true }))
  const mutableAccountFebruary = accountRow.locator(':scope > button').nth(2)
  await expect(rowTotal(accountRow)).toHaveText('600')
  await mutableAccountFebruary.click()
  await expect(rowTotal(accountRow)).toHaveText('600')
  await mutableAccountFebruary.click()

  await section.getByRole('button', { name: '카테고리', exact: true }).click()
  await section.getByLabel('상세 항목 선택').selectOption({ label: '식비' })
  await section.getByRole('button', { name: '선', exact: true }).click()
  // March has not been fetched/cached yet; invalidate it behind the current report.
  const update = await adminClient().from('transactions').update({ amount: 250 }).eq('household_id', household).eq('date', `${SPARSE_YEAR}-03-15`)
  if (update.error) throw update.error
  const staleResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/cell-tx' && url.searchParams.get('month') === '3' && response.status() === 409
  })
  await subMarch.focus()
  await staleResponse
  await expect(section.getByRole('alert')).toContainText('마감 상태 또는 내역이 바뀌었습니다')
  await expect(page.getByRole('tooltip')).not.toBeVisible()
  await captureAnnualStatistics(page, info.outputPath('sparse-closed-months.png'), 1_000, [
    { month: 1, value: 400, color: 'ink' },
    { month: 3, value: 200, color: 'ink' },
    { month: 2, value: 999, color: 'faint' },
  ])

  // Refresh this mounted chart, rather than navigating/remounting it: February
  // becomes eligible while March is reopened, and the selected row must survive.
  await closeFixtureMonths(adminClient(), household, [`${SPARSE_YEAR}-02`])
  const origin = await page.evaluate(() => performance.timeOrigin)
  await section.getByRole('button', { name: '최신 통계 확인', exact: true }).click()
  await expect(section.getByRole('button', { name: '식비 2월 999원, 합계에서 제외', exact: true })).toBeVisible()
  const refreshedMarch = section.getByRole('button', { name: '식비 3월 250원, 합계에서 제외', exact: true })
  await expect(refreshedMarch).toBeEnabled()
  await expect(section.getByRole('button', { name: '식비 카페 3월 250원, 합계에서 제외', exact: true })).toBeEnabled()
  await expect(section.getByText('식비 · 항목 선택', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin)

  await section.getByRole('button', { name: '선', exact: true }).focus()
  response = cellResponse(3)
  await section.getByRole('button', { name: '식비 카페 3월 250원, 합계에서 제외', exact: true }).focus()
  responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('live')
  expect(responseUrl.searchParams.has('revision')).toBe(false)
  await expect(page.getByRole('tooltip')).toContainText('250원')
  await page.keyboard.press('Escape')

  await section.getByRole('button', { name: '선', exact: true }).focus()
  response = cellResponse(1)
  await section.getByRole('button', { name: '식비 카페 1월 400원, 합계에서 제외', exact: true }).focus()
  responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('closed')
  expect(responseUrl.searchParams.get('revision')).toBe(String(revisions.get(`${SPARSE_YEAR}-01`)))
  await page.keyboard.press('Escape')

  const refreshedBounds = (await canvas.boundingBox())!
  await canvas.hover({ position: { x: refreshedBounds.width * 1.5 / 12, y: refreshedBounds.height / 2 } })
  await expect(popup).toContainText('999')
  await expect(popup.locator('span.border')).toHaveText('확정')
  await canvas.hover({ position: { x: refreshedBounds.width * 2.5 / 12, y: refreshedBounds.height / 2 } })
  await expect(popup).toContainText('250')
  await expect(popup).toContainText('전월 대비 ▼ 749')
  await expect(popup.locator('span.border')).toHaveText('잠정')

  // Current/future roles live in the real current year, separate from the
  // already-ended sparse snapshot year above. This remains valid in January.
  await page.goto(`/report?year=${CURRENT_YEAR}`)
  const currentSection = page.locator('#category-detail')
  await currentSection.getByLabel('상세 항목 선택').selectOption({ label: '식비' })
  const currentMajor = currentSection.getByRole('button', { name: `식비 ${CURRENT_MONTH_NUMBER}월 300원, 합계에서 제외`, exact: true })
  const currentSub = currentSection.getByRole('button', { name: `식비 카페 ${CURRENT_MONTH_NUMBER}월 300원, 합계에서 제외`, exact: true })
  for (const cell of [currentMajor, currentSub]) {
    await expect(cell).toBeEnabled()
    await expect(cell).toHaveClass(/text-finance-faint/)
    await expect(cell).toHaveClass(/italic/)
  }
  for (const prefix of ['식비', '식비 카페']) {
    for (let month = 1; month < CURRENT_MONTH_NUMBER; month += 1) {
      const cell = currentSection.getByRole('button', { name: `${prefix} ${month}월 기록 없음`, exact: true })
      await expect(cell).toBeDisabled()
      await expect(cell).toHaveText('–')
    }
    for (let month = CURRENT_MONTH_NUMBER + 1; month <= 12; month += 1) {
      const cell = currentSection.getByRole('button', { name: `${prefix} ${month}월 예정`, exact: true })
      await expect(cell).toBeDisabled()
      await expect(cell).toHaveText('—')
    }
  }

  response = cellResponse(CURRENT_MONTH_NUMBER)
  await currentSub.focus()
  responseUrl = new URL((await response).url())
  expect(responseUrl.searchParams.get('scope')).toBe('live')
  expect(responseUrl.searchParams.has('revision')).toBe(false)
  await page.keyboard.press('Escape')

  const currentMajorRow = rowForCell(currentSection.getByRole('button', { name: '▾ 식비', exact: true }))
  const mutableCurrentMajor = currentMajorRow.locator(':scope > button').nth(CURRENT_MONTH_NUMBER)
  await expect(rowTotal(currentMajorRow)).toHaveText('0')
  await mutableCurrentMajor.click()
  await expect(rowTotal(currentMajorRow)).toHaveText('0')
  await mutableCurrentMajor.click()

  await currentSection.getByRole('button', { name: '선', exact: true }).click()
  const currentCanvas = currentSection.getByRole('img', { name: '선 월별 차트', exact: true }).locator('canvas')
  const currentBounds = (await currentCanvas.boundingBox())!
  await currentCanvas.hover({ position: { x: currentBounds.width * (CURRENT_MONTH_NUMBER - 0.5) / 12, y: currentBounds.height / 2 } })
  const currentPopup = currentSection.locator('.pointer-events-none.absolute.top-2')
  await expect(currentPopup).toContainText('300')
  await expect(currentPopup).toContainText('전월 대비 –')
  await expect(currentPopup.locator('span.border')).toHaveCount(0)

  await currentSection.getByRole('button', { name: '결제수단', exact: true }).click()
  await currentSection.getByLabel('상세 항목 선택').selectOption({ label: '생활 카드' })
  const currentAccount = currentSection.getByRole('button', { name: `생활 카드 ${CURRENT_MONTH_NUMBER}월 300원, 합계에서 제외`, exact: true })
  await expect(currentAccount).toHaveClass(/text-finance-faint/)
  await expect(currentAccount).toHaveClass(/italic/)
  for (let month = 1; month < CURRENT_MONTH_NUMBER; month += 1) {
    await expect(currentSection.getByRole('button', { name: `생활 카드 ${month}월 기록 없음`, exact: true })).toBeDisabled()
  }
  for (let month = CURRENT_MONTH_NUMBER + 1; month <= 12; month += 1) {
    await expect(currentSection.getByRole('button', { name: `생활 카드 ${month}월 예정`, exact: true })).toHaveText('—')
  }
  const currentAccountRow = rowForCell(currentSection.getByRole('button', { name: '생활 카드', exact: true }))
  const mutableCurrentAccount = currentAccountRow.locator(':scope > button').nth(CURRENT_MONTH_NUMBER)
  await expect(rowTotal(currentAccountRow)).toHaveText('0')
  await mutableCurrentAccount.click()
  await expect(rowTotal(currentAccountRow)).toHaveText('0')
  await mutableCurrentAccount.click()
})

suite('current month is restricted and empty ended months require explicit consent in mobile dark mode', async ({ page, household }, info) => {
  void household
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`/ledger?month=${CURRENT_MONTH}`)
  await page.getByRole('button', { name: `${CURRENT_MONTH} 월 마감`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('끝난 월만 마감')
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: `${CURRENT_MONTH} 월 마감`, exact: true })).toBeFocused()
  const emptyMonth = shiftMonth(CURRENT_MONTH, -2)
  await page.goto(`/ledger?month=${emptyMonth}`)
  await page.getByRole('button', { name: `${emptyMonth} 월 마감`, exact: true }).click()
  await expect(dialog).toContainText('전체 거래 0건')
  await expect(dialog.getByRole('button', { name: '월 전체 마감', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: '거래 없는 월로 마감합니다.' }).check()
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('empty-month-dialog-dark-mobile.png') })
  await dialog.getByRole('button', { name: '월 전체 마감', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: `${emptyMonth} 마감 확인 · 해제`, exact: true }).click()
  await dialog.getByRole('button', { name: '마감 해제', exact: true }).click()
  await expect(page.getByRole('region', { name: '월 마감 상태' })).toContainText('재확인 필요')
})

suite('a stale confirmation reloads totals and clears consent; new inbox-only rows leave the month closed with a notice', async ({ page, household }) => {
  await seed(household)
  await page.goto(`/ledger?month=${CLOSE_MONTH}`)
  await page.getByRole('button', { name: `${CLOSE_MONTH} 월 마감`, exact: true }).click()
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
  const queued = await adminClient().from('import_inbox').insert({ household_id: household, import_uid: crypto.randomUUID(), date: `${CLOSE_MONTH}-19`, amount: 100, flow: 'expense', owner: 'DJ', merchant: '추가 검토', status: 'pending' })
  if (queued.error) throw queued.error
  await page.reload()
  const status = page.getByRole('region', { name: '월 마감 상태' })
  await expect(status).toContainText(`${CLOSE_MONTH} · 마감`)
  await expect(status).toContainText('이 달 가져오기 대기 1건')
  await page.goto(`/report?year=${CLOSE_YEAR}`)
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: `${CLOSE_MONTH_NUMBER}월 마감`, exact: true })).toBeVisible()
})

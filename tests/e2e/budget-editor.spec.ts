import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { evaluateBudget } from '../../src/features/budget-recommendations/calculations'
import type { BudgetRecommendationData } from '../../src/features/budget-recommendations/types'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'
import { buildBudgetBrowser, type BudgetBrowserBundle } from './fixtures/budget-editor-browser'
import type {} from './fixtures/budget-save-lifecycle'

const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
test.use({ hasTouch: true })
const nextJobId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let bundle: BudgetBrowserBundle
let data: BudgetRecommendationData
let gets: number
let posts: Record<string, unknown>[]
let release: (() => void) | undefined
let afterGet: ((count: number) => Promise<BudgetRecommendationData>) | undefined
let afterPost: (() => Promise<BudgetRecommendationData>) | undefined
let cellRequests: string[] = []
let cellStatus = 200
let cellDelay = 0

function completed(amount = 300_000, id = jobId): BudgetRecommendationData {
  const snapshot = makeBudgetSnapshot()
  snapshot.month = snapshot.input.month = snapshot.budgetState.month = '2026-10'
  const report = makeBudgetReport()
  report.rows[0].amount = amount
  return { month: '2026-10', latestJob: { id, status: 'completed', errorCode: null },
    completed: { id, completedAt: '2026-09-10T00:00:00Z', snapshot, promptInput: null, report,
      evaluation: evaluateBudget(snapshot, report.rows) },
    worker: 'ready', availability: 'available', freshness: 'current', instructionsChanged: false }
}
function item(page: Page, major = '식비') {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: major, exact: true }) })
}
const trendCell = (page: Page, month: string, major = '식비') =>
  item(page, major).getByRole('button', { name: new RegExp(`^${major} ${month} `) })
const popover = (page: Page) => page.getByRole('tooltip')
const reference = (page: Page, label: string, major = '식비') => item(page, major).getByRole('button', { name: new RegExp('^' + label + ' ') })
const requestDialog = (page: Page) => page.getByRole('dialog', { name: 'AI 예산 추천 요청', exact: true })
async function boot(page: Page, options: { delayed?: boolean; empty?: boolean; stale?: boolean } = {}) {
  data = completed()
  if (options.empty) data = { ...data, latestJob: null, completed: null }
  if (options.stale) data.freshness = 'source_changed'
  gets = 0; posts = []; release = undefined; afterGet = undefined; afterPost = undefined
  cellRequests = []; cellStatus = 200; cellDelay = 0
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/cell-tx') {
      cellRequests.push(url.search)
      if (cellDelay > 0) await new Promise(resolve => setTimeout(resolve, cellDelay))
      if (cellStatus === 409) return route.fulfill({ status: 409, json: { error: '마감 내역이 바뀌었습니다.', refresh: true } })
      return route.fulfill({ json: {
        major: url.searchParams.get('major'),
        sub: url.searchParams.get('sub'),
        ym: `${url.searchParams.get('year')}-${String(url.searchParams.get('month')).padStart(2, '0')}`,
        total: 811_161,
        items: [
          { date: '2026-06-21', name: '코스트코코리아', amount: 196_610, acct: 'DJ 현대' },
          { date: '2026-06-11', name: '쿠팡', amount: 133_140, acct: 'DJ 국민' },
        ],
      } })
    }
    if (url.pathname === '/api/budget-recommendations') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        posts.push(body)
        if (afterPost) return route.fulfill({ json: await afterPost() }).catch(() => {})
        data = { ...data, latestJob: { id: nextJobId, requestId: body.requestId, status: 'queued', errorCode: null } }
        return route.fulfill({ json: data })
      }
      gets += 1
      if (gets === 1 && options.delayed) await new Promise<void>(resolve => { release = resolve })
      const response = afterGet ? await afterGet(gets) : data
      return route.fulfill({ json: { ...response, month: url.searchParams.get('month') } }).catch(() => {})
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div></body></html>' })
  })
  await page.goto('http://localhost/?mode=editor')
  await page.addStyleTag({ content: bundle.css })
  await page.addScriptTag({ content: bundle.script })
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('300000')
  if (!options.delayed) await expect(page.getByRole('button', { name: options.empty ? 'AI 추천 받기' : '다시 추천', exact: true })).toBeEnabled()
}
test.beforeAll(async () => { bundle = await buildBudgetBrowser() })
test.afterAll(async () => { await bundle?.cleanup() })

test('saved AI evidence hydrates without reparsing its caption', async ({ page }) => {
  await page.route('http://localhost/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><head><meta charset="utf-8"></head><body><main><div id="root">${bundle.savedAiServerHtml}</div></main></body></html>`,
  }))
  await page.goto('http://localhost/?mode=saved-ai-hydration')
  await page.addScriptTag({ content: bundle.script })
  await expect(page.getByText('AI 추천 (9월 10일) 300,000에서 조정', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '근거', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '식비 AI 추천 근거', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.budgetHydrationErrors)).toEqual([])
})

test('reference to manual to save and reloaded first matching historical source', async ({ page }) => {
  await boot(page)
  await reference(page, '지난달 예산').click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('330000')
  await expect(reference(page, '지난달 예산')).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('식비 예산', { exact: true }).fill('320000')
  await expect(reference(page, '지난달 예산')).toHaveAttribute('aria-pressed', 'false')
  await expect(item(page).getByText('직접 입력', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  expect(await page.evaluate(() => window.budgetLifecycle.calls()[0].payload.changes)).toEqual([
    { major: '식비', amount: 320000, recommendationJobId: null, expectedVersion: 'food-v1' },
  ])
  await page.evaluate(() => window.budgetLifecycle.resolve(0))
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible()
  await page.evaluate(() => window.budgetLifecycle.reloadSaved())
  await expect(reference(page, '지난달 실적')).toHaveAttribute('aria-pressed', 'true')
})

test('dirty whole fill keeps edits and undo restores only the fill', async ({ page }) => {
  await boot(page)
  await page.getByLabel('식비 예산', { exact: true }).fill('600000')
  await page.locator('.plan-toolbar__fills').getByRole('button', { name: '지난달 실적', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '전체 채우기 확인', exact: true })
  await expect(confirmation).toContainText('식비 600,000 → 320,000')
  await confirmation.getByRole('button', { name: '고친 항목은 두기', exact: true }).click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('600000')
  await expect(page.getByLabel('교통 예산', { exact: true })).toHaveValue('85000')
  await page.getByRole('button', { name: '실행 취소', exact: true }).click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('600000')
  await expect(page.getByLabel('교통 예산', { exact: true })).toHaveValue('90000')
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toEqual([])
})

for (const backToSaved of [false, true]) {
  test(`delayed initial AI never selects after typing${backToSaved ? ' back to saved amount' : ''}`, async ({ page }) => {
    await boot(page, { delayed: true })
    await page.getByLabel('식비 예산', { exact: true }).fill('310000')
    if (backToSaved) await page.getByLabel('식비 예산', { exact: true }).fill('300000')
    release?.()
    await expect(reference(page, 'AI 추천')).toBeEnabled()
    await expect(reference(page, 'AI 추천')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue(backToSaved ? '300000' : '310000')
  })
}

test('checked AI applies the verified amount rather than the displayed snapshot', async ({ page }) => {
  await boot(page)
  afterGet = async () => completed(280_000)
  await reference(page, 'AI 추천').click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('280000')
  await expect(reference(page, 'AI 추천')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  expect(await page.evaluate(() => window.budgetLifecycle.calls()[0].payload.changes[0])).toMatchObject({ amount: 280000, recommendationJobId: jobId })
})

test('bulk confirmation rechecks freshness and cannot apply a stale response', async ({ page }) => {
  await boot(page)
  await page.getByLabel('식비 예산', { exact: true }).fill('310000')
  await page.locator('.plan-toolbar__fills').getByRole('button', { name: 'AI 추천', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '전체 채우기 확인', exact: true })
  await expect(confirmation).toBeVisible()
  afterGet = async () => ({ ...completed(), freshness: 'source_changed' })
  await confirmation.getByRole('button', { name: '모두 채우기', exact: true }).click()
  await expect(confirmation).toBeHidden()
  await expect(page.getByText('기록이 변경되어 재추천이 필요합니다.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')
  expect(gets).toBe(3)
})

test('AI dialog Enter requests only AI, waiting permits manual edits, and a new report never selects rows', async ({ page }) => {
  await boot(page, { empty: true })
  await page.getByRole('button', { name: 'AI 추천 받기', exact: true }).click()
  const dialog = requestDialog(page)
  await dialog.getByLabel('참고 메모', { exact: true }).fill('가족 식사')
  await dialog.getByLabel('예정 지출 메모', { exact: true }).press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page.getByText('추천 대기 중', { exact: true })).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0]).toMatchObject({ month: '2026-10', notes: '가족 식사' })
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toEqual([])
  await expect(reference(page, 'AI 추천')).toBeDisabled()
  await page.getByLabel('식비 예산', { exact: true }).fill('310000')
  const requestId = String(posts[0].requestId)
  data = completed(280_000, nextJobId)
  data.latestJob!.requestId = requestId
  data.completed!.requestId = requestId
  await expect(page.getByRole('button', { name: '다시 추천', exact: true })).toBeEnabled({ timeout: 10_000 })
  await expect(reference(page, 'AI 추천')).toContainText('280,000')
  await expect(reference(page, 'AI 추천')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')
})

test('old checked job response cannot apply after changing month', async ({ page }) => {
  await boot(page)
  afterGet = async () => {
    await new Promise<void>(resolve => { release = resolve })
    return completed(280_000)
  }
  await reference(page, 'AI 추천').click()
  await expect.poll(() => gets).toBe(2)
  afterGet = undefined
  data = { ...completed(), completed: null, latestJob: null }
  await page.evaluate(() => window.budgetLifecycle.mount('2026-11', false, true))
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('350000')
  release?.()
  await expect(page.getByLabel('식비 예산', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('350000')
})

test('a replacement server job during a delayed check never applies the old selection', async ({ page }) => {
  await boot(page)
  afterGet = async () => {
    await new Promise<void>(resolve => { release = resolve })
    return completed(280_000, nextJobId)
  }
  await reference(page, 'AI 추천').click()
  await expect.poll(() => gets).toBe(2)
  release?.()
  await expect(page.getByText('추천 결과를 안전하게 확인하지 못했습니다.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('300000')
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toEqual([])
})

test('month change cancels an in-flight request without taking over the new editor', async ({ page }) => {
  await boot(page)
  afterPost = async () => {
    await new Promise<void>(resolve => { release = resolve })
    return completed(280_000, nextJobId)
  }
  await page.getByRole('button', { name: '다시 추천', exact: true }).click()
  await requestDialog(page).getByLabel('참고 메모', { exact: true }).fill('old request')
  await requestDialog(page).getByRole('button', { name: '추천 요청', exact: true }).click()
  await expect.poll(() => posts.length).toBe(1)
  data = { ...data, completed: null, latestJob: null }
  await page.evaluate(() => window.budgetLifecycle.mount('2026-11', false, true))
  await expect(requestDialog(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'AI 추천 받기', exact: true })).toBeEnabled()
  release?.()
  await page.getByRole('button', { name: 'AI 추천 받기', exact: true }).click()
  await expect(requestDialog(page).getByLabel('참고 메모', { exact: true })).toHaveValue('')
  await expect(requestDialog(page).getByRole('button', { name: '추천 요청', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toEqual([])
})

test('month change discards open dialog input and restores native focus on Escape', async ({ page }) => {
  await boot(page)
  const trigger = page.getByRole('button', { name: '다시 추천', exact: true })
  await trigger.click()
  await requestDialog(page).getByLabel('참고 메모', { exact: true }).fill('old month input')
  data = { ...completed(), completed: null, latestJob: null }
  await page.evaluate(() => window.budgetLifecycle.mount('2026-11', false, true))
  await expect(requestDialog(page)).toBeHidden()
  const nextTrigger = page.getByRole('button', { name: 'AI 추천 받기', exact: true })
  await nextTrigger.click()
  await expect(requestDialog(page).getByLabel('참고 메모', { exact: true })).toHaveValue('')
  await requestDialog(page).press('Escape')
  await expect(requestDialog(page)).toBeHidden()
  await expect(nextTrigger).toBeFocused()
})

test('stale AI is disabled while positive historical references remain usable', async ({ page }) => {
  await boot(page, { stale: true })
  await expect(reference(page, 'AI 추천')).toBeDisabled()
  await expect(item(page).getByText('다시 추천 필요', { exact: true })).toBeVisible()
  await reference(page, '지난달 예산').click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('330000')
})

test('desktop captions stay directly below inputs for manual, adjusted AI and wrapping missing origins', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await boot(page)
  const nearInput = async (major: string) => {
    const row = item(page, major)
    const input = (await row.getByRole('spinbutton').boundingBox())!
    const caption = (await row.locator('.plan-item__caption').boundingBox())!
    expect(caption.y - input.y - input.height).toBeGreaterThanOrEqual(4)
    expect(caption.y - input.y - input.height).toBeLessThanOrEqual(6)
  }
  await nearInput('여행 · 경조사')
  await page.getByLabel('식비 예산', { exact: true }).fill('310000')
  await nearInput('식비')
  await page.getByLabel('주거 · 관리비와 가족 공동생활 고정 지출 예산', { exact: true }).fill('121000')
  await nearInput('주거 · 관리비와 가족 공동생활 고정 지출')
  data = { ...data, completed: null, latestJob: null }
  await page.evaluate(() => window.budgetLifecycle.mountMissingOrigin())
  await expect(item(page).getByText('이 추천의 근거를 확인할 수 없습니다', { exact: true })).toBeVisible()
  await nearInput('식비')
})

test('synthetic screenshots show source CSS, desktop target anchoring and 390 tap/menu controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await boot(page)
  const directory = path.join(process.cwd(), 'docs/design/budget-editor/result')
  await mkdir(directory, { recursive: true })
  for (const group of ['고정비', '변동비', '비정기']) await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible()
  await expect(reference(page, '지난달 예산', '여행 · 경조사')).toBeDisabled()
  await expect(page.getByText(/잠정/).first()).toBeVisible()
  await expect(item(page).locator('.plan-item__reason')).toHaveText('기록된 장보기 비용을 포함해 배정했습니다.')
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toContain('Apple SD Gothic Neo')
  expect(await page.locator('.ceiling-bar__mobile').isVisible()).toBe(false)
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeDisabled()
  await page.mouse.move(0, 0)
  await page.screenshot({ animations: 'disabled', path: path.join(directory, 'synthetic-desktop-1440.png'), fullPage: true })
  const target = page.getByRole('button', { name: '목표 저축률 30%', exact: true })
  await target.click()
  const popover = page.getByRole('dialog', { name: '목표 저축률 설정', exact: true })
  const anchor = (await target.boundingBox())!
  const box = (await popover.boundingBox())!
  expect(Math.abs(box.x - anchor.x)).toBeLessThanOrEqual(2)
  expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height)
  await page.mouse.move(0, 0)
  await page.screenshot({ animations: 'disabled', path: path.join(directory, 'synthetic-desktop-target-1440.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await reference(page, '지난달 예산').tap()
  await expect(reference(page, '지난달 예산')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '변경사항 저장', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.mouse.move(0, 0)
  await page.screenshot({ animations: 'disabled', path: path.join(directory, 'synthetic-mobile-390.png'), fullPage: true })
  await page.locator('.plan-toolbar__mobile-fill summary').click()
  await expect(page.locator('.plan-toolbar__mobile-menu')).toBeVisible()
  await page.mouse.move(0, 0)
  await page.screenshot({ animations: 'disabled', path: path.join(directory, 'synthetic-mobile-menu-390.png'), fullPage: true })
  await page.locator('.plan-toolbar__mobile-menu').getByRole('button', { name: '지난달 실적', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '전체 채우기 확인', exact: true })).toBeVisible()
})

test('hovering a trend cell opens its transactions and leaves the draft untouched', async ({ page }) => {
  await boot(page)
  const budget = page.getByLabel('식비 예산', { exact: true })
  await expect(budget).toHaveValue('300000')
  await expect(reference(page, 'AI 추천')).toHaveAttribute('aria-pressed', 'true')
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  await expect(popover(page)).toContainText('2건 · 811,161원')
  await expect(popover(page)).toContainText('코스트코코리아')
  await expect(budget).toHaveValue('300000')
  await expect(reference(page, 'AI 추천')).toHaveAttribute('aria-pressed', 'true')
  await expect(item(page).getByRole('button', { pressed: true })).toHaveCount(1)
})

test('the month that is also the previous-actual row is marked', async ({ page }) => {
  await boot(page)
  await expect(trendCell(page, '9월')).toContainText('9월 · 지난달')
  await expect(trendCell(page, '7월')).not.toContainText('지난달')
})

test('the trend request asks for the major without a sub', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  expect(cellRequests.some(search => search.includes('major=') && !search.includes('sub='))).toBe(true)
})

test('clicking a trend cell opens it and clicking again closes it', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').click()
  await expect(popover(page)).toBeVisible()
  await trendCell(page, '7월').click()
  await expect(popover(page)).toBeHidden()
})

test('keyboard focus opens the popover and Escape closes it', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').focus()
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover(page)).toBeHidden()
})

test('a stale closed month reports itself above the table and empties every row cache', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(popover(page)).toBeHidden()
  expect(cellRequests).toHaveLength(1)

  cellStatus = 409
  await trendCell(page, '7월', '교통').click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('마감 내역이 바뀌었습니다. 새로고침해 주세요.')
  await expect(alert.getByRole('button', { name: '최신 내역 확인', exact: true })).toBeVisible()
  await expect(popover(page)).toBeHidden()
  const notice = (await alert.boundingBox())!
  const header = (await page.locator('.plan-list__header').boundingBox())!
  expect(notice.y).toBeLessThan(header.y)

  // The 409 landed on 교통, and 식비's warm July entry has to go with it.
  cellStatus = 200
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  expect(cellRequests).toHaveLength(3)
})

test('a trend cell is tappable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await boot(page)
  await trendCell(page, '7월').tap()
  await expect(popover(page)).toBeVisible()
})

test('a popover anchored low in the viewport flips above the cell instead of running off it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await boot(page)
  const cell = trendCell(page, '8월', '여행 · 경조사')
  await cell.evaluate(element => element.scrollIntoView({ block: 'end' }))
  const box = (await cell.boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 120)

  await page.mouse.move(box.x + (box.width / 2), box.y + box.height - 2)
  await expect(popover(page)).toBeVisible()
  const card = (await popover(page).boundingBox())!
  expect(card.y).toBeGreaterThanOrEqual(0)
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.height)
  expect(card.x).toBeGreaterThanOrEqual(0)
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.width)
  expect(card.y + card.height).toBeLessThanOrEqual(box.y + box.height)
})

test('the pointer can leave the cell for the popover and reach the ledger link', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  const ledger = popover(page).getByRole('link', { name: '이 달 거래 보기 →' })
  await ledger.hover()
  await page.waitForTimeout(400)
  await expect(popover(page)).toBeVisible()
  await expect(ledger).toHaveAttribute('href', /^\/ledger\?month=2026-07&tab=list&flow=expense&major=/)
})

test('Tab from a focused trend cell lands on the ledger link', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').focus()
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(popover(page).getByRole('link', { name: '이 달 거래 보기 →' })).toBeFocused()
  await expect(popover(page)).toBeVisible()
})

test('clicking a cell whose transactions are already cached leaves the popover open', async ({ page }) => {
  await boot(page)
  const cell = trendCell(page, '7월')
  await cell.hover()
  await expect(popover(page)).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(popover(page)).toBeHidden()
  await cell.hover()
  await expect(popover(page)).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(popover(page)).toBeHidden()
  expect(cellRequests).toHaveLength(1)

  await cell.click()
  await page.waitForTimeout(400)
  await expect(popover(page)).toBeVisible()
  await expect(popover(page)).toContainText('코스트코코리아')
})

test('scrolling dismisses a popover the keyboard opened', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await boot(page)
  await trendCell(page, '7월').focus()
  await expect(popover(page)).toBeVisible()
  await page.evaluate(() => window.scrollBy(0, 200))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect(popover(page)).toBeHidden()
})

test('추이 labels the mobile line and stays with the column header on desktop', async ({ page }) => {
  await boot(page)
  const line = item(page).locator('.plan-trend')
  await expect(line.locator('.plan-trend__label')).toBeHidden()
  await expect(line.locator('.plan-trend__separator').first()).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(line.locator('.plan-trend__label')).toBeVisible()
  await expect(line.locator('.plan-trend__label')).toHaveText('추이')
  await expect(line.locator('.plan-trend__separator')).toHaveCount(2)
  await expect(line.locator('.plan-trend__separator').first()).toBeVisible()
})

test('the stale banner refresh keeps every unsaved amount', async ({ page }) => {
  await boot(page)
  const budget = page.getByLabel('식비 예산', { exact: true })
  await budget.fill('321000')
  await page.getByLabel('교통 예산', { exact: true }).fill('95000')

  cellStatus = 409
  await trendCell(page, '7월').click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('마감 내역이 바뀌었습니다. 새로고침해 주세요.')
  expect(await page.evaluate(() => window.budgetLifecycle.refreshes())).toBe(0)

  await alert.getByRole('button', { name: '최신 내역 확인', exact: true }).click()
  expect(await page.evaluate(() => window.budgetLifecycle.refreshes())).toBe(1)
  await expect(budget).toHaveValue('321000')
  await expect(page.getByLabel('교통 예산', { exact: true })).toHaveValue('95000')
  await expect(alert).toBeHidden()

  // The cache went with the banner, so the next hover asks the server again.
  cellStatus = 200
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  expect(cellRequests).toHaveLength(2)
})

test('Escape inside the popover closes it and puts focus back on the cell', async ({ page }) => {
  await boot(page)
  const cell = trendCell(page, '7월')
  await cell.focus()
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(popover(page).getByRole('link', { name: '이 달 거래 보기 →' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(popover(page)).toBeHidden()
  await expect(cell).toBeFocused()
})

test('the card never sits beside one cell showing another cell transactions', async ({ page }) => {
  await boot(page)
  await trendCell(page, '7월').hover()
  await expect(popover(page)).toBeVisible()
  await expect(popover(page)).toContainText('식비 · 7월')
  const first = (await popover(page).boundingBox())!

  // Slow the second request down so the in-between window is wide enough to observe.
  cellDelay = 700
  const second = trendCell(page, '7월', '교통')
  await second.hover()
  await page.waitForTimeout(350)
  await expect(popover(page)).toContainText('식비 · 7월')
  expect((await popover(page).boundingBox())!.y).toBe(first.y)

  await expect(popover(page)).toContainText('교통 · 7월')
  expect((await popover(page).boundingBox())!.y).not.toBe(first.y)
})

import { expect, test, type Page } from '@playwright/test'
import { buildLedgerTransactionsBrowser } from './fixtures/ledger-transactions-bundle'

let bundle: Awaited<ReturnType<typeof buildLedgerTransactionsBrowser>>
test.beforeAll(async () => { bundle = await buildLedgerTransactionsBrowser() })
test.afterAll(async () => { await bundle?.cleanup() })

async function openLedger(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 850 })
  await page.route('http://localhost/ledger', route => route.fulfill({ contentType: 'text/html', body: '<html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }))
  await page.goto('http://localhost/ledger')
  await page.addStyleTag({ content: bundle.css })
  await page.addScriptTag({ content: bundle.script })
}

const saved = { id: 1, date: '2026-09-23', flow: 'expense', fixed: false, categoryId: 1, memo: '수정한 장보기', amount: 45678, accountId: 12 }

for (const width of [360, 390, 768, 860]) {
  test(`mobile rows keep merchant and amount visible without horizontal scrolling at ${width}px`, async ({ page }) => {
    await openLedger(page, width)
    const list = page.getByRole('list', { name: '거래 내역' })
    await expect(list).toBeVisible()
    await expect(page.getByRole('table')).toBeHidden()
    const row = list.locator('details').first()
    await expect(row).not.toHaveAttribute('open', '')
    await expect(row.getByText('32,000원', { exact: true })).toBeInViewport()
    await expect(list.getByText('+123,456,789원', { exact: true })).toBeInViewport()
    const amountBox = await list.getByText('+123,456,789원', { exact: true }).boundingBox()
    expect(amountBox!.x).toBeGreaterThanOrEqual(0)
    expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(width)
    await expect(list.getByText('-8,500원', { exact: true })).toBeVisible()
    await row.locator('summary').click()
    await expect(row.getByRole('button', { name: '수정', exact: true })).toBeVisible()
    await expect(row).toContainText('동네 마트에서 주말 장보기와 생활용품 함께 구매')
    await expect(row).toContainText('DJ 네이버 현대카드')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/ledger-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
    await page.screenshot({ path: `test-results/ledger-mobile-${width}-dark.png`, fullPage: true, animations: 'disabled' })
  })
}

test('mobile editing preserves input after failure and saves locally with the current filters', async ({ page }) => {
  let posts = 0
  let posted = ''
  await page.route('http://localhost/test-save', async route => {
    posts++
    posted = route.request().postData() ?? ''
    await route.fulfill(posts === 1 ? { status: 503, body: 'offline' } : { json: { saved } })
  })
  await openLedger(page)
  const row = page.getByRole('list', { name: '거래 내역' }).locator('details').first()
  await row.locator('summary').click()
  await row.getByRole('button', { name: '수정', exact: true }).click()
  await row.getByLabel('사용내역', { exact: true }).fill('수정한 장보기')
  await row.getByLabel('금액', { exact: true }).fill('45678')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/ledger-mobile-edit-390.png', fullPage: true, animations: 'disabled' })
  await row.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect(row.getByRole('alert')).toContainText('수정 내용은 유지됩니다')
  await expect(row.getByLabel('사용내역', { exact: true })).toHaveValue('수정한 장보기')
  await row.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect(row.locator('summary')).toContainText('수정한 장보기')
  await expect(row.locator('summary')).toContainText('45,678원')
  for (const [key, value] of Object.entries({ inline: '1', transactionId: '1', returnAccount: '12', returnMajor: '식비', returnSub: '식자재', returnQ: '검색', returnSort: 'amount-desc' })) {
    expect(posted).toContain(`name="${key}"\r\n\r\n${value}\r\n`)
  }
  expect(page.url()).toBe('http://localhost/ledger')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('an edit remains the same draft across the mobile breakpoint and supports a negative amount', async ({ page }) => {
  await openLedger(page, 860)
  const row = page.getByRole('list', { name: '거래 내역' }).locator('details').first()
  await row.locator('summary').click()
  await row.getByRole('button', { name: '수정', exact: true }).click()
  await row.getByLabel('금액', { exact: true }).fill('45678')
  await page.setViewportSize({ width: 861, height: 850 })
  const table = page.getByRole('table')
  await expect(table.getByLabel('금액', { exact: true })).toHaveValue('45678')
  await table.getByLabel('금액', { exact: true }).fill('56789')
  await page.setViewportSize({ width: 860, height: 850 })
  await expect(row.getByLabel('금액', { exact: true })).toHaveValue('56789')
  await row.getByRole('button', { name: '금액 부호 바꾸기' }).click()
  await expect(row.getByLabel('금액', { exact: true })).toHaveValue('-56789')
  await row.getByRole('button', { name: '거래 수정 취소' }).click()
  await page.setViewportSize({ width: 861, height: 850 })
  await expect(table.getByLabel('금액', { exact: true })).toHaveCount(0)
  await expect(table.getByText('32,000원', { exact: true })).toBeVisible()
})

test('a save remains pending across a resize without allowing a second submission', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let posts = 0
  await page.route('http://localhost/test-save', async route => {
    posts++
    await held
    await route.fulfill({ json: { saved } })
  })
  await openLedger(page, 390)
  const row = page.getByRole('list', { name: '거래 내역' }).locator('details').first()
  await row.locator('summary').click()
  await row.getByRole('button', { name: '수정', exact: true }).click()
  await row.getByRole('button', { name: '거래 수정 저장' }).click()
  await expect.poll(() => posts).toBe(1)
  await page.setViewportSize({ width: 861, height: 850 })
  const table = page.getByRole('table')
  await expect(table.getByRole('button', { name: '거래 수정 저장' })).toBeDisabled()
  await expect(table.getByRole('button', { name: '거래 수정 취소' })).toBeDisabled()
  release()
  await expect(table.getByText('45,678원', { exact: true })).toBeVisible()
  expect(posts).toBe(1)
})

test('a desktop edit is expanded and visible after switching to mobile', async ({ page }) => {
  await openLedger(page, 861)
  const table = page.getByRole('table')
  await table.getByRole('row').filter({ hasText: '동네 마트에서' }).click()
  await table.getByLabel('사용내역', { exact: true }).fill('회전해도 남는 초안')
  await page.setViewportSize({ width: 860, height: 850 })
  const row = page.getByRole('list', { name: '거래 내역' }).locator('details').first()
  await expect(row.getByLabel('사용내역', { exact: true })).toBeVisible()
  await expect(row.getByLabel('사용내역', { exact: true })).toHaveValue('회전해도 남는 초안')
})

test('mobile cancellation, flow changes and deletion retain the existing safeguards', async ({ page }) => {
  let deleteBody = ''
  await page.route('http://localhost/test-delete', async route => { deleteBody = route.request().postData() ?? ''; await route.fulfill({ body: '' }) })
  await openLedger(page)
  const row = page.getByRole('list', { name: '거래 내역' }).locator('details').first()
  await row.locator('summary').focus()
  await page.keyboard.press('Enter')
  await row.getByRole('button', { name: '수정', exact: true }).click()
  await row.getByLabel('거래 유형', { exact: true }).selectOption('income')
  await expect(row.getByLabel('분류', { exact: true })).toHaveValue('')
  await row.getByRole('button', { name: '거래 수정 취소' }).click()
  await expect(row.locator('summary')).toContainText('32,000원')
  page.once('dialog', dialog => dialog.dismiss())
  await row.getByRole('button', { name: '삭제', exact: true }).click()
  expect(deleteBody).toBe('')
  page.once('dialog', dialog => dialog.accept())
  await row.getByRole('button', { name: '삭제', exact: true }).click()
  await expect.poll(() => deleteBody).toContain('name="transactionId"\r\n\r\n1\r\n')
  expect(deleteBody).toContain('name="month"\r\n\r\n2026-09\r\n')
  expect(deleteBody).toContain('name="returnSort"\r\n\r\namount-desc\r\n')
})

test('empty mobile results and the desktop table remain available', async ({ page }) => {
  await openLedger(page, 1440)
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('list', { name: '거래 내역' })).toBeHidden()
  await page.getByRole('row').filter({ hasText: '동네 마트에서' }).click()
  await expect(page.getByRole('button', { name: '거래 수정 저장' })).toBeVisible()
  await page.getByRole('button', { name: '거래 수정 취소' }).click()
  await page.setViewportSize({ width: 390, height: 850 })
  await page.getByRole('button', { name: '빈 결과 보기' }).click()
  await expect(page.getByText('조건에 맞는 거래가 없습니다.', { exact: true }).filter({ visible: true })).toHaveCount(1)
})

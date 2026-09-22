import { expect, test, type Page } from '@playwright/test'
import { buildLedgerCategoriesBrowser } from './fixtures/ledger-categories-bundle'

let bundle: Awaited<ReturnType<typeof buildLedgerCategoriesBrowser>>
test.beforeAll(async () => { bundle = await buildLedgerCategoriesBrowser() })
test.afterAll(async () => { await bundle?.cleanup() })

async function openCategories(page: Page, width: number, params = '') {
  await page.setViewportSize({ width, height: 900 })
  await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' }))
  await page.goto(`http://localhost/ledger?month=2026-07&tab=categories&account=12&flow=${width === 390 ? '' : 'expense'}&q=검색${params}`)
  await page.addStyleTag({ content: bundle.css })
  await page.addScriptTag({ content: bundle.script })
}

for (const width of [1440, 768, 390]) {
  test(`category selection, expansion and scoped reset at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await openCategories(page, width)
    const ranks = page.getByRole('heading', { name: '카테고리 순위', exact: true }).locator('..')
    await expect(ranks.getByRole('link')).toHaveCount(8)
    await ranks.getByRole('link', { name: '식비', exact: true }).click()
    if (width < 1280) await expect(page.getByRole('heading', { name: '식비', exact: true })).toBeFocused()
    expect(new URL(page.url()).searchParams.get('flow')).toBe(width === 390 ? null : 'expense')
    await expect(ranks.getByRole('link', { name: '식비', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(ranks.getByRole('link', { name: '주거', exact: true })).toBeVisible()
    await ranks.getByRole('button', { name: '전체 보기' }).click()
    await expect(ranks.getByRole('link')).toHaveCount(9)
    await ranks.getByRole('link', { name: '경조사', exact: true }).click()
    await ranks.getByRole('button', { name: '접기', exact: true }).click()
    await expect(ranks.getByRole('link', { name: '경조사', exact: true })).toBeVisible()
    await ranks.getByRole('link', { name: '식비', exact: true }).click()
    await expect(ranks.getByRole('link')).toHaveCount(8)
    const rows = page.getByRole('region', { name: '카테고리 거래 내역' })
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText('2건 · 46,000원')
    const subheading = await page.getByRole('heading', { name: '소분류', exact: true }).boundingBox()
    const transactionsHeading = await rows.getByRole('heading').boundingBox()
    expect(subheading).not.toBeNull()
    expect(transactionsHeading).not.toBeNull()
    if (width >= 768) {
      expect(transactionsHeading!.x).toBeGreaterThan(subheading!.x)
      expect(Math.abs(transactionsHeading!.y - subheading!.y)).toBeLessThan(4)
    } else {
      const lastSub = await page.getByRole('link', { name: '소분류 카페', exact: true }).boundingBox()
      expect(transactionsHeading!.y).toBeGreaterThan(lastSub!.y + lastSub!.height)
    }
    await expect(page.getByRole('heading', { name: '가맹점', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '소분류 카페', exact: true }).click()
    await expect(rows).toContainText('1건 · 12,000원')
    await expect(rows.getByText('선택한 커피', { exact: true })).toBeVisible()
    await expect(rows.getByText('다른 장보기', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '소분류 장보기', exact: true })).toBeVisible()
    const link = new URL(await page.getByRole('link', { name: '거래 보기 →' }).getAttribute('href') ?? '', 'http://localhost')
    expect(Object.fromEntries(link.searchParams)).toMatchObject({ tab: 'list', major: '식비', sub: '카페', account: '12', q: '검색' })
    expect(link.searchParams.get('flow')).toBe(width === 390 ? null : 'expense')
    await page.screenshot({ path: `test-results/ledger-categories-${width}.png`, fullPage: true, animations: 'disabled' })
    await page.getByRole('link', { name: '전체 소분류', exact: true }).click()
    await expect(rows).toContainText('2건 · 46,000원')
    await page.getByRole('link', { name: '소분류 장보기', exact: true }).click()
    await page.getByRole('combobox', { name: '대분류 필터' }).selectOption('주거')
    expect(new URL(page.url()).searchParams.get('sub')).toBe('')
    await page.getByRole('link', { name: '카테고리 선택 해제', exact: true }).click()
    const cleared = new URL(page.url()).searchParams
    expect(cleared.get('major')).toBeNull()
    expect(cleared.get('sub')).toBeNull()
    expect(cleared.get('account')).toBe('12')
    expect(cleared.get('q')).toBe('검색')
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await ranks.getByRole('link', { name: '식비', exact: true }).click()
    await page.getByRole('link', { name: '소분류 카페', exact: true }).click()
    await page.screenshot({ path: `test-results/ledger-categories-${width}-dark.png`, fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`rank amounts and bars select categories with responsive focus at ${width}px`, async ({ page }) => {
    await openCategories(page, width)
    const ranks = page.getByRole('heading', { name: '카테고리 순위', exact: true }).locator('..')
    await ranks.getByText('46,000원', { exact: true }).click()
    await expect(page).toHaveURL(/major=/)
    const selectedHeading = page.getByRole('heading', { name: '식비', exact: true })
    const returnButton = page.getByRole('button', { name: '카테고리 다시 선택', exact: true })
    if (width < 1280) {
      await expect(selectedHeading).toBeFocused()
      await expect(selectedHeading).toBeInViewport()
      const selectedUrl = page.url()
      await returnButton.click()
      const selectedRank = ranks.getByRole('link', { name: '식비', exact: true })
      await expect(selectedRank).toBeFocused()
      await expect(selectedRank).toBeInViewport()
      expect(page.url()).toBe(selectedUrl)
      await selectedRank.press('Enter')
      await expect(selectedHeading).toBeFocused()
    } else {
      await expect(returnButton).toBeHidden()
      await expect(selectedHeading).not.toBeFocused()
      expect(await page.evaluate(() => scrollY)).toBe(0)
    }

    await page.getByRole('link', { name: '소분류 카페', exact: true }).click()
    const transactionsHeading = page.getByRole('heading', { name: '거래 내역 · 카페', exact: true })
    if (width < 1280) {
      await expect(transactionsHeading).toBeFocused()
      await expect(transactionsHeading).toBeInViewport()
    }
    await page.getByRole('link', { name: '전체 소분류', exact: true }).click()
    await expect(page.getByRole('region', { name: '카테고리 거래 내역' })).toContainText('2건 · 46,000원')
    if (width < 1280) await returnButton.click()
    const housing = ranks.getByRole('link', { name: '주거', exact: true })
    const box = await housing.boundingBox()
    // Click the bottom strip where the amount bar sits, not the category name.
    await housing.click({ position: { x: box!.width / 2, y: box!.height - 14 } })
    await expect(housing).toHaveAttribute('aria-current', 'true')
  })
}

test('opening a filtered URL does not steal focus or scroll on mobile', async ({ page }) => {
  await openCategories(page, 390, '&major=식비&sub=카페')
  await expect(page.getByRole('region', { name: '카테고리 거래 내역' })).toContainText('1건 · 12,000원')
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(page.getByRole('heading', { name: '거래 내역 · 카페', exact: true })).not.toBeFocused()
})

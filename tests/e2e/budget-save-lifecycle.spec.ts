import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import type {} from './fixtures/budget-save-lifecycle'

let bundle: string
let outputDirectory: string

test.beforeAll(async () => {
  // Next already ships webpack; no browser-test dependency or product route.
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const bundled = require('next/dist/compiled/webpack/webpack')
  bundled.init()
  const webpack = bundled.webpack
  outputDirectory = await mkdtemp(path.join(tmpdir(), 'budget-lifecycle-bundle-'))
  const root = process.cwd()
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', devtool: false,
      entry: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle.tsx'),
      output: { path: outputDirectory, filename: 'lifecycle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': path.join(root, 'src'),
        'react$': path.join(root, 'node_modules/next/dist/compiled/react'),
        'react/jsx-runtime$': path.join(root, 'node_modules/next/dist/compiled/react/jsx-runtime'),
        'react/jsx-dev-runtime$': path.join(root, 'node_modules/next/dist/compiled/react/jsx-dev-runtime'),
        'react-dom$': path.join(root, 'node_modules/next/dist/compiled/react-dom'),
        'react-dom/client$': path.join(root, 'node_modules/next/dist/compiled/react-dom/client'),
        'next/navigation$': path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-boundaries.ts') } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
        use: path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-loader.cjs') }] },
      plugins: [new webpack.NormalModuleReplacementPlugin(/^\.\/actions$/, (resource: { context: string; request: string }) => {
        if (resource.context === path.join(root, 'src/features/budgets')) {
          resource.request = path.join(root, 'tests/e2e/fixtures/budget-save-lifecycle-boundaries.ts')
        }
      })],
    })
    compiler.run((error: Error | null, stats: { hasErrors(): boolean; toString(): string }) => {
      compiler.close(() => {
        if (error) reject(error)
        else if (stats.hasErrors()) reject(new Error(stats.toString()))
        else resolve()
      })
    })
  })
  bundle = await readFile(path.join(outputDirectory, 'lifecycle.js'), 'utf8')
})

test.afterAll(async () => { if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }) })

test.beforeEach(async ({ page }) => {
  await page.route('http://budget-lifecycle.test/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/budget-recommendations') {
      return route.fulfill({ json: { month: url.searchParams.get('month'), latestJob: null, completed: null,
        worker: 'offline', availability: 'available', freshness: 'current', instructionsChanged: false } })
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' })
  })
  await page.goto('http://budget-lifecycle.test/')
  await page.addScriptTag({ content: bundle })
  await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('350000')
})

test('acknowledges the save while independent real React transition work remains pending', async ({ page }) => {
  await page.getByLabel('식비 예산', { exact: true }).fill('351000')
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  await expect(page.getByLabel('식비 예산', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toHaveCount(0)
  await page.evaluate(() => window.budgetLifecycle.holdTransition())
  await expect(page.getByTestId('independent-pending')).toHaveText('true')
  await page.evaluate(() => window.budgetLifecycle.resolve(0))
  await expect(page.getByLabel('식비 예산', { exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '저장됨', exact: true })).toBeVisible()
  await expect(page.getByText('저장된 예산 351,000원', { exact: true })).toBeVisible()
  await expect(page.getByTestId('independent-pending')).toHaveText('true')
  await page.evaluate(() => window.budgetLifecycle.releaseTransition())
})

test('keeps native validation and Enter submission, snapshots once and rejects same-tick duplicate submits', async ({ page }) => {
  const amount = page.getByLabel('식비 예산', { exact: true })
  await amount.fill('-1')
  expect(await amount.evaluate(input => (input as HTMLInputElement).checkValidity())).toBe(false)
  await amount.press('Enter')
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toEqual([])
  await amount.fill('351000')
  await amount.press('Enter')
  await expect(amount).toBeDisabled()
  await expect(page.getByRole('button', { name: '저장 중…', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => window.budgetLifecycle.calls())).toMatchObject([
    { payload: { month: '2026-09', changes: [{ amount: 351000, expectedVersion: 'food-v1' }] } },
  ])
  await page.evaluate(() => window.budgetLifecycle.resolve(0))
  await expect(amount).toBeEnabled()
  await amount.fill('352000')
  await page.locator('form').evaluate(form => {
    ;(form as HTMLFormElement).requestSubmit()
    ;(form as HTMLFormElement).requestSubmit()
  })
  await expect(amount).toBeDisabled()
  expect(await page.evaluate(() => window.budgetLifecycle.calls().length)).toBe(2)
  await page.evaluate(() => window.budgetLifecycle.resolve(1))
  await expect(amount).toBeEnabled()
  expect(await page.evaluate(() => window.budgetLifecycle.calls().length)).toBe(2)
})

test('keeps a newer edit and the returned CAS baseline when older props arrive after acknowledgement', async ({ page }) => {
  const amount = page.getByLabel('식비 예산', { exact: true })
  await amount.fill('351000')
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  await page.evaluate(() => window.budgetLifecycle.resolve(0))
  await expect(amount).toBeEnabled()
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toBeVisible()
  await amount.fill('352000')
  await page.getByLabel('목표 저축률', { exact: true }).fill('35')
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toHaveCount(0)
  await page.evaluate(() => window.budgetLifecycle.lateProps())
  await expect(amount).toHaveValue('352000')
  await expect(page.getByLabel('목표 저축률', { exact: true })).toHaveValue('35')
  await expect(page.getByText('저장된 예산 351,000원', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
  expect(await page.evaluate(() => window.budgetLifecycle.calls()[1])).toMatchObject({
    previous: { saved: { rows: [{ amount: 351000, version: 'food-v2' }] } },
    payload: { changes: [{ amount: 352000, expectedVersion: 'food-v2' }],
      targetChange: { value: 35, expectedVersion: 'target-v2' } },
  })
  await page.evaluate(() => window.budgetLifecycle.resolve(1))
  await expect(amount).toBeEnabled()
})

for (const outcome of ['budget_conflict', 'source_changed', 'transport'] as const) {
  test(`${outcome} retains edited AI provenance and permits an explicit retry`, async ({ page }) => {
    await page.evaluate(() => window.budgetLifecycle.mount('2026-10', true))
    const amount = page.getByLabel('식비 예산', { exact: true })
    await expect(page.getByText('원래 AI 추천 300,000원', { exact: true })).toBeVisible()
    await amount.fill('351000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(amount).toBeDisabled()
    await page.evaluate(outcome => {
      if (outcome === 'transport') window.budgetLifecycle.reject(0)
      else window.budgetLifecycle.resolve(0, { code: outcome, error: `save rejected: ${outcome}` })
    }, outcome)
    await expect(amount).toBeEnabled()
    await expect(amount).toHaveValue('351000')
    await expect(page.getByText('원래 AI 추천 300,000원', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '변경사항 저장', exact: true })).toBeEnabled()
    if (outcome === 'budget_conflict') await expect(page.getByRole('region', { name: '예산 충돌 비교', exact: true })).toBeVisible()
    if (outcome === 'source_changed') await expect(page.getByText('save rejected: source_changed', { exact: true })).toBeVisible()
    if (outcome === 'transport') await expect(page.getByText(/저장 결과를 확인하지 못했습니다/)).toBeVisible()
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    expect(await page.evaluate(() => window.budgetLifecycle.calls()[1].payload.changes)).toEqual([
      { major: '식비', amount: 351000, recommendationJobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedVersion: 'food-v1' },
    ])
    await page.evaluate(() => window.budgetLifecycle.resolve(1))
    await expect(amount).toBeEnabled()
    await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^적용됨$/ })).toBeVisible()
  })
}

for (const change of ['month', 'unmount'] as const) {
  for (const terminal of ['result', 'transport error'] as const) {
  test(`an old ${terminal} cannot overwrite or unlock a newer editor after ${change}`, async ({ page }) => {
    const amount = page.getByLabel('식비 예산', { exact: true })
    await amount.fill('351000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(amount).toBeDisabled()
    if (change === 'unmount') {
      await page.evaluate(() => window.budgetLifecycle.unmount())
      await expect(amount).toHaveCount(0)
    }
    // Deliberately reuse the outer component identity for the month-change case.
    await page.evaluate(change => window.budgetLifecycle.mount('2026-10', false, change === 'month'), change)
    await expect(amount).toBeEnabled()
    await expect(amount).toHaveValue('350000')
    await amount.fill('360000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(amount).toBeDisabled()
    await page.evaluate(terminal => {
      if (terminal === 'result') window.budgetLifecycle.resolve(0)
      else window.budgetLifecycle.reject(0)
    }, terminal)
    await expect(amount).toBeDisabled()
    await expect(amount).toHaveValue('360000')
    await expect(page.getByRole('button', { name: '저장됨', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => window.budgetLifecycle.calls()[1].payload)).toMatchObject({ month: '2026-10' })
    await page.evaluate(() => window.budgetLifecycle.resolve(1))
    await expect(amount).toBeEnabled()
    await expect(page.getByText('저장된 예산 360,000원', { exact: true })).toBeVisible()
  })
  }
}

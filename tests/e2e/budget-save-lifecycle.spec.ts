import { buildBudgetBrowser, type BudgetBrowserBundle } from './fixtures/budget-editor-browser'

import { expect, test } from '@playwright/test'
import { evaluateBudget } from '../../src/features/budget-recommendations/calculations'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'
import type {} from './fixtures/budget-save-lifecycle'

let browserBundle: BudgetBrowserBundle
let aiPosts: Record<string, unknown>[]
let exactRequestGets: number
let releaseFirstExactGet: (() => void) | null
let recommendationGets: number
let promptJobs: string[]
let promptResponses: number
let releaseDelayedPrompt: (() => void) | null
let releaseDelayedApply: (() => void) | null

const completedJobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const failedJobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function promptView(marker: string) {
  return { state: 'recorded', preview: {
    kind: 'budget', month: '2026-10', prefix: marker, dataJson: marker, suffix: marker,
    promptHash: 'e'.repeat(64), generatedAt: '2026-09-10T00:00:00Z', unsaved: false,
    instructions: { kind: 'budget', settingsRevision: 1, defaultsVersion: 'test-v1',
      common: '', task: '', commonSource: 'default', taskSource: 'default' },
  } }
}

function reviewCompleted() {
  const snapshot = makeBudgetSnapshot()
  snapshot.month = '2026-10'
  snapshot.input.month = '2026-10'
  snapshot.budgetState.month = '2026-10'
  snapshot.rows.push({
    ...snapshot.rows[0], major: '교통', savedAmount: 90_000, actual: 20_000,
    floor: 20_000, previousBudget: 90_000, previousActual: 85_000, average: 82_000, median: 80_000,
  })
  snapshot.budgetState.current.push({ major: '교통', amount: 90_000, sourceMonth: '*', recommendationJobId: null })
  snapshot.budgetState.previous.push({ major: '교통', amount: 90_000, sourceMonth: '*', recommendationJobId: null })
  const report = makeBudgetReport()
  report.rows.push({
    major: '교통', amount: 80_000, reason: '최근 교통비를 반영했습니다.', references: [], exceptional: [], reducible: [],
  })
  return {
    id: completedJobId, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    completedAt: '2026-09-10T00:00:00Z', snapshot, promptInput: null, report,
    evaluation: evaluateBudget(snapshot, report.rows),
  }
}

test.beforeAll(async () => { browserBundle = await buildBudgetBrowser() })
test.afterAll(async () => { await browserBundle?.cleanup() })

test.beforeEach(async ({ page }, testInfo) => {
  const aiControls = testInfo.title.startsWith('AI controls:')
  const task7Review = testInfo.title.startsWith('Task 7 review:')
  aiPosts = []
  exactRequestGets = 0
  releaseFirstExactGet = null
  recommendationGets = 0
  promptJobs = []
  promptResponses = 0
  releaseDelayedPrompt = null
  releaseDelayedApply = null
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/budget-recommendations') {
      const month = url.searchParams.get('month')
      const empty = { month, latestJob: null, completed: null,
        worker: aiControls ? 'ready' : 'offline', availability: 'available', freshness: 'current', instructionsChanged: false }
      if (task7Review) {
        recommendationGets += 1
        if (testInfo.title.includes('cancels') && recommendationGets === 3) {
          await new Promise<void>(resolve => { releaseDelayedApply = resolve })
        }
        return route.fulfill({ json: {
          month, latestJob: { id: failedJobId, status: 'failed', errorCode: 'cli_failed' },
          completed: reviewCompleted(), worker: 'ready', availability: 'available', freshness: 'current', instructionsChanged: false,
        } }).catch(() => {})
      }
      if (aiControls && route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>
        aiPosts.push(body)
        if (aiPosts.length === 1) return route.fulfill({ status: 503, json: { error: 'request_failed' } })
        return route.fulfill({ json: { ...empty, latestJob: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', requestId: body.requestId,
          status: 'queued', errorCode: null,
        } } })
      }
      if (aiControls && url.searchParams.has('requestId')) {
        exactRequestGets += 1
        if (exactRequestGets === 1) {
          await new Promise<void>(resolve => { releaseFirstExactGet = resolve })
          return route.fulfill({ json: empty }).catch(() => {})
        }
        releaseFirstExactGet?.()
        return route.fulfill({ json: empty })
      }
      return route.fulfill({ json: empty })
    }
    if (task7Review && url.pathname === '/api/ai-settings') {
      const body = route.request().postDataJSON() as { jobId: string }
      promptJobs.push(body.jobId)
      if (testInfo.title.includes('delayed')) {
        await new Promise<void>(resolve => { releaseDelayedPrompt = resolve })
      }
      await route.fulfill({ json: promptView(`PROMPT-${body.jobId}`) }).catch(() => {})
      promptResponses += 1
      return
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' })
  })
  await page.goto(`http://localhost/${aiControls ? '?mode=ai-controls' : task7Review ? '?mode=task7-review' : ''}`)
  await page.addStyleTag({ content: browserBundle.css })
  await page.addScriptTag({ content: browserBundle.script })
  if (aiControls) await expect(page.getByTestId('ai-ready')).toHaveText('true')
  else if (task7Review) await expect.poll(() => recommendationGets).toBe(1)
  else await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('350000')
})

for (const timing of ['loaded', 'delayed'] as const) {
  test(`Task 7 review: ${timing} failed-request prompt stays out of the completed summary`, async ({ page }) => {
    await page.getByRole('button', { name: '다시 시도', exact: true }).click()
    const request = page.getByRole('dialog', { name: 'AI 예산 추천 요청', exact: true })
    await request.getByRole('button', { name: '지난 요청의 프롬프트 보기', exact: true }).click()
    await expect.poll(() => promptJobs).toEqual([failedJobId])
    const marker = `PROMPT-${failedJobId}`
    if (timing === 'loaded') await expect(request.getByText(marker, { exact: true }).first()).toBeVisible()
    await request.getByRole('button', { name: '취소', exact: true }).click()
    await expect(request).toBeHidden()
    await page.getByRole('button', { name: '요약', exact: true }).click()
    const summary = page.getByRole('dialog', { name: 'AI 예산 추천 요약', exact: true })
    await expect(summary).toBeVisible()
    if (timing === 'delayed') releaseDelayedPrompt?.()
    await expect.poll(() => promptResponses).toBe(1)
    await page.waitForTimeout(100)
    await expect(summary.getByText(marker, { exact: true })).toHaveCount(0)
  })
}

for (const action of ['모두 채우기', '고친 항목은 두기'] as const) {
  test(`Task 7 review: cancel while ${action} revalidation is pending cancels the fill`, async ({ page }) => {
    const food = page.getByLabel('식비 예산', { exact: true })
    const transport = page.getByLabel('교통 예산', { exact: true })
    await food.fill('360000')
    await page.locator('.plan-toolbar__fills').getByRole('button', { name: 'AI 추천', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: '전체 채우기 확인', exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: action, exact: true }).click()
    await expect.poll(() => recommendationGets).toBe(3)
    await confirmation.press('Escape')
    await expect(confirmation).toBeHidden()
    await expect(food).toBeEnabled()
    releaseDelayedApply?.()
    await expect(food).toHaveValue('360000')
    await expect(transport).toHaveValue('90000')
  })
}

test('AI controls: footer Close hides native evidence and summary popovers before cleanup', async ({ page }) => {
  await page.getByRole('button', { name: 'AI controls: evidence', exact: true }).click()
  const evidence = page.getByRole('dialog', { name: '식비 AI 추천 근거', exact: true })
  await expect(evidence).toBeVisible()
  await evidence.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(evidence).toBeHidden()
  await expect(page.getByTestId('ai-cleanup')).toHaveText('evidence:1;summary:0')

  await page.getByRole('button', { name: 'AI controls: summary', exact: true }).click()
  const summary = page.getByRole('dialog', { name: 'AI 예산 추천 요약', exact: true })
  await expect(summary).toBeVisible()
  await summary.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(summary).toBeHidden()
  await expect(page.getByTestId('ai-cleanup')).toHaveText('evidence:1;summary:1')
})

test('AI controls: recover transfers an ambiguous exact-ID lookup without stranding submitting', async ({ page }) => {
  await page.getByRole('button', { name: 'AI controls: request', exact: true }).click()
  await expect.poll(() => exactRequestGets).toBe(1)
  await expect(page.getByTestId('ai-submitting')).toHaveText('true')
  await page.getByRole('button', { name: 'AI controls: recover', exact: true }).click()
  await expect.poll(() => exactRequestGets).toBe(2)
  await expect(page.getByTestId('ai-submitting')).toHaveText('false')
  await expect(page.getByTestId('ai-ambiguous')).toHaveText('true')
  await page.getByRole('button', { name: 'AI controls: retry', exact: true }).click()
  await expect.poll(() => aiPosts).toHaveLength(2)
  expect(aiPosts[1]).toEqual(aiPosts[0])
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
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toBeVisible()
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
  await page.getByRole('form', { name: '예산 편집기', exact: true }).evaluate(form => {
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
  await page.getByRole('button', { name: '목표 저축률 30%', exact: true }).click()
  await page.getByLabel('목표 저축률', { exact: true }).fill('35')
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toHaveCount(0)
  await page.evaluate(() => window.budgetLifecycle.lateProps())
  await expect(amount).toHaveValue('352000')
  await expect(page.getByLabel('목표 저축률', { exact: true })).toHaveValue('35')
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toHaveCount(0)
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
    await expect(page.getByText(/AI 추천.*300,000에서 조정/)).toBeVisible()
    await amount.fill('351000')
    await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
    await expect(amount).toBeDisabled()
    await page.evaluate(outcome => {
      if (outcome === 'transport') window.budgetLifecycle.reject(0)
      else window.budgetLifecycle.resolve(0, { code: outcome, error: `save rejected: ${outcome}` })
    }, outcome)
    await expect(amount).toBeEnabled()
    await expect(amount).toHaveValue('351000')
    await expect(page.getByText(/AI 추천.*300,000에서 조정/)).toBeVisible()
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
    await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^저장됨$/ })).toBeVisible()
  })
  }
}

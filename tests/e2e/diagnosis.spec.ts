import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'

test.describe('monthly diagnosis', () => {
  test.setTimeout(90_000)
  for (const width of [1440, 390]) {
    test(`whole-month diagnosis lifecycle and report at ${width}px`, async ({ page }, testInfo) => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const databaseUrl = process.env.DATABASE_URL!
      for (const value of [url, databaseUrl]) if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('Diagnosis E2E requires local Supabase')
      const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
      const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
      const database = postgres(databaseUrl, { prepare: false, max: 1 })
      const email = `diagnosis-e2e-${crypto.randomUUID()}@example.com`
      const password = randomBytes(20).toString('base64url')
      const { data: auth, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) throw error
      let householdId: string | undefined
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        const [household] = await database`insert into households (name) values ('Diagnosis E2E') returning id`
        householdId = household.id
        await database`insert into household_members (household_id, user_id) values (${householdId!}, ${auth.user!.id})`
        const categories = await database`insert into categories (household_id, kind, major, sub) values
          (${householdId!}, 'income', '월급', '급여'),
          (${householdId!}, 'expense', '식비', '식자재'),
          (${householdId!}, 'expense', '보험', '보험료'),
          (${householdId!}, 'expense', '자녀', '육아용품') returning id, major`
        const category = (name: string) => categories.find(row => row.major === name)!.id
        await database`insert into transactions (household_id, date, flow, amount, category_id, raw_merchant) values
          (${householdId!}, '2026-04-01', 'expense', 4200000, ${category('식비')}, '4월 예시'),
          (${householdId!}, '2026-05-01', 'expense', 5200000, ${category('식비')}, '5월 예시'),
          (${householdId!}, '2026-06-01', 'expense', 5200000, ${category('식비')}, '6월 예시'),
          (${householdId!}, '2026-06-01', 'expense', 400000, ${category('보험')}, '6월 보험'),
          (${householdId!}, '2026-07-01', 'income', 7101720, ${category('월급')}, '7월 월급'),
          (${householdId!}, '2026-07-02', 'income', 579327, null, '월급 외 수입'),
          (${householdId!}, '2026-07-03', 'saving', 850000, null, '저축 납입'),
          (${householdId!}, '2026-07-04', 'expense', 5000000, ${category('식비')}, '7월 식비 예시'),
          (${householdId!}, '2026-07-05', 'expense', 130339, ${category('보험')}, '7월 보험'),
          (${householdId!}, '2026-07-06', 'expense', 473610, ${category('자녀')}, '육아용품 예시')`
        await database`insert into budgets (household_id, month, major, amount) values (${householdId!}, '*', '식비', 6200000)`
        const token = randomBytes(32).toString('base64url')
        await database`insert into diagnosis_workers (household_id, token_hash, label) values (${householdId!}, ${createHash('sha256').update(token).digest('hex')}, 'E2E Mac')`
        await page.setViewportSize({ width, height: 1000 })
        await page.goto('/login')
        await page.getByPlaceholder('이메일').fill(email)
        await page.getByPlaceholder('비밀번호').fill(password)
        await page.getByRole('button', { name: '로그인', exact: true }).click()
        await expect(page).toHaveURL('/dashboard')
        const heartbeat = await anon.rpc('heartbeat_ai_worker', { p_token: token, p_model: null, p_timeout_ms: 180_000 })
        if (heartbeat.error) throw heartbeat.error
        expect(heartbeat.data).toBe(true)
        await page.goto('/ledger?month=2026-07&tab=ai&flow=expense&major=보험&q=unmatched')
        await expect(page.getByRole('navigation', { name: '거래 보기' }).getByRole('link')).toHaveText(['요약', '목록', 'AI 진단', '카테고리', '가맹점'])
        const panel = page.getByRole('region', { name: '7월 AI 진단', exact: true })
        await expect(panel.getByText('64.8', { exact: false }).first()).toBeVisible()
        await expect(panel.getByText('아직 7월 진단이 없어요')).toBeVisible()
        await panel.getByRole('button', { name: '7월 AI 진단하기', exact: true }).first().click()
        await expect(panel.getByRole('button', { name: '진단 대기 중', exact: true })).toBeVisible()
        const [legacyClaim] = await database`select public.claim_diagnosis_job(${token}) as job`
        expect(legacyClaim.job).toBeNull()
        const [claim] = await database`select public.claim_configured_diagnosis_job(${token}) as job`
        const job = claim.job
        expect(job.snapshot.current.salaryRemainder).toBe(647771)
        expect(job.snapshot.current.count).toBe(6)
        const expense = job.snapshot.transactions.find((row: { major: string }) => row.major === '보험')
        const report = {
          version: 1, headline: '총지출은 비슷하지만, 쓰임새는 달라졌어요.',
          summary: '월급에서 지출과 저축을 뺀 기록상 차액은 64.8만 원입니다. 보험료는 줄고 자녀 지출은 늘었습니다. 반복될 비용을 확인하면 다음 달 계획이 더 정확해집니다.',
          changes: [{ title: '보험료 감소를 확인해보세요', body: '6월 40만 원에서 7월 약 13만 원으로 줄었습니다. 실제 납부액과 기록을 대조해보세요.', category: '보험', transactionIds: [expense.id] }, { title: '자녀 지출의 반복 여부를 나눠보세요', body: '이번 달 육아용품 지출은 다음 달에 다시 필요한지 확인하면 좋겠습니다.', category: '자녀', transactionIds: [] }],
          trend: { summary: '전체 지출은 지난달과 비슷한 수준입니다. 우리집의 최근 세 달과 비교했습니다.', caveat: '달마다 기록 범위가 다를 수 있어 소비 습관의 변화를 단정하지 않았습니다.' },
          checks: [{ title: '보험 납부 내역 대조', body: '카드·이체 내역에 빠진 보험료가 있는지 확인하세요.', transactionIds: [expense.id] }],
          actions: [{ title: '반복될 자녀 지출만 다음 달에 반영하기', body: '다음 달에도 나갈 비용과 일회성 구매를 구분해 예산을 정리해보세요.' }, { title: '보험료를 확인한 뒤 남는 금액 다시 보기', body: '보험료가 지난달 수준으로 돌아오면 여유 금액도 줄어듭니다.' }],
          positive: '월급 기준으로도 기록된 지출과 저축 납입을 감당했습니다.',
        }
        const [finished] = await database`select public.finish_diagnosis_job(${token}, ${job.id}, ${job.claimToken}, ${database.json(report)}, null) as ok`
        expect(finished.ok).toBe(true)
        await expect(panel.getByRole('heading', { name: report.headline })).toBeVisible({ timeout: 15_000 })
        await expect(panel.getByRole('heading', { name: '우리집의 평소와 비교' })).toBeVisible()
        await expect(panel.getByRole('button', { name: '다시 진단하기' })).toBeEnabled()
        await panel.getByRole('button', { name: '근거 내역 1건' }).first().click()
        await expect(page.getByRole('dialog')).toContainText('7월 보험')
        await page.getByRole('button', { name: '근거 내역 닫기' }).click()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: testInfo.outputPath(`diagnosis-${width}.png`), fullPage: true })
        const rerunHeartbeat = await anon.rpc('heartbeat_ai_worker', { p_token: token, p_model: null, p_timeout_ms: 180_000 })
        if (rerunHeartbeat.error) throw rerunHeartbeat.error
        expect(rerunHeartbeat.data).toBe(true)
        await panel.getByRole('button', { name: '다시 진단하기' }).click()
        await expect(panel.getByRole('button', { name: '진단 대기 중', exact: true })).toBeVisible()
        await expect(panel.getByRole('heading', { name: report.headline })).toBeVisible()
        const [second] = await database`select public.claim_configured_diagnosis_job(${token}) as job`
        await database`select public.finish_diagnosis_job(${token}, ${second.job.id}, ${second.job.claimToken}, null, 'cli_failed')`
        await expect(panel.getByText(/이전 보고서는 그대로 남아 있어요/)).toBeVisible({ timeout: 15_000 })
        await expect(panel.getByRole('heading', { name: report.headline })).toBeVisible()
        await database`update transactions set amount = amount + 100 where id = ${expense.id}`
        await page.reload()
        await expect(panel.getByText('진단 이후 내역이 바뀌었어요.')).toBeVisible()
        expect(errors).toEqual([])
      } finally {
        if (householdId) await database`delete from households where id = ${householdId}`
        await admin.auth.admin.deleteUser(auth.user!.id)
        await database.end()
      }
    })
  }
})

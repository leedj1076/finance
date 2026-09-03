import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import {
  accountTableMonths,
  buildAccountMonthly,
  buildCategoryMonthly,
  type MonthlyBreakdownRow,
} from '@/features/analytics/account-monthly'
import {
  calculateFinancialHealth,
  financialHealthSignal,
  getFinancialHealthData,
} from '@/features/analytics/financial-health'
import { getDashboardData } from '@/features/analytics/queries'

const rows: MonthlyBreakdownRow[] = [
  { date: '2026-01-02', flow: 'expense', amount: 100, accountName: 'B 카드', major: '식비' },
  { date: '2026-01-03', flow: 'expense', amount: 400, accountName: 'A 카드', major: '주거' },
  { date: '2026-03-02', flow: 'expense', amount: 300, accountName: 'B 카드', major: '식비' },
  { date: '2026-03-04', flow: 'expense', amount: 50, accountName: '', major: '미분류' },
  { date: '2026-02-25', flow: 'income', amount: 1_000, accountName: '급여통장', major: '근로소득' },
]

describe('account monthly data', () => {
  test('sorts by total and uses the same active-month null mask for every account', () => {
    const result = buildAccountMonthly(rows, 'expense')

    expect(result.accounts).toEqual(['B 카드', 'A 카드', '(미지정)'])
    expect(result.series['B 카드']).toEqual([100, null, 300, null, null, null, null, null, null, null, null, null])
    expect(result.series['A 카드']).toEqual([400, null, 0, null, null, null, null, null, null, null, null, null])
    expect(result.series['(미지정)'][2]).toBe(50)
    expect(accountTableMonths(result)).toEqual([1, 3])
  })

  test('builds category series with the same Flask null semantics and excludes uncategorized rows', () => {
    const result = buildCategoryMonthly(rows, 'expense')

    expect(result.categories).toEqual(['식비', '주거'])
    expect(result.series['식비']).toEqual([100, null, 300, null, null, null, null, null, null, null, null, null])
    expect(result.series['주거'][2]).toBe(0)
    expect(result.series['미분류']).toBeUndefined()
  })
})

describe('dashboard household scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('does not mix another household account totals or latest asset balances', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`
      insert into households (name) values (${`account-monthly-a-${suffix}`}) returning id
    `
    const [householdB] = await raw`
      insert into households (name) values (${`account-monthly-b-${suffix}`}) returning id
    `
    householdIds.push(householdA.id, householdB.id)

    const [accountA] = await raw`
      insert into accounts (household_id, name) values (${householdA.id}, 'A 카드') returning id
    `
    const [accountB] = await raw`
      insert into accounts (household_id, name) values (${householdB.id}, 'B 카드') returning id
    `
    await raw`
      insert into transactions (household_id, date, flow, fixed, amount, account_id, source)
      values
        (${householdA.id}, '2026-01-02', 'income', false, 1000000, ${accountA.id}, 'test'),
        (${householdA.id}, '2026-01-03', 'expense', true, 400000, ${accountA.id}, 'test'),
        (${householdA.id}, '2026-09-01', 'income', false, 10000000, ${accountA.id}, 'test'),
        (${householdA.id}, '2026-09-02', 'expense', false, 9000000, ${accountA.id}, 'test'),
        (${householdB.id}, '2026-01-02', 'income', false, 9000000, ${accountB.id}, 'test'),
        (${householdB.id}, '2026-01-03', 'expense', true, 8000000, ${accountB.id}, 'test')
    `

    const [assetA] = await raw`
      insert into asset_accounts (household_id, major, name, kind)
      values (${householdA.id}, '현금', 'A 현금', 'asset') returning id
    `
    const [assetB] = await raw`
      insert into asset_accounts (household_id, major, name, kind)
      values (${householdB.id}, '현금', 'B 현금', 'asset') returning id
    `
    await raw`
      insert into balance_snapshots (household_id, account_id, month, amount)
      values
        (${householdA.id}, ${assetA.id}, '2026-01', 1200000),
        (${householdB.id}, ${assetB.id}, '2026-01', 99000000)
    `

    const dashboard = await getDashboardData(householdA.id, 2026)
    const health = await getFinancialHealthData(householdA.id, new Date('2026-09-02T00:00:00Z'))

    expect(dashboard.accountMonthly.expense.accounts).toEqual(['A 카드'])
    expect(dashboard.accountMonthly.expense.series['A 카드'][0]).toBe(400_000)
    expect(dashboard.accountMonthly.expense.series['B 카드']).toBeUndefined()
    expect(health).toEqual([
      expect.objectContaining({ key: '저축률', value: '60.0%' }),
      expect.objectContaining({ key: '비상금', value: '3.0개월' }),
      expect.objectContaining({ key: '부채/자산 비율', value: '0%' }),
      expect.objectContaining({ key: '고정비 비율', value: '100%' }),
    ])
  })
})

describe('financial health', () => {
  test('uses the Flask signal boundaries in both directions', () => {
    expect(financialHealthSignal(30, 30, 10)).toBe('good')
    expect(financialHealthSignal(10, 30, 10)).toBe('ok')
    expect(financialHealthSignal(9.9, 30, 10)).toBe('warn')
    expect(financialHealthSignal(30, 30, 50, false)).toBe('good')
    expect(financialHealthSignal(50, 30, 50, false)).toBe('ok')
    expect(financialHealthSignal(50.1, 30, 50, false)).toBe('warn')
    expect(financialHealthSignal(null, 30, 10)).toBe('none')
  })

  test('calculates four indicators from completed months and latest balances', () => {
    expect(calculateFinancialHealth({
      income: 15_000_000,
      expense: 10_000_000,
      fixedExpense: 6_000_000,
      completedMonthCount: 2,
      balances: [
        { kind: 'asset', major: '현금', amount: 20_000_000 },
        { kind: 'asset', major: '저축·투자', amount: 10_000_000 },
        { kind: 'asset', major: '부동산', amount: 70_000_000 },
        { kind: 'liability', major: '대출', amount: 40_000_000 },
      ],
    })).toEqual([
      expect.objectContaining({ key: '저축률', value: '33.3%', status: 'good' }),
      expect.objectContaining({ key: '비상금', value: '6.0개월', status: 'good' }),
      expect.objectContaining({ key: '부채/자산 비율', value: '40%', status: 'ok' }),
      expect.objectContaining({ key: '고정비 비율', value: '60%', status: 'ok' }),
    ])
  })

  test('shows asset input guidance when no balance snapshot exists', () => {
    const result = calculateFinancialHealth({
      income: 0,
      expense: 0,
      fixedExpense: 0,
      completedMonthCount: 0,
      balances: [],
    })

    expect(result.map((item) => item.status)).toEqual(['none', 'none', 'none', 'none'])
    expect(result[1].value).toBe('자산 입력 필요')
    expect(result[2].value).toBe('자산 입력 필요')
  })
})

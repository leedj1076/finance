import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import { calculateMonthPace } from '@/features/analytics/home-pace'
import { buildHomeTodos, getHomeTodos } from '@/features/analytics/home-todos'
import {
  buildNetWorthSeries,
  getNetWorthSeries,
} from '@/features/analytics/net-worth'
import { getDashboardData } from '@/features/analytics/queries'

describe('home dashboard calculations', () => {
  test('carries account balances across months without snapshots', () => {
    expect(buildNetWorthSeries(
      [
        { id: 1, kind: 'asset' },
        { id: 2, kind: 'liability' },
      ],
      [
        { accountId: 1, month: '2026-06', amount: 10_000_000 },
        { accountId: 2, month: '2026-06', amount: 3_000_000 },
        { accountId: 1, month: '2026-08', amount: 12_000_000 },
      ],
      3,
      '2026-08',
    )).toEqual([
      { month: '2026-06', assets: 10_000_000, liabilities: 3_000_000, netWorth: 7_000_000 },
      { month: '2026-07', assets: 10_000_000, liabilities: 3_000_000, netWorth: 7_000_000 },
      { month: '2026-08', assets: 12_000_000, liabilities: 3_000_000, netWorth: 9_000_000 },
    ])
  })

  test('returns an empty series when no asset snapshot exists', () => {
    expect(buildNetWorthSeries([{ id: 1, kind: 'asset' }], [], 12, '2026-08')).toEqual([])
  })

  test('supports a household with liabilities only', () => {
    expect(buildNetWorthSeries(
      [{ id: 7, kind: 'liability' }],
      [{ accountId: 7, month: '2026-08', amount: 4_000_000 }],
      1,
      '2026-08',
    )).toEqual([
      { month: '2026-08', assets: 0, liabilities: 4_000_000, netWorth: -4_000_000 },
    ])
  })

  test('uses elapsed days for the current month and 100% for past months', () => {
    expect(calculateMonthPace('2026-09', '2026-09-20')).toEqual({
      elapsed: 20,
      daysInMonth: 30,
      ratio: 2 / 3,
      percent: (2 / 3) * 100,
    })
    expect(calculateMonthPace('2026-08', '2026-09-20')).toEqual({
      elapsed: 31,
      daysInMonth: 31,
      ratio: 1,
      percent: 100,
    })
  })

  test('orders home tasks by the fixed action priority', () => {
    const todos = buildHomeTodos({
      month: '2026-09',
      anomalies: [{ major: '식비', current: 400_000, typical: 100_000 }],
      paceWarnings: [{
        major: '쇼핑',
        budget: 300_000,
        actual: 250_000,
        projected: 500_000,
        overrun: 200_000,
        spentPercent: 83.3,
        progressPercent: 50,
      }],
      pendingInboxCount: 4,
      unclassifiedCount: 2,
      needsReview: true,
      ungeneratedRecurringCount: 3,
    })

    expect(todos.map((todo) => todo.kind)).toEqual([
      'anomaly',
      'pace',
      'inbox',
      'unclassified',
      'review',
      'recurring',
    ])
    expect(todos[0].href).toBe('/ledger?month=2026-09&tab=list&major=%EC%8B%9D%EB%B9%84')
    expect(todos[3].href).toBe('/inbox?tab=unclassified')
  })
})

describe('home dashboard query scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('isolates net worth and splits current fixed and variable expenses', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`insert into households (name) values (${`home-a-${suffix}`}) returning id`
    const [householdB] = await raw`insert into households (name) values (${`home-b-${suffix}`}) returning id`
    householdIds.push(householdA.id, householdB.id)

    await raw`
      insert into transactions (household_id, date, flow, fixed, amount, source)
      values
        (${householdA.id}, '2026-09-01', 'income', false, 10000000, 'test'),
        (${householdA.id}, '2026-09-02', 'expense', true, 3000000, 'test'),
        (${householdA.id}, '2026-09-03', 'expense', false, 1500000, 'test'),
        (${householdB.id}, '2026-09-02', 'expense', true, 99000000, 'test')
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
        (${householdA.id}, ${assetA.id}, '2026-09', 7000000),
        (${householdB.id}, ${assetB.id}, '2026-09', 99000000)
    `
    await raw`
      insert into import_inbox (household_id, import_uid, owner, date, amount, flow, status)
      values
        (${householdA.id}, ${`home-a-${suffix}`}, 'DJ', '2026-09-03', 1000, 'expense', 'pending'),
        (${householdB.id}, ${`home-b-${suffix}`}, 'YJ', '2026-09-03', 1000, 'expense', 'pending')
    `

    const dashboard = await getDashboardData(householdA.id, 2026, '2026-09')
    const netWorth = await getNetWorthSeries(householdA.id, 1)
    const todos = await getHomeTodos(householdA.id)

    expect(dashboard.current).toMatchObject({ fixedExpense: 3_000_000, variableExpense: 1_500_000 })
    expect(netWorth).toEqual([
      { month: '2026-09', assets: 7_000_000, liabilities: 0, netWorth: 7_000_000 },
    ])
    expect(todos.find((todo) => todo.kind === 'inbox')?.title).toBe('검토 대기 1건')
    expect(todos.find((todo) => todo.kind === 'unclassified')?.title).toBe('미분류 거래 3건')
  })
})

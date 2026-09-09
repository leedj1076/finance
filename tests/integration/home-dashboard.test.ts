import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import { calculateMonthPace } from '@/features/analytics/home-pace'
import { buildHomeTodos, getHomeTodos } from '@/features/analytics/home-todos'
import { getDashboardData } from '@/features/analytics/queries'

describe('home dashboard calculations', () => {
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
      closeTargets: [],
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
  const now = new Date('2026-09-09T03:00:00.000Z')

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('isolates household tasks and splits current fixed and variable expenses', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`insert into households (name) values (${`home-a-${suffix}`}) returning id`
    const [householdB] = await raw`insert into households (name) values (${`home-b-${suffix}`}) returning id`
    householdIds.push(householdA.id, householdB.id)

    await raw`
      insert into transactions (household_id, date, flow, fixed, amount, source)
      values
        (${householdA.id}, '2026-08-31', 'expense', false, 500000, 'test'),
        (${householdA.id}, '2026-09-01', 'income', false, 10000000, 'test'),
        (${householdA.id}, '2026-09-02', 'expense', true, 3000000, 'test'),
        (${householdA.id}, '2026-09-03', 'expense', false, 1500000, 'test'),
        (${householdB.id}, '2025-10-01', 'expense', false, 1000, 'test'),
        (${householdB.id}, '2026-09-02', 'expense', true, 99000000, 'test')
    `
    await raw`
      insert into import_inbox (household_id, import_uid, owner, date, amount, flow, status)
      values
        (${householdA.id}, ${`home-a-${suffix}`}, 'DJ', '2026-09-03', 1000, 'expense', 'pending'),
        (${householdB.id}, ${`home-b-${suffix}`}, 'YJ', '2026-09-03', 1000, 'expense', 'pending')
    `

    const dashboard = await getDashboardData(householdA.id, 2026, '2026-09')
    const todos = await getHomeTodos(householdA.id, now)

    expect(dashboard.current).toMatchObject({ fixedExpense: 3_000_000, variableExpense: 1_500_000 })
    expect(todos[0]).toMatchObject({ kind: 'close', title: '8월 마무리하기', href: '/ledger?month=2026-08' })
    expect(todos.find((todo) => todo.kind === 'inbox')?.title).toBe('검토 대기 1건')
    expect(todos.find((todo) => todo.kind === 'unclassified')?.title).toBe('미분류 거래 4건')
  })

  test('has no close task for an empty household', async () => {
    const suffix = Date.now()
    const [empty] = await raw`insert into households (name) values (${`home-empty-${suffix}`}) returning id`
    householdIds.push(empty.id)

    expect((await getHomeTodos(empty.id, now)).some((todo) => todo.kind === 'close')).toBe(false)
  })

  test('counts several review months while reopening the latest month', async () => {
    const suffix = Date.now()
    const [review] = await raw`insert into households (name) values (${`home-review-${suffix}`}) returning id`
    householdIds.push(review.id)

    await raw`
      insert into transactions (household_id, date, flow, fixed, amount, source)
      values
        (${review.id}, '2026-07-02', 'expense', false, 1000, 'test'),
        (${review.id}, '2026-08-02', 'expense', false, 2000, 'test')
    `
    await raw`
      insert into ledger_months (household_id, month, revision, closed_revision, closed_at, closed_by)
      values
        (${review.id}, '2026-07', 2, 1, '2026-08-01T00:00:00Z', ${review.id}),
        (${review.id}, '2026-08', 2, 1, '2026-09-01T00:00:00Z', ${review.id})
      on conflict (household_id, month) do update set
        revision = excluded.revision,
        closed_revision = excluded.closed_revision,
        closed_at = excluded.closed_at,
        closed_by = excluded.closed_by
    `

    expect((await getHomeTodos(review.id, now))[0]).toMatchObject({
      kind: 'close',
      title: '8월 다시 마감하기',
      detail: '마감 뒤 내역이 바뀌었습니다 · 2개월',
      href: '/ledger?month=2026-08',
    })
  })
})

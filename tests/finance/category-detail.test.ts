import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import {
  buildCategoryDetails,
  categoryDetailMonthlyAverage,
  getCellTransactions,
  parseCellTransactionParams,
  toggleCategoryDetailCell,
  type CategoryTaxonomyRow,
  type CategoryTransactionRow,
} from '@/features/analytics/category-detail'

const taxonomy: CategoryTaxonomyRow[] = [
  { kind: 'expense', major: '식비', sub: '외식', sortOrder: 10 },
  { kind: 'expense', major: '식비', sub: '장보기', sortOrder: 20 },
  { kind: 'expense', major: '교통', sub: '대중교통', sortOrder: 30 },
  { kind: 'income', major: '근로소득', sub: '급여', sortOrder: 10 },
]

function transaction(
  date: string,
  flow: CategoryTransactionRow['flow'],
  amount: number,
  major: string | null,
  sub: string | null,
): CategoryTransactionRow {
  return { date, flow, amount, major, sub }
}

describe('category detail matrix', () => {
  test('keeps taxonomy order, fills all months through the last active month, and counts completed active months', () => {
    const result = buildCategoryDetails({
      year: 2026,
      currentMonthKey: '2026-09',
      taxonomy,
      transactions: [
        transaction('2026-01-05', 'expense', 30_000, '식비', '외식'),
        transaction('2026-03-01', 'expense', 50_000, '식비', '외식'),
        transaction('2026-03-02', 'expense', 20_000, '식비', '장보기'),
        transaction('2026-09-01', 'expense', 90_000, '교통', '대중교통'),
        transaction('2026-08-25', 'income', 5_000_000, '근로소득', '급여'),
      ],
    })

    expect(result.expense).toMatchObject({
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      divisor: 3,
      currentMonth: 9,
    })
    expect(result.expense.groups.map((group) => group.major)).toEqual(['식비', '교통'])
    expect(result.expense.groups[0].subs.map((sub) => sub.sub)).toEqual(['외식', '장보기'])
    expect(result.expense.groups[0].subs[0].months).toEqual([
      30_000, 0, 50_000, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(result.expense.groups[1].subs[0].months[8]).toBe(90_000)
  })

  test('excludes the current month from averages and toggles cells immutably', () => {
    expect(categoryDetailMonthlyAverage(1_000_000, 400_000, 3)).toBe(200_000)

    const original = new Set(['식비|외식|1'])
    const restored = toggleCategoryDetailCell(original, '식비|외식|1')
    const added = toggleCategoryDetailCell(original, '식비|외식|2')

    expect(original).toEqual(new Set(['식비|외식|1']))
    expect(restored).toEqual(new Set())
    expect(added).toEqual(new Set(['식비|외식|1', '식비|외식|2']))
  })

  test('uses every active month for a past year and falls back to divisor one without transactions', () => {
    const past = buildCategoryDetails({
      year: 2025,
      currentMonthKey: '2026-09',
      taxonomy,
      transactions: [
        transaction('2025-02-01', 'expense', 10_000, '식비', '외식'),
        transaction('2025-12-01', 'saving', 20_000, null, null),
      ],
    })
    const empty = buildCategoryDetails({
      year: 2024,
      currentMonthKey: '2026-09',
      taxonomy,
      transactions: [],
    })

    expect(past.expense).toMatchObject({ months: [1, 2], divisor: 2, currentMonth: null })
    expect(empty.expense).toMatchObject({ months: [], divisor: 1, currentMonth: null })
    expect(empty.expense.groups).toHaveLength(2)
  })
})

describe('cell transaction request validation', () => {
  test('accepts a complete valid request and rejects invalid boundaries', () => {
    expect(parseCellTransactionParams(new URLSearchParams({
      flow: 'expense',
      year: '2026',
      month: '9',
      major: '식비',
      sub: '외식',
    }))).toEqual({ flow: 'expense', year: 2026, month: 9, major: '식비', sub: '외식' })

    expect(parseCellTransactionParams(new URLSearchParams({
      flow: 'other', year: '2026', month: '9', major: '식비', sub: '외식',
    }))).toBeNull()
    expect(parseCellTransactionParams(new URLSearchParams({
      flow: 'expense', year: '2026', month: '13', major: '식비', sub: '외식',
    }))).toBeNull()
    expect(parseCellTransactionParams(new URLSearchParams({
      flow: 'expense', year: '1999', month: '1', major: '', sub: '외식',
    }))).toBeNull()
  })
})

describe('cell transaction household scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) {
      await raw`delete from households where id in ${raw(householdIds)}`
    }
    await raw.end()
  })

  test('returns only the signed-in household rows even when category names match', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`
      insert into households (name) values (${`category-detail-a-${suffix}`}) returning id
    `
    const [householdB] = await raw`
      insert into households (name) values (${`category-detail-b-${suffix}`}) returning id
    `
    householdIds.push(householdA.id, householdB.id)

    const [categoryA] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdA.id}, 'expense', '식비', '외식') returning id
    `
    const [categoryB] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdB.id}, 'expense', '식비', '외식') returning id
    `
    const [accountA] = await raw`
      insert into accounts (household_id, name) values (${householdA.id}, 'A 카드') returning id
    `
    const [accountB] = await raw`
      insert into accounts (household_id, name) values (${householdB.id}, 'B 카드') returning id
    `
    await raw`
      insert into transactions
        (household_id, date, flow, category_id, amount, account_id, raw_merchant, memo)
      values
        (${householdA.id}, '2026-09-02', 'expense', ${categoryA.id}, 12000, ${accountA.id}, 'A 전용 가맹점', ''),
        (${householdA.id}, '2026-09-01', 'expense', ${categoryA.id}, 6000, ${accountA.id}, '', 'A 메모 내역'),
        (${householdB.id}, '2026-09-02', 'expense', ${categoryB.id}, 999999, ${accountB.id}, 'B 비밀 가맹점', '')
    `

    const result = await getCellTransactions(householdA.id, {
      flow: 'expense', year: 2026, month: 9, major: '식비', sub: '외식',
    })

    expect(result).toMatchObject({ total: 18_000, ym: '2026-09' })
    expect(result.items).toEqual([
      { date: '2026-09-02', name: 'A 전용 가맹점', amount: 12_000, acct: 'A 카드' },
      { date: '2026-09-01', name: 'A 메모 내역', amount: 6_000, acct: 'A 카드' },
    ])
  })
})

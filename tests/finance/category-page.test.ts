import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import {
  buildCategoryPageData,
  getCategoryPageData,
  parseCategoryPageParams,
  parsePositiveSafeInteger,
  roundOneDecimalLikePython,
  type CategoryPageRow,
} from '@/features/analytics/category-page'
import {
  categoryAnalysisUrl,
  categoryPageUrl,
} from '@/features/analytics/category-url'

function row(overrides: Partial<CategoryPageRow> & Pick<CategoryPageRow, 'id' | 'amount'>): CategoryPageRow {
  return {
    date: '2026-09-01',
    flow: 'expense',
    fixed: false,
    major: '식비',
    sub: '카페',
    memo: null,
    rawMerchant: null,
    accountId: null,
    accountName: null,
    ...overrides,
  }
}

describe('category page request and links', () => {
  test('accepts month aliases, infers annual periods, and validates flow/major/account', () => {
    expect(parseCategoryPageParams({
      flow: 'income',
      major: '  근로소득  ',
      month: '2026-08',
      ym: '2026-07',
      account: '0012',
    }, '2026-09')).toMatchObject({
      period: 'month',
      month: '2026-08',
      flow: 'income',
      major: '근로소득',
      accountId: 12,
      start: '2026-08-01',
      end: '2026-09-01',
    })
    expect(parseCategoryPageParams({
      flow: 'saving', major: '저축·투자', year: '2025',
    }, '2026-09')).toMatchObject({ period: 'year', year: 2025, flow: 'saving' })
    expect(parseCategoryPageParams({
      period: 'month', year: '2025', flow: 'other', major: 'x',
    }, '2026-09')).toMatchObject({ period: 'month', month: '2026-09', flow: 'expense' })
  })

  test('accepts only positive safe integer account ids', () => {
    expect(parsePositiveSafeInteger('12')).toBe(12)
    for (const invalid of [undefined, '', '0', '-1', '1.5', '1e2', '9007199254740992']) {
      expect(parsePositiveSafeInteger(invalid)).toBeNull()
    }
  })

  test('builds consistently encoded category and back links', () => {
    expect(categoryPageUrl({
      flow: 'expense', major: '식비/외식', period: { month: '2026-09' }, accountId: 12,
    })).toBe('/category?flow=expense&major=%EC%8B%9D%EB%B9%84%2F%EC%99%B8%EC%8B%9D&ym=2026-09&account=12')
    expect(categoryAnalysisUrl({
      flow: 'income', period: { year: 2026 }, accountId: null,
    })).toBe('/analysis?period=year&flow=income&year=2026')
  })
})

describe('category page aggregation', () => {
  test('sorts subcategories, merges normalized merchants, and orders transactions newest first', () => {
    const result = buildCategoryPageData([
      row({ id: 1, date: '2026-09-01', amount: 10_000, rawMerchant: '스타벅스 강남1점' }),
      row({ id: 2, date: '2026-09-02', amount: 15_000, rawMerchant: '스타벅스 강남2점' }),
      row({ id: 3, date: '2026-09-02', amount: 30_000, sub: '장보기', rawMerchant: '', memo: '우리 마트' }),
      row({ id: 4, date: '2026-09-03', amount: 100_000, major: '주거', sub: '월세' }),
    ], '식비')

    expect(result).toMatchObject({ categoryTotal: 55_000, periodTotal: 155_000, percent: 35.5 })
    expect(result.subs).toEqual([
      { sub: '장보기', amount: 30_000, count: 1 },
      { sub: '카페', amount: 25_000, count: 2 },
    ])
    expect(result.merchants).toEqual([
      { name: '우리 마트', amount: 30_000, count: 1 },
      { name: '스타벅스 강남1점', amount: 25_000, count: 2 },
    ])
    expect(result.transactions.map((transaction) => transaction.id)).toEqual([3, 2, 1])
  })

  test('supports uncategorized major/sub and matches Python half-even rounding', () => {
    const result = buildCategoryPageData([
      row({ id: 1, amount: 49, major: null, sub: null }),
      row({ id: 2, amount: 351, major: '기타', sub: '기타' }),
    ], '미분류')

    expect(roundOneDecimalLikePython(12.25)).toBe(12.2)
    expect(roundOneDecimalLikePython(12.35)).toBe(12.4)
    expect(result).toMatchObject({ categoryTotal: 49, periodTotal: 400, percent: 12.2 })
    expect(result.subs).toEqual([{ sub: '미분류', amount: 49, count: 1 }])
  })

  test('limits the merchant breakdown to the ten largest normalized merchants', () => {
    const result = buildCategoryPageData(
      Array.from({ length: 12 }, (_, index) => row({
        id: index + 1,
        amount: (index + 1) * 1_000,
        rawMerchant: `가맹점-${String.fromCharCode(65 + index)}`,
      })),
      '식비',
    )

    expect(result.merchants).toHaveLength(10)
    expect(result.merchants.map((merchant) => merchant.amount)).toEqual([
      12_000, 11_000, 10_000, 9_000, 8_000, 7_000, 6_000, 5_000, 4_000, 3_000,
    ])
  })
})

describe('category page household scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('isolates transactions and joins, applies a household account, and ignores a foreign account filter', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`insert into households (name) values (${`category-page-a-${suffix}`}) returning id`
    const [householdB] = await raw`insert into households (name) values (${`category-page-b-${suffix}`}) returning id`
    householdIds.push(householdA.id, householdB.id)

    const [categoryA] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdA.id}, 'expense', '식비', '외식') returning id
    `
    const [categoryB] = await raw`
      insert into categories (household_id, kind, major, sub)
      values (${householdB.id}, 'expense', '식비', '외식') returning id
    `
    const [accountA1] = await raw`
      insert into accounts (household_id, name) values (${householdA.id}, 'A1 카드') returning id
    `
    const [accountA2] = await raw`
      insert into accounts (household_id, name) values (${householdA.id}, 'A2 카드') returning id
    `
    const [accountB] = await raw`
      insert into accounts (household_id, name) values (${householdB.id}, 'B 카드') returning id
    `
    await raw`
      insert into transactions
        (household_id, date, flow, category_id, amount, account_id, raw_merchant, memo, source)
      values
        (${householdA.id}, '2026-09-01', 'expense', ${categoryA.id}, 12000, ${accountA1.id}, 'A 가맹점', 'A1 내역', 'test'),
        (${householdA.id}, '2026-09-02', 'expense', ${categoryA.id}, 20000, ${accountA2.id}, 'A2 가맹점', 'A2 내역', 'test'),
        (${householdA.id}, '2026-09-03', 'expense', null, 5000, ${accountA1.id}, '', '미분류', 'test'),
        (${householdB.id}, '2026-09-01', 'expense', ${categoryB.id}, 999999, ${accountB.id}, 'B 비밀', 'B 비밀', 'test')
    `

    const base = parseCategoryPageParams({ flow: 'expense', major: '식비', ym: '2026-09' }, '2026-09')
    const accountA1Id = Number(accountA1.id)
    const filtered = await getCategoryPageData(householdA.id, { ...base, accountId: accountA1Id })
    const foreignAccount = await getCategoryPageData(householdA.id, { ...base, accountId: Number(accountB.id) })

    expect(filtered).toMatchObject({ categoryTotal: 12_000, periodTotal: 17_000 })
    expect(filtered.transactions.map((transaction) => transaction.memo)).toEqual(['A1 내역'])
    expect(filtered.selectedAccount).toEqual({ id: accountA1Id, name: 'A1 카드' })
    expect(foreignAccount).toMatchObject({ categoryTotal: 32_000, periodTotal: 37_000, accountId: null })
    expect(foreignAccount.transactions.map((transaction) => transaction.memo)).toEqual(['A2 내역', 'A1 내역'])
    expect(foreignAccount.merchants.some((merchant) => merchant.name === 'B 비밀')).toBe(false)
  })
})

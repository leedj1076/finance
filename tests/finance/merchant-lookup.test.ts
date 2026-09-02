import postgres from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'

import {
  isAggregatorNorm,
  lookupMerchants,
  upsertMerchantLookup,
} from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'

const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
let householdId = ''
let otherHouseholdId = ''
let categoryId = 0
let otherCategoryId = 0

beforeAll(async () => {
  const suffix = Date.now()
  const [household] = await raw`
    insert into households (name) values (${`merchant-lookup-${suffix}`}) returning id
  `
  const [otherHousehold] = await raw`
    insert into households (name) values (${`merchant-lookup-other-${suffix}`}) returning id
  `
  householdId = household.id
  otherHouseholdId = otherHousehold.id

  const [category] = await raw`
    insert into categories (household_id, kind, major, sub)
    values (${householdId}, 'expense', '식비', '카페') returning id
  `
  const [otherCategory] = await raw`
    insert into categories (household_id, kind, major, sub)
    values (${otherHouseholdId}, 'expense', '기타', '기타') returning id
  `
  categoryId = Number(category.id)
  otherCategoryId = Number(otherCategory.id)
})

afterAll(async () => {
  if (householdId && otherHouseholdId) {
    await raw`delete from households where id in (${householdId}, ${otherHouseholdId})`
  }
  await raw.end()
})

test('user entries replace AI entries and cannot be overwritten by AI', async () => {
  const norm = normalizeMerchant('포스톤즈(FOURSTONES)')
  await upsertMerchantLookup(householdId, {
    normMerchant: norm,
    displayMerchant: '포스톤즈(FOURSTONES)',
    categoryId,
    flow: 'expense',
    businessType: '카페',
  }, 'ai')
  await upsertMerchantLookup(householdId, {
    normMerchant: norm,
    categoryId,
    flow: 'expense',
  }, 'user')
  await upsertMerchantLookup(householdId, {
    normMerchant: norm,
    categoryId: null,
    flow: 'expense',
  }, 'ai')

  const entries = await lookupMerchants(householdId, [norm])
  expect(entries.get(norm)).toMatchObject({
    source: 'user',
    categoryId,
    displayMerchant: '포스톤즈(FOURSTONES)',
    businessType: '카페',
  })
})

test('detects aggregator norms while keeping the delivery exception', () => {
  expect(isAggregatorNorm(normalizeMerchant('쿠팡_쿠페이'))).toBe(true)
  expect(isAggregatorNorm(normalizeMerchant('네이버페이 주식회사'))).toBe(true)
  expect(isAggregatorNorm(normalizeMerchant('11번가'))).toBe(true)
  expect(isAggregatorNorm(normalizeMerchant('쿠팡이츠'))).toBe(false)
  expect(isAggregatorNorm(normalizeMerchant('스타벅스'))).toBe(false)
})

test('keeps the existing history-key normalization semantics', () => {
  expect(normalizeMerchant(' 스타벅스 강남 12점 ')).toBe('스타벅스강남점')
  expect(normalizeMerchant('포스톤즈(FOURSTONES)')).toBe('포스톤즈(fourstones)')
  expect(normalizeMerchant(null)).toBe('')
})

test('lookup is restricted to requested norms and household', async () => {
  const norm = normalizeMerchant('가구별동일가맹점')
  await upsertMerchantLookup(householdId, {
    normMerchant: norm,
    categoryId,
    flow: 'expense',
  }, 'user')
  await upsertMerchantLookup(otherHouseholdId, {
    normMerchant: norm,
    categoryId: otherCategoryId,
    flow: 'expense',
  }, 'ai')

  const ownEntries = await lookupMerchants(householdId, [norm, norm, ''])
  const otherEntries = await lookupMerchants(otherHouseholdId, [norm])
  const missingEntries = await lookupMerchants(householdId, [normalizeMerchant('없는가게')])

  expect(ownEntries.size).toBe(1)
  expect(ownEntries.get(norm)?.categoryId).toBe(categoryId)
  expect(otherEntries.get(norm)?.categoryId).toBe(otherCategoryId)
  expect(missingEntries.size).toBe(0)
})

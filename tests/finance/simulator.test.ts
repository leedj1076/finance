import postgres from 'postgres'
import { afterAll, describe, expect, test } from 'vitest'

import { getBudgetData } from '@/features/budgets/queries'
import {
  budgetAmountsFromCuts,
  calculateVariableSpendSimulation,
  quickCutAmount,
} from '@/features/budgets/simulator-calculations'

describe('variable-spend simulator calculations', () => {
  test('updates the expected net savings rate and target gap from total cuts', () => {
    const belowTarget = calculateVariableSpendSimulation({
      averageIncome: 10_000_000,
      averageExpense: 8_000_000,
      savingsTarget: 30,
      cuts: { 식비: 300_000, 문화: '200000' },
    })
    expect(belowTarget).toMatchObject({
      totalCuts: 500_000,
      simulatedExpense: 7_500_000,
      savingsRate: 25,
      targetReached: false,
      progressPercent: 83.33333333333334,
    })
    expect(belowTarget.targetGap).toBeCloseTo(500_000)

    const aboveTarget = calculateVariableSpendSimulation({
      averageIncome: 10_000_000,
      averageExpense: 7_000_000,
      savingsTarget: 30,
      cuts: { 식비: 100_000 },
    })
    expect(aboveTarget).toMatchObject({
      savingsRate: 31,
      targetReached: true,
      progressPercent: 100,
    })
    expect(aboveTarget.targetGap).toBeCloseTo(-100_000)
  })

  test('handles no income, ignores negative cuts, and clamps expense at zero', () => {
    expect(calculateVariableSpendSimulation({
      averageIncome: 0,
      averageExpense: 1_000_000,
      savingsTarget: 30,
      cuts: { 식비: -500_000 },
    })).toEqual({
      totalCuts: 0,
      simulatedExpense: 1_000_000,
      savingsRate: 0,
      targetGap: 0,
      targetReached: true,
      progressPercent: 0,
    })

    expect(calculateVariableSpendSimulation({
      averageIncome: 2_000_000,
      averageExpense: 1_000_000,
      savingsTarget: 30,
      cuts: { 식비: 1_500_000 },
    })).toMatchObject({
      totalCuts: 1_500_000,
      simulatedExpense: 0,
      savingsRate: 100,
    })
  })

  test('uses Flask quick percentages and rounds applied budgets to the nearest thousand won', () => {
    expect(quickCutAmount(333_333, 10)).toBe(33_333)
    expect(quickCutAmount(333_333, 20)).toBe(66_667)

    expect(budgetAmountsFromCuts(
      [
        { major: '식비', average: 333_333 },
        { major: '문화', average: 125_499 },
        { major: '교통', average: 80_000 },
      ],
      { 식비: 33_333, 문화: 200_000, 교통: -10_000 },
    )).toEqual({
      식비: '300000',
      문화: '0',
    })
  })
})

describe('variable-spend averages household scope', () => {
  const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
  const householdIds: string[] = []

  afterAll(async () => {
    if (householdIds.length > 0) await raw`delete from households where id in ${raw(householdIds)}`
    await raw.end()
  })

  test('uses only completed-month transactions from the requested household', async () => {
    const suffix = Date.now()
    const [householdA] = await raw`
      insert into households (name) values (${`simulator-a-${suffix}`}) returning id
    `
    const [householdB] = await raw`
      insert into households (name) values (${`simulator-b-${suffix}`}) returning id
    `
    householdIds.push(householdA.id, householdB.id)

    const [foodA] = await raw`
      insert into categories (household_id, kind, major, sub, sort_order)
      values (${householdA.id}, 'expense', '식비', '장보기', 1) returning id
    `
    const [housingA] = await raw`
      insert into categories (household_id, kind, major, sub, sort_order)
      values (${householdA.id}, 'expense', '주거', '월세', 2) returning id
    `
    const [foodB] = await raw`
      insert into categories (household_id, kind, major, sub, sort_order)
      values (${householdB.id}, 'expense', '식비', '장보기', 1) returning id
    `

    await raw`
      insert into transactions (household_id, date, flow, fixed, amount, category_id, source)
      values
        (${householdA.id}, '2026-01-01', 'income', false, 2000000, null, 'test'),
        (${householdA.id}, '2026-01-02', 'expense', false, 200000, ${foodA.id}, 'test'),
        (${householdA.id}, '2026-01-03', 'expense', true, 500000, ${housingA.id}, 'test'),
        (${householdA.id}, '2026-02-01', 'income', false, 4000000, null, 'test'),
        (${householdA.id}, '2026-02-02', 'expense', false, 400000, ${foodA.id}, 'test'),
        (${householdA.id}, '2026-02-03', 'expense', true, 500000, ${housingA.id}, 'test'),
        (${householdA.id}, '2026-09-01', 'income', false, 90000000, null, 'test'),
        (${householdA.id}, '2026-09-02', 'expense', false, 80000000, ${foodA.id}, 'test'),
        (${householdB.id}, '2026-01-01', 'income', false, 100000000, null, 'test'),
        (${householdB.id}, '2026-01-02', 'expense', false, 90000000, ${foodB.id}, 'test')
    `

    const data = await getBudgetData(householdA.id, '2026-09')

    expect(data.averageIncome).toBe(3_000_000)
    expect(data.averageExpense).toBe(800_000)
    expect(data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ major: '식비', group: 'variable', average: 300_000 }),
      expect.objectContaining({ major: '주거', group: 'fixed', average: 500_000 }),
    ]))
  })
})

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots, transactions } from '@/db/schema'
import { currentMonthInKorea, savingsRate } from '@/lib/finance'

export type FinancialHealthStatus = 'good' | 'ok' | 'warn' | 'none'

export type FinancialHealthBalance = {
  kind: string
  major: string
  amount: number
}

export type FinancialHealthItem = {
  key: string
  value: string
  status: FinancialHealthStatus
  hint: string
}

export function financialHealthSignal(
  value: number | null,
  good: number,
  ok: number,
  higherBetter = true,
): FinancialHealthStatus {
  if (value === null) return 'none'
  const goodEnough = higherBetter ? value >= good : value <= good
  const okEnough = higherBetter ? value >= ok : value <= ok
  return goodEnough ? 'good' : okEnough ? 'ok' : 'warn'
}

export function calculateFinancialHealth({
  income,
  expense,
  fixedExpense,
  completedMonthCount,
  balances,
}: {
  income: number
  expense: number
  fixedExpense: number
  completedMonthCount: number
  balances: FinancialHealthBalance[]
}): FinancialHealthItem[] {
  const divisor = completedMonthCount || 1
  const averageExpense = expense / divisor
  const hasAssets = balances.length > 0
  const assets = balances
    .filter((row) => row.kind === 'asset')
    .reduce((sum, row) => sum + row.amount, 0)
  const debt = balances
    .filter((row) => row.kind === 'liability')
    .reduce((sum, row) => sum + row.amount, 0)
  const cash = balances
    .filter((row) => row.kind === 'asset' && (row.major === '현금' || row.major === '저축·투자'))
    .reduce((sum, row) => sum + row.amount, 0)

  const saveRate = income > 0 ? savingsRate(income, expense) : null
  const emergencyMonths = averageExpense > 0 && hasAssets ? cash / averageExpense : null
  const debtRatio = assets > 0 ? (debt / assets) * 100 : hasAssets ? 0 : null
  const fixedRatio = expense > 0 ? (fixedExpense / expense) * 100 : null

  return [
    {
      key: '저축률',
      value: saveRate === null ? '-' : `${saveRate.toFixed(1)}%`,
      status: financialHealthSignal(saveRate, 30, 10),
      hint: '순저축률 (수입−지출) ÷ 수입, 목표 30%',
    },
    {
      key: '비상금',
      value: emergencyMonths === null ? '자산 입력 필요' : `${emergencyMonths.toFixed(1)}개월`,
      status: financialHealthSignal(emergencyMonths, 6, 3),
      hint: '생활비 3~6개월치 권장',
    },
    {
      key: '부채/자산 비율',
      value: debtRatio === null ? '자산 입력 필요' : `${debtRatio.toFixed(0)}%`,
      status: financialHealthSignal(debtRatio, 30, 50, false),
      hint: '부채 ÷ 총자산, 낮을수록 안전 (DTI와 별도)',
    },
    {
      key: '고정비 비율',
      value: fixedRatio === null ? '-' : `${fixedRatio.toFixed(0)}%`,
      status: financialHealthSignal(fixedRatio, 50, 65, false),
      hint: '지출 중 고정비, 낮을수록 유연',
    },
  ]
}

export async function getFinancialHealthData(householdId: string, now = new Date()) {
  const currentMonth = currentMonthInKorea(now)
  const yearStart = `${currentMonth.slice(0, 4)}-01-01`
  const completedEnd = `${currentMonth}-01`

  const [transactionRows, snapshotRows] = await Promise.all([
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.flow} = 'income' then ${transactions.amount} else 0 end), 0)`,
        expense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' then ${transactions.amount} else 0 end), 0)`,
        fixedExpense: sql<string>`coalesce(sum(case when ${transactions.flow} = 'expense' and ${transactions.fixed} then ${transactions.amount} else 0 end), 0)`,
        completedMonthCount: sql<string>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, yearStart),
          lt(transactions.date, completedEnd),
        ),
      ),
    db
      .selectDistinctOn([balanceSnapshots.accountId], {
        accountId: balanceSnapshots.accountId,
        kind: assetAccounts.kind,
        major: assetAccounts.major,
        amount: balanceSnapshots.amount,
      })
      .from(balanceSnapshots)
      .innerJoin(
        assetAccounts,
        and(
          eq(assetAccounts.id, balanceSnapshots.accountId),
          eq(assetAccounts.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(balanceSnapshots.householdId, householdId),
          eq(assetAccounts.householdId, householdId),
        ),
      )
      .orderBy(balanceSnapshots.accountId, desc(balanceSnapshots.month)),
  ])

  const totals = transactionRows[0]
  return calculateFinancialHealth({
    income: Number(totals?.income ?? 0),
    expense: Number(totals?.expense ?? 0),
    fixedExpense: Number(totals?.fixedExpense ?? 0),
    completedMonthCount: Number(totals?.completedMonthCount ?? 0),
    balances: snapshotRows.map((row) => ({
      kind: row.kind,
      major: row.major,
      amount: Number(row.amount),
    })),
  })
}

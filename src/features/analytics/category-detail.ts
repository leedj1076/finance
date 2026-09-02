import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { accounts, categories, transactions } from '@/db/schema'
import { currentMonthInKorea } from '@/lib/finance'

export type CategoryDetailFlow = 'expense' | 'income' | 'saving'

export type CategoryTaxonomyRow = {
  kind: CategoryDetailFlow
  major: string
  sub: string
  sortOrder: number
}

export type CategoryTransactionRow = {
  date: string
  flow: CategoryDetailFlow
  amount: number
  major: string | null
  sub: string | null
}

export type CategoryDetailGroup = {
  major: string
  subs: Array<{
    sub: string
    months: number[]
  }>
}

export type CategoryDetail = {
  groups: CategoryDetailGroup[]
  months: number[]
  divisor: number
  currentMonth: number | null
}

export type CategoryDetails = Record<CategoryDetailFlow, CategoryDetail>

export type CellTransactionParams = {
  flow: CategoryDetailFlow
  year: number
  month: number
  major: string
  sub: string
}

export type CellTransactionResult = {
  major: string
  sub: string
  ym: string
  total: number
  items: Array<{
    date: string
    name: string
    amount: number
    acct: string
  }>
}

const FLOWS: CategoryDetailFlow[] = ['expense', 'income', 'saving']

function blankDetails(): CategoryDetails {
  return {
    expense: { groups: [], months: [], divisor: 1, currentMonth: null },
    income: { groups: [], months: [], divisor: 1, currentMonth: null },
    saving: { groups: [], months: [], divisor: 1, currentMonth: null },
  }
}

/**
 * Build the Flask category_detail response for all three flows in one pass.
 * The divisor deliberately counts distinct household transaction months across
 * every flow, matching Flask months_elapsed rather than the visible flow only.
 */
export function buildCategoryDetails({
  year,
  currentMonthKey,
  taxonomy,
  transactions: transactionRows,
}: {
  year: number
  currentMonthKey: string
  taxonomy: CategoryTaxonomyRow[]
  transactions: CategoryTransactionRow[]
}): CategoryDetails {
  const details = blankDetails()
  const currentYear = Number(currentMonthKey.slice(0, 4))
  const currentMonth = Number(currentMonthKey.slice(5, 7))
  const yearPrefix = `${year}-`
  const yearRows = transactionRows.filter((row) => row.date.startsWith(yearPrefix))
  const completedMonths = new Set(
    yearRows
      .map((row) => Number(row.date.slice(5, 7)))
      .filter((month) => year !== currentYear || month < currentMonth),
  )
  const divisor = completedMonths.size || 1

  for (const flow of FLOWS) {
    const groups: CategoryDetailGroup[] = []
    const groupMap = new Map<string, CategoryDetailGroup>()
    for (const category of taxonomy) {
      if (category.kind !== flow || category.major === '미분류') continue
      let group = groupMap.get(category.major)
      if (!group) {
        group = { major: category.major, subs: [] }
        groupMap.set(category.major, group)
        groups.push(group)
      }
      group.subs.push({ sub: category.sub, months: Array<number>(12).fill(0) })
    }

    const subMap = new Map<string, CategoryDetailGroup['subs'][number]>()
    for (const group of groups) {
      for (const sub of group.subs) subMap.set(`${group.major}\u0000${sub.sub}`, sub)
    }

    const activeMonths = new Set<number>()
    for (const row of yearRows) {
      if (row.flow !== flow || row.major === null || row.sub === null) continue
      const month = Number(row.date.slice(5, 7))
      if (!Number.isInteger(month) || month < 1 || month > 12) continue
      activeMonths.add(month)
      const sub = subMap.get(`${row.major}\u0000${row.sub}`)
      if (sub) sub.months[month - 1] += row.amount
    }

    const lastActiveMonth = activeMonths.size > 0 ? Math.max(...activeMonths) : 0
    details[flow] = {
      groups,
      months: Array.from({ length: lastActiveMonth }, (_, index) => index + 1),
      divisor,
      currentMonth: year === currentYear ? currentMonth : null,
    }
  }

  return details
}

export async function getCategoryDetails(
  householdId: string,
  year: number,
): Promise<CategoryDetails> {
  const start = `${year}-01-01`
  const end = `${year + 1}-01-01`
  const [taxonomyRows, transactionRows] = await Promise.all([
    db
      .select({
        kind: categories.kind,
        major: categories.major,
        sub: categories.sub,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categories.hidden, false),
          sql`${categories.major} <> '미분류'`,
        ),
      )
      .orderBy(asc(categories.sortOrder), asc(categories.id)),
    db
      .select({
        date: transactions.date,
        flow: transactions.flow,
        amount: transactions.amount,
        major: categories.major,
        sub: categories.sub,
      })
      .from(transactions)
      .leftJoin(
        categories,
        and(
          eq(categories.id, transactions.categoryId),
          eq(categories.householdId, householdId),
        ),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          gte(transactions.date, start),
          lt(transactions.date, end),
        ),
      ),
  ])

  return buildCategoryDetails({
    year,
    currentMonthKey: currentMonthInKorea(),
    taxonomy: taxonomyRows,
    transactions: transactionRows,
  })
}

export function parseCellTransactionParams(
  searchParams: URLSearchParams,
): CellTransactionParams | null {
  const flow = searchParams.get('flow')
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))
  const major = searchParams.get('major')?.trim() ?? ''
  const sub = searchParams.get('sub')?.trim() ?? ''

  if (
    (flow !== 'expense' && flow !== 'income' && flow !== 'saving')
    || !Number.isInteger(year)
    || year < 2000
    || year > 2100
    || !Number.isInteger(month)
    || month < 1
    || month > 12
    || major.length === 0
    || sub.length === 0
    || major.length > 100
    || sub.length > 100
  ) return null

  return { flow, year, month, major, sub }
}

export async function getCellTransactions(
  householdId: string,
  params: CellTransactionParams,
): Promise<CellTransactionResult> {
  const ym = `${params.year}-${String(params.month).padStart(2, '0')}`
  const start = `${ym}-01`
  const end = params.month === 12
    ? `${params.year + 1}-01-01`
    : `${params.year}-${String(params.month + 1).padStart(2, '0')}-01`
  const rows = await db
    .select({
      date: transactions.date,
      name: sql<string>`coalesce(nullif(${transactions.rawMerchant}, ''), nullif(${transactions.memo}, ''), '(내역 없음)')`,
      amount: transactions.amount,
      acct: sql<string>`coalesce(${accounts.name}, '')`,
    })
    .from(transactions)
    .innerJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.householdId, householdId),
      ),
    )
    .leftJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.householdId, householdId),
      ),
    )
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.flow, params.flow),
        eq(categories.major, params.major),
        eq(categories.sub, params.sub),
        gte(transactions.date, start),
        lt(transactions.date, end),
      ),
    )
    .orderBy(desc(transactions.amount), asc(transactions.date), asc(transactions.id))

  return {
    major: params.major,
    sub: params.sub,
    ym,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    items: rows,
  }
}

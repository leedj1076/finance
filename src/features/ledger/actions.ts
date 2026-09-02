'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { accounts, categories, transactions } from '@/db/schema'
import { isMonthKey } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

import { parseTransactionInput } from './transaction-input'
import { ledgerFiltersFromFormData, ledgerUrl } from './filters'

export type TransactionActionState = {
  error?: string
}

export async function saveTransaction(
  _previousState: TransactionActionState,
  formData: FormData,
): Promise<TransactionActionState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }

  const parsed = parseTransactionInput(formData)
  if ('error' in parsed) return { error: parsed.error }
  const input = parsed.data

  if (input.categoryId !== null) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, input.categoryId),
          eq(categories.householdId, household.householdId),
          eq(categories.kind, input.flow),
        ),
      )
      .limit(1)
    if (!category) return { error: '이 거래 유형에 사용할 수 없는 분류입니다.' }
  }

  if (input.accountId !== null) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, input.accountId),
          eq(accounts.householdId, household.householdId),
        ),
      )
      .limit(1)
    if (!account) return { error: '이 가족 가계부에 없는 결제수단입니다.' }
  }

  const values = {
    date: input.date,
    flow: input.flow,
    fixed: input.fixed,
    categoryId: input.categoryId,
    memo: input.memo,
    amount: input.amount,
    accountId: input.accountId,
  }

  if (input.id === null) {
    await db.insert(transactions).values({
      householdId: household.householdId,
      source: 'manual',
      ...values,
    })
  } else {
    await db
      .update(transactions)
      .set(values)
      .where(
        and(
          eq(transactions.id, input.id),
          eq(transactions.householdId, household.householdId),
        ),
      )
  }

  revalidatePath('/ledger')
  redirect(ledgerUrl(input.month, ledgerFiltersFromFormData(formData)))
}

export async function deleteTransaction(formData: FormData) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const id = Number(formData.get('transactionId'))
  if (Number.isSafeInteger(id) && id > 0) {
    await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.id, id),
          eq(transactions.householdId, household.householdId),
        ),
      )
  }

  const requestedMonth = formData.get('month')
  const month = typeof requestedMonth === 'string' && isMonthKey(requestedMonth)
    ? requestedMonth
    : undefined
  revalidatePath('/ledger')
  redirect(month
    ? ledgerUrl(month, ledgerFiltersFromFormData(formData))
    : '/ledger')
}

'use server'

import { and, eq, inArray, notExists } from 'drizzle-orm'

import { db } from '@/db/client'
import { importInbox, transactions } from '@/db/schema'
import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'

import { getInboxHistoryItems } from './history-queries'
import type { InboxHistoryPage, InboxHistoryRequest } from './history-types'
import { refreshDuplicateFlags } from './staging'

export async function loadInboxHistoryItems(request: InboxHistoryRequest): Promise<{ data: InboxHistoryPage; error?: never } | { data?: never; error: string }> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  if (!request || typeof request.source !== 'string' || request.source.length > 100
    || typeof request.processedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(request.processedOn)
    || !['all', 'pending', 'done', 'dismissed'].includes(request.status)
    || !Number.isSafeInteger(request.page) || request.page < 1) {
    return { error: '처리 기록 조회 조건이 올바르지 않습니다.' }
  }
  return { data: await getInboxHistoryItems(household.householdId, request) }
}

export async function restoreInboxItems(ids: number[]): Promise<{ restoredIds: number[]; message: string; error?: never } | { error: string; restoredIds?: never }> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { error: '복원할 항목을 선택해 주세요.' }
  }
  if (ids.length > 500) return { error: '한 번에 최대 500건까지 복원할 수 있습니다.' }
  const householdId = household.householdId
  const restored = await db.transaction(async (tx) => {
    const rows = await tx.update(importInbox).set({ status: 'pending', confidence: 'review' }).where(and(
      eq(importInbox.householdId, householdId), eq(importInbox.status, 'dismissed'),
      inArray(importInbox.id, [...new Set(ids)]),
      notExists(tx.select({ id: transactions.id }).from(transactions).where(and(
        eq(transactions.householdId, householdId), eq(transactions.importUid, importInbox.importUid),
      ))),
    )).returning({ id: importInbox.id })
    if (rows.length) await refreshDuplicateFlags(householdId, tx)
    return rows
  })
  revalidateFinance('inbox')
  return {
    restoredIds: restored.map((row) => row.id),
    message: restored.length ? `${restored.length}건을 검토 대기로 보냈습니다.` : '복원할 항목이 없습니다. 이미 처리된 항목은 복원하지 않습니다.',
  }
}

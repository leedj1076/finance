import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { ledgerMonths } from '@/db/schema'
import { readMonthCloseSummary } from './queries'
import { canCloseMonth, validCloseInput, validLedgerMonth, type CloseMonthInput } from './state'

export type MonthCloseResult = { ok: boolean; error?: string }

export async function closeMonth(householdId: string, userId: string, input: CloseMonthInput): Promise<MonthCloseResult> {
  if (!validCloseInput(input)) return { ok: false, error: '월 또는 확인한 버전이 올바르지 않습니다.' }
  if (!canCloseMonth(input.month)) return { ok: false, error: '한국 시간 기준으로 끝난 월만 마감할 수 있습니다.' }
  if (!userId) return { ok: false, error: '로그인이 필요합니다.' }
  return db.transaction(async tx => {
    await tx.insert(ledgerMonths).values({ householdId, month: input.month }).onConflictDoNothing()
    const key = and(eq(ledgerMonths.householdId, householdId), eq(ledgerMonths.month, input.month))
    // The transaction trigger takes this same lock. A later ledger write always
    // advances revision, including when it began before this close acquired it.
    const [row] = await tx.select().from(ledgerMonths).where(key).for('update')
    if (row.revision !== input.revision) return { ok: false, error: '확인 중 내역이 변경되었습니다. 최신 요약을 다시 확인해 주세요.' }
    if (row.closedAt && row.closedRevision === row.revision) return { ok: true }
    const summary = await readMonthCloseSummary(tx, householdId, input.month)
    if (summary.requiresAcknowledgment && !input.acknowledgeWarnings) return { ok: false, error: '대기·미분류·미반영 항목을 확인해 주세요.' }
    if (summary.count === 0 && !input.acknowledgeEmpty) return { ok: false, error: '거래 없는 월로 마감하는지 확인해 주세요.' }
    await tx.update(ledgerMonths).set({ closedRevision: row.revision, closedAt: new Date(), closedBy: userId, updatedAt: new Date() }).where(key)
    return { ok: true }
  })
}

export async function reopenMonth(householdId: string, month: string): Promise<MonthCloseResult> {
  if (!validLedgerMonth(month)) return { ok: false, error: '올바른 월을 선택해 주세요.' }
  await db.update(ledgerMonths).set({ closedRevision: null, updatedAt: new Date() })
    .where(and(eq(ledgerMonths.householdId, householdId), eq(ledgerMonths.month, month)))
  return { ok: true }
}

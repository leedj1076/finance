import { db } from '@/db/client'
import { readMonthStatuses, type MonthReader } from './queries'
import type { MonthStatus } from './state'

/** Notices are best-effort UX; the DB trigger is the actual safety boundary. */
export async function captureClosedMonths(householdId: string, dates: string[], reader: MonthReader = db) {
  const months = await readMonthStatuses(reader, householdId, dates.map(date => date.slice(0, 7)))
  return months.filter(month => month.state === 'closed')
}

export async function reopenedMonthNotice(householdId: string, before: MonthStatus[], reader: MonthReader = db) {
  if (!before.length) return ''
  const after = await readMonthStatuses(reader, householdId, before.map(row => row.month))
  const revisions = new Map(before.map(row => [row.month, row.revision]))
  const changed = after.filter(row => row.state === 'needs_review' && row.revision !== revisions.get(row.month)).map(row => row.month).sort()
  return changed.length ? ` ${changed.join(' · ')} 마감이 해제되었습니다. 다시 마감하면 통계에 반영됩니다.` : ''
}

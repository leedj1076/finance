import type { SupabaseClient } from '@supabase/supabase-js'
import { getMonthCloseSummary } from '../../src/features/month-close/queries'
import { closeMonth } from '../../src/features/month-close/service'

/** Known, reviewed test fixtures only. No historical production auto-closing. */
export async function closeFixtureMonths(admin: SupabaseClient, householdId: string, months: string[]) {
  for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.DATABASE_URL]) {
    if (!value || !['127.0.0.1', 'localhost'].includes(new URL(value).hostname)) throw new Error('Month closing fixtures require local databases')
  }
  const { data: member, error } = await admin.from('household_members').select('user_id').eq('household_id', householdId).limit(1).single()
  if (error) throw error
  for (const month of months) {
    const summary = await getMonthCloseSummary(householdId, month)
    const result = await closeMonth(householdId, member.user_id, { month, revision: summary.revision, acknowledgeWarnings: true, acknowledgeEmpty: true })
    if (!result.ok) throw new Error(result.error)
  }
}

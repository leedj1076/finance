import { createServerSupabase } from './supabase/server'

export type HouseholdContext = {
  userId: string
  householdId: string
}

/**
 * Resolve the signed-in user's household. The returned householdId is a
 * mandatory predicate for every Drizzle domain query because the owner
 * DATABASE_URL bypasses RLS.
 */
export async function requireHousehold(): Promise<HouseholdContext | null> {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null

  return { userId: user.id, householdId: data.household_id }
}

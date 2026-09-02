import { eq } from 'drizzle-orm'
import { cache } from 'react'

import { db } from '@/db/client'
import { householdMembers } from '@/db/schema'

import { createServerSupabase } from './supabase/server'

export type HouseholdContext = {
  userId: string
  householdId: string
  email: string
}

export type AuthContext = Omit<HouseholdContext, 'householdId'>

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  const email = data?.claims?.email
  if (error || typeof userId !== 'string' || typeof email !== 'string') return null

  return { userId, email }
})

/**
 * Resolve the signed-in user's household. The returned householdId is a
 * mandatory predicate for every Drizzle domain query because the owner
 * DATABASE_URL bypasses RLS.
 */
export const requireHousehold = cache(async (): Promise<HouseholdContext | null> => {
  const auth = await getAuthContext()
  if (!auth) return null

  const [membership] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, auth.userId))
    .limit(1)
  if (!membership) return null

  return { ...auth, householdId: membership.householdId }
})

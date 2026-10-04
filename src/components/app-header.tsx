import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { importInbox } from '@/db/schema'
import { requireHousehold } from '@/lib/household'
import type { Space } from '@/features/investment/space'

import { AppHeaderMenu, type HeaderSection } from './app-header-menu'

type AppHeaderProps = {
  active: HeaderSection
  email: string
  space?: Space
}

export async function AppHeader({ active, email, space = 'ledger' }: AppHeaderProps) {
  const household = await requireHousehold()
  let pendingInboxCount = 0
  if (household && space === 'ledger') {
    const [row] = await db
      .select({ value: sql<number>`count(*)` })
      .from(importInbox)
      .where(and(
        eq(importInbox.householdId, household.householdId),
        eq(importInbox.status, 'pending'),
      ))
    pendingInboxCount = Number(row?.value ?? 0)
  }

  return <AppHeaderMenu active={active} email={email} pendingInboxCount={pendingInboxCount} space={space} />
}

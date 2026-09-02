import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { importInbox } from '@/db/schema'
import { requireHousehold } from '@/lib/household'

import { AppHeaderMenu, type HeaderSection } from './app-header-menu'

type AppHeaderProps = {
  active: HeaderSection
  email: string
}

export async function AppHeader({ active, email }: AppHeaderProps) {
  const household = await requireHousehold()
  let pendingInboxCount = 0
  if (household) {
    const [row] = await db
      .select({ value: sql<number>`count(*)` })
      .from(importInbox)
      .where(and(
        eq(importInbox.householdId, household.householdId),
        eq(importInbox.status, 'pending'),
      ))
    pendingInboxCount = Number(row?.value ?? 0)
  }

  return <AppHeaderMenu active={active} email={email} pendingInboxCount={pendingInboxCount} />
}

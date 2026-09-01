import { sql } from 'drizzle-orm'
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { memberRoleEnum } from '../enums'

export const households = pgTable('households', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Supabase owns auth.users, so the cross-schema foreign key is added by the
// handwritten RLS migration instead of being modeled by Drizzle.
export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: memberRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.userId] })],
)

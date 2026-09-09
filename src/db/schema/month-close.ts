import { sql } from 'drizzle-orm'
import { bigint, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { households } from './auth'

export const ledgerMonths = pgTable('ledger_months', {
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  closedRevision: bigint('closed_revision', { mode: 'number' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.householdId, table.month] }),
  check('ledger_month_valid', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and ${table.month} >= '0001-01'`),
  check('ledger_month_revision_valid', sql`${table.revision} >= 0 and (${table.closedRevision} is null or (${table.closedRevision} >= 0 and ${table.closedRevision} <= ${table.revision} and ${table.closedAt} is not null and ${table.closedBy} is not null))`),
])

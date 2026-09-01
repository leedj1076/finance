import { bigint, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core'

import { households } from './auth'

export const budgets = pgTable(
  'budgets',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    major: text('major').notNull(),
    month: text('month').notNull().default('*'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (table) => [unique('budgets_household_major_month').on(table.householdId, table.major, table.month)],
)

export const settings = pgTable(
  'settings',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value'),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.key] })],
)

import { bigint, boolean, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { households } from './auth'

export const assetAccounts = pgTable(
  'asset_accounts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    major: text('major').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (table) => [unique('asset_accounts_household_major_name').on(table.householdId, table.major, table.name)],
)

export const balanceSnapshots = pgTable(
  'balance_snapshots',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    accountId: bigint('account_id', { mode: 'number' })
      .notNull()
      .references(() => assetAccounts.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (table) => [
    unique('balance_snapshots_household_account_month').on(
      table.householdId,
      table.accountId,
      table.month,
    ),
  ],
)

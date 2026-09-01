import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { flowEnum } from '../enums'
import { households } from './auth'
import { accounts, categories } from './taxonomy'

export const importBatches = pgTable('import_batches', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  filename: text('filename'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  rowCount: integer('row_count').notNull().default(0),
})

export const recurring = pgTable('recurring', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  flow: flowEnum('flow').notNull(),
  fixed: boolean('fixed').notNull().default(true),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
  memo: text('memo'),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  accountId: bigint('account_id', { mode: 'number' }).references(() => accounts.id),
  day: integer('day').notNull().default(1),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const transactions = pgTable(
  'transactions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    flow: flowEnum('flow').notNull(),
    fixed: boolean('fixed').notNull().default(false),
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    memo: text('memo'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    accountId: bigint('account_id', { mode: 'number' }).references(() => accounts.id),
    source: text('source').notNull().default('manual'),
    rawMerchant: text('raw_merchant'),
    importBatchId: bigint('import_batch_id', { mode: 'number' }).references(() => importBatches.id),
    recurringId: bigint('recurring_id', { mode: 'number' }).references(() => recurring.id),
    importUid: text('import_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tx_household_date').on(table.householdId, table.date),
    unique('tx_household_import_uid').on(table.householdId, table.importUid),
  ],
)

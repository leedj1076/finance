import { bigint, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { flowEnum, inboxKindEnum, inboxStatusEnum } from '../enums'
import { households } from './auth'
import { accounts, categories } from './taxonomy'

export const importInbox = pgTable(
  'import_inbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    importUid: text('import_uid').notNull(),
    owner: text('owner').notNull(),
    date: text('date').notNull(),
    time: text('time'),
    merchant: text('merchant'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    flow: flowEnum('flow').notNull(),
    kind: inboxKindEnum('kind').notNull().default('normal'),
    bsCat1: text('bs_cat1'),
    bsCat2: text('bs_cat2'),
    pay: text('pay'),
    accountId: bigint('account_id', { mode: 'number' }).references(() => accounts.id),
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    memo: text('memo'),
    sugSource: text('sug_source'),
    dupNote: text('dup_note'),
    status: inboxStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('inbox_household_import_uid').on(table.householdId, table.importUid),
    index('inbox_household_status').on(table.householdId, table.status),
  ],
)

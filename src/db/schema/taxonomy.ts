import {
  bigint,
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { categoryKindEnum, flowEnum } from '../enums'
import { households } from './auth'

export const accounts = pgTable(
  'accounts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    owner: text('owner'),
    type: text('type'),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    memo: text('memo'),
  },
  (table) => [unique('accounts_household_name').on(table.householdId, table.name)],
)

export const categories = pgTable(
  'categories',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    kind: categoryKindEnum('kind').notNull(),
    major: text('major').notNull(),
    sub: text('sub').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    hidden: boolean('hidden').notNull().default(false),
  },
  (table) => [
    unique('categories_household_kind_major_sub').on(
      table.householdId,
      table.kind,
      table.major,
      table.sub,
    ),
  ],
)

export const categoryMeta = pgTable(
  'category_meta',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    major: text('major').notNull(),
    irregular: boolean('irregular').notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.major] })],
)

export const categoryRules = pgTable(
  'category_rules',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull(),
    pattern: text('pattern').notNull(),
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    accountId: bigint('account_id', { mode: 'number' }).references(() => accounts.id),
    flow: flowEnum('flow'),
    fixed: boolean('fixed'),
    priority: integer('priority').notNull().default(100),
    hits: integer('hits').notNull().default(0),
  },
  (table) => [
    unique('category_rules_household_type_pattern').on(
      table.householdId,
      table.matchType,
      table.pattern,
    ),
  ],
)

export const accountAliases = pgTable(
  'account_aliases',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    alias: text('alias').notNull(),
    accountId: bigint('account_id', { mode: 'number' })
      .notNull()
      .references(() => accounts.id),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.owner, table.alias] })],
)

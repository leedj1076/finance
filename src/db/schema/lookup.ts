import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { flowEnum } from '../enums'
import { households } from './auth'
import { categories } from './taxonomy'

/**
 * Self-accumulating merchant cache. User-confirmed entries have precedence
 * over AI suggestions; the upsert path enforces that ordering.
 */
export const merchantLookup = pgTable(
  'merchant_lookup',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    normMerchant: text('norm_merchant').notNull(),
    displayMerchant: text('display_merchant'),
    businessType: text('business_type'),
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    flow: flowEnum('flow').notNull().default('expense'),
    source: text('source').notNull(),
    confidence: text('confidence').notNull().default('high'),
    aiNote: text('ai_note'),
    alwaysConfirm: boolean('always_confirm').notNull().default(false),
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    unique('merchant_lookup_household_norm').on(table.householdId, table.normMerchant),
    check('merchant_lookup_source_check', sql`${table.source} in ('user', 'ai')`),
    check('merchant_lookup_confidence_check', sql`${table.confidence} in ('high', 'low')`),
  ],
)

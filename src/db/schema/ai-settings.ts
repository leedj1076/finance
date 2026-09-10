import { sql } from 'drizzle-orm'
import { check, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { households } from './auth'

export const aiDiagnosisSettings = pgTable('ai_diagnosis_settings', {
  householdId: uuid('household_id').primaryKey().references(() => households.id, { onDelete: 'cascade' }),
  commonInstructions: text('common_instructions'),
  ledgerInstructions: text('ledger_instructions'),
  budgetInstructions: text('budget_instructions'),
  revision: integer('revision').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
}, (table) => [
  check('ai_diagnosis_settings_common_length_check', sql`length(${table.commonInstructions}) <= 4000`),
  check('ai_diagnosis_settings_ledger_length_check', sql`length(${table.ledgerInstructions}) <= 6000`),
  check('ai_diagnosis_settings_budget_length_check', sql`length(${table.budgetInstructions}) <= 6000`),
  check('ai_diagnosis_settings_revision_check', sql`${table.revision} > 0`),
  pgPolicy('ai_settings_member_select', {
    for: 'select',
    to: 'authenticated',
    using: sql`public.is_member(${table.householdId})`,
  }),
]).enableRLS()

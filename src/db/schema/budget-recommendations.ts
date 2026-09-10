import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { AiPromptInput } from '@/features/ai-settings/types'
import type { BudgetJobStatus, BudgetRecommendationReport, BudgetRecommendationSnapshot } from '@/features/budget-recommendations/types'
import type { DiagnosisErrorCode } from '@/features/diagnosis/types'
import { households } from './auth'
import { diagnosisWorkers } from './diagnosis'

export const budgetRecommendationJobs = pgTable('budget_recommendation_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull(),
  month: text('month').notNull(),
  status: text('status').$type<BudgetJobStatus>().notNull().default('queued'),
  snapshot: jsonb('snapshot').$type<BudgetRecommendationSnapshot>().notNull(),
  promptInput: jsonb('prompt_input').$type<AiPromptInput>(),
  fingerprint: text('fingerprint').notNull(),
  report: jsonb('report').$type<BudgetRecommendationReport>(),
  errorCode: text('error_code').$type<DiagnosisErrorCode>(),
  requestedBy: uuid('requested_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  workerId: uuid('worker_id').references(() => diagnosisWorkers.id),
}, table => [
  unique('budget_recommendation_household_request').on(table.householdId, table.requestId),
  uniqueIndex('budget_recommendation_one_active').on(table.householdId, table.month)
    .where(sql`${table.status} in ('queued', 'running')`),
  index('budget_recommendation_queue').on(table.householdId, table.status, table.createdAt, table.id),
  pgPolicy('budget_recommendation_member_select', {
    for: 'select', to: 'authenticated', using: sql`public.is_member(${table.householdId})`,
  }),
  check('budget_recommendation_month_check', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('budget_recommendation_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('budget_recommendation_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check('budget_recommendation_snapshot_check', sql`coalesce(jsonb_typeof(${table.snapshot}) = 'object'
    and ${table.snapshot}->'version' = '1'::jsonb and ${table.snapshot}->>'month' = ${table.month}, false)`),
  // Future positive integer envelope versions remain stored, but are never claimed by v1 workers.
  check('budget_recommendation_prompt_input_check', sql`${table.promptInput} is null or coalesce(
    jsonb_typeof(${table.promptInput}) = 'object'
    and jsonb_typeof(${table.promptInput}->'version') = 'number'
    and (${table.promptInput}->>'version') ~ '^[1-9][0-9]*$'
    and ${table.promptInput}->>'kind' = 'budget'
    and octet_length(${table.promptInput}::text) <= 131072, false)`),
  check('budget_recommendation_error_check', sql`${table.errorCode} in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired')`),
  check('budget_recommendation_result_check', sql`(
    (${table.status} in ('queued', 'running') and ${table.report} is null and ${table.errorCode} is null and ${table.completedAt} is null)
    or (${table.status} = 'completed' and ${table.report} is not null and ${table.errorCode} is null and ${table.completedAt} is not null)
    or (${table.status} = 'failed' and ${table.report} is null and ${table.errorCode} is not null and ${table.completedAt} is not null)
  )`),
  check('budget_recommendation_lease_check', sql`(
    (${table.status} = 'running' and ${table.leaseExpiresAt} is not null and ${table.claimToken} is not null and ${table.workerId} is not null)
    or (${table.status} <> 'running' and ${table.leaseExpiresAt} is null and ${table.claimToken} is null and ${table.workerId} is null)
  )`),
]).enableRLS()

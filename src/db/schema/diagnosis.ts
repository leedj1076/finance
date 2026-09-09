import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { DiagnosisErrorCode, DiagnosisReport, DiagnosisSnapshot, DiagnosisStatus } from '@/features/diagnosis/types'

import { households } from './auth'

export const diagnosisWorkers = pgTable('diagnosis_workers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('diagnosis_workers_household_idx').on(table.householdId),
  check('diagnosis_workers_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
]).enableRLS()

export const diagnosisJobs = pgTable('diagnosis_jobs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  month: text('month').notNull(),
  status: text('status').$type<DiagnosisStatus>().notNull().default('queued'),
  snapshot: jsonb('snapshot').$type<DiagnosisSnapshot>().notNull(),
  fingerprint: text('fingerprint').notNull(),
  report: jsonb('report').$type<DiagnosisReport>(),
  errorCode: text('error_code').$type<DiagnosisErrorCode>(),
  // The application owner creates jobs only after requireHousehold(). Browsers
  // have no INSERT privilege, so requestedBy cannot be spoofed through Data API.
  requestedBy: uuid('requested_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  workerId: uuid('worker_id').references(() => diagnosisWorkers.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('diagnosis_jobs_active_household_month_idx').on(table.householdId, table.month)
    .where(sql`${table.status} in ('queued', 'running')`),
  index('diagnosis_jobs_household_month_created_idx').on(table.householdId, table.month, table.createdAt),
  index('diagnosis_jobs_queue_idx').on(table.householdId, table.createdAt)
    .where(sql`${table.status} = 'queued'`),
  pgPolicy('diagnosis_jobs_member_select', { for: 'select', to: 'authenticated', using: sql`public.is_member(${table.householdId})` }),
  check('diagnosis_jobs_month_check', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('diagnosis_jobs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('diagnosis_jobs_fingerprint_check', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check('diagnosis_jobs_error_code_check', sql`${table.errorCode} in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired')`),
  check('diagnosis_jobs_result_check', sql`(
    (${table.status} in ('queued', 'running') and ${table.report} is null and ${table.errorCode} is null and ${table.completedAt} is null)
    or (${table.status} = 'completed' and ${table.report} is not null and ${table.errorCode} is null and ${table.completedAt} is not null)
    or (${table.status} = 'failed' and ${table.report} is null and ${table.errorCode} is not null and ${table.completedAt} is not null)
  )`),
]).enableRLS()

import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { Currency, JobStatus, Market, ResearchKind, ResearchMode, SyncKind, TransactionKind, TransactionSource, WeightBasis } from '@/features/investment/types'

import { households } from './auth'
import { diagnosisWorkers } from './diagnosis'

const member = (column: unknown) => sql`public.is_member(${column})`

export const investmentAccounts = pgTable('investment_accounts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  broker: text('broker').notNull().default('kiwoom'),
  brokerAccountNo: text('broker_account_no').notNull(),
  credentialRef: text('credential_ref').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_accounts_household_broker_no').on(table.householdId, table.broker, table.brokerAccountNo),
  check('investment_accounts_broker_check', sql`${table.broker} in ('kiwoom')`),
  check('investment_accounts_owner_check', sql`length(${table.owner}) between 1 and 20`),
  pgPolicy('investment_accounts_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentSecurities = pgTable('investment_securities', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  market: text('market').$type<Market>().notNull(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  exposureCurrency: text('exposure_currency').$type<Currency>().notNull(),
  sector: text('sector'),
  watching: boolean('watching').notNull().default(false),
  thesis: text('thesis'),
  horizonYears: numeric('horizon_years', { precision: 4, scale: 1 }),
  fundsNeededAt: text('funds_needed_at'),
  lossLimitPct: numeric('loss_limit_pct', { precision: 5, scale: 2 }),
  weightBasis: text('weight_basis').$type<WeightBasis>().notNull().default('stock_accounts'),
  businessType: text('business_type'),
  nextCheckDate: date('next_check_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_securities_household_market_symbol').on(table.householdId, table.market, table.symbol),
  check('investment_securities_market_check', sql`${table.market} in ('KR', 'US')`),
  check('investment_securities_currency_check', sql`${table.currency} in ('KRW', 'USD') and ${table.exposureCurrency} in ('KRW', 'USD')`),
  check('investment_securities_weight_basis_check', sql`${table.weightBasis} in ('total_assets', 'stock_accounts')`),
  check('investment_securities_symbol_check', sql`${table.symbol} ~ '^[A-Z0-9.]{1,12}$'`),
  pgPolicy('investment_securities_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentTransactions = pgTable('investment_transactions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  accountId: bigint('account_id', { mode: 'number' }).notNull().references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).references(() => investmentSecurities.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<TransactionKind>().notNull(),
  tradeDate: date('trade_date').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 6 }),
  price: numeric('price', { precision: 18, scale: 4 }),
  fee: numeric('fee', { precision: 18, scale: 2 }).notNull().default('0'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  source: text('source').$type<TransactionSource>().notNull(),
  brokerRef: text('broker_ref'),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_transactions_account_broker_ref').on(table.accountId, table.brokerRef).where(sql`${table.brokerRef} is not null`),
  index('investment_transactions_household_date_idx').on(table.householdId, table.tradeDate),
  index('investment_transactions_security_idx').on(table.securityId),
  check('investment_transactions_kind_check', sql`${table.kind} in ('buy', 'sell', 'dividend', 'deposit', 'withdraw', 'fee', 'adjust')`),
  check('investment_transactions_currency_check', sql`${table.currency} in ('KRW', 'USD')`),
  check('investment_transactions_source_check', sql`${table.source} in ('kiwoom', 'manual')`),
  check('investment_transactions_trade_fields_check', sql`${table.kind} not in ('buy', 'sell') or (${table.securityId} is not null and ${table.quantity} is not null and ${table.quantity} > 0 and ${table.price} is not null and ${table.price} >= 0)`),
  check('investment_transactions_cash_fields_check', sql`${table.kind} not in ('deposit', 'withdraw', 'fee') or (${table.securityId} is null and ${table.quantity} is null and ${table.price} is null)`),
  check('investment_transactions_dividend_check', sql`${table.kind} <> 'dividend' or ${table.securityId} is not null`),
  check('investment_transactions_adjust_check', sql`${table.kind} <> 'adjust' or (${table.securityId} is not null and ${table.quantity} is not null and ${table.amount} = 0)`),
  check('investment_transactions_source_ref_check', sql`${table.source} <> 'kiwoom' or ${table.brokerRef} is not null`),
  pgPolicy('investment_transactions_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const latestQuotes = pgTable('latest_quotes', {
  securityId: bigint('security_id', { mode: 'number' }).primaryKey().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  price: numeric('price', { precision: 18, scale: 4 }).notNull(),
  changeRate: numeric('change_rate', { precision: 8, scale: 4 }),
  quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
}, (table) => [
  check('latest_quotes_source_check', sql`${table.source} in ('kiwoom_ws', 'kiwoom_rest', 'manual')`),
  pgPolicy('latest_quotes_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const priceSnapshots = pgTable('price_snapshots', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).notNull().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  close: numeric('close', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('price_snapshots_security_date').on(table.securityId, table.date),
  pgPolicy('price_snapshots_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const fxRates = pgTable('fx_rates', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  pair: text('pair').notNull().default('USDKRW'),
  rate: numeric('rate', { precision: 12, scale: 4 }).notNull(),
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('fx_rates_household_pair_date').on(table.householdId, table.pair, table.date),
  check('fx_rates_pair_check', sql`${table.pair} in ('USDKRW')`),
  pgPolicy('fx_rates_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const brokerPositions = pgTable('broker_positions', {
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  accountId: bigint('account_id', { mode: 'number' }).notNull().references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).notNull().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  avgCost: numeric('avg_cost', { precision: 18, scale: 4 }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex('broker_positions_account_security').on(table.accountId, table.securityId),
  pgPolicy('broker_positions_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentSettings = pgTable('investment_settings', {
  householdId: uuid('household_id').primaryKey().references(() => households.id, { onDelete: 'cascade' }),
  researchDailyLimit: integer('research_daily_limit').notNull().default(10),
  researchInstructions: text('research_instructions'),
  advisorInstructions: text('advisor_instructions'),
  discoverInstructions: text('discover_instructions'),
  reportAreas: jsonb('report_areas'),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
}, (table) => [
  check('investment_settings_limit_check', sql`${table.researchDailyLimit} between 0 and 100`),
  pgPolicy('investment_settings_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

const jobColumns = {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  requestedBy: uuid('requested_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  workerId: uuid('worker_id').references(() => diagnosisWorkers.id, { onDelete: 'set null' }),
}

export const researchJobs = pgTable('research_jobs', {
  ...jobColumns,
  kind: text('kind').$type<ResearchKind>().notNull(),
  securityId: bigint('security_id', { mode: 'number' }).references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<ResearchMode>(),
  question: text('question'),
  promptVersion: text('prompt_version').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  promptInput: jsonb('prompt_input'),
  report: jsonb('report'),
  errorCode: text('error_code'),
}, (table) => [
  uniqueIndex('research_jobs_active_idx').on(table.householdId, table.kind, sql`coalesce(${table.securityId}, 0)`).where(sql`${table.status} in ('queued', 'running')`),
  index('research_jobs_history_idx').on(table.householdId, table.kind, table.securityId, table.createdAt),
  check('research_jobs_kind_check', sql`${table.kind} in ('security', 'portfolio', 'discover')`),
  check('research_jobs_security_check', sql`(${table.kind} = 'security' and ${table.securityId} is not null and ${table.mode} in ('quarterly', 'monthly', 'event')) or (${table.kind} <> 'security' and ${table.securityId} is null and ${table.mode} is null)`),
  check('research_jobs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('research_jobs_error_code_check', sql`${table.errorCode} is null or ${table.errorCode} in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired', 'daily_limit')`),
  check('research_jobs_question_check', sql`${table.question} is null or length(${table.question}) <= 500`),
  check('research_jobs_result_check', sql`(
    (${table.status} in ('queued', 'running') and ${table.report} is null and ${table.errorCode} is null and ${table.completedAt} is null)
    or (${table.status} = 'completed' and ${table.report} is not null and ${table.errorCode} is null and ${table.completedAt} is not null)
    or (${table.status} = 'failed' and ${table.report} is null and ${table.errorCode} is not null and ${table.completedAt} is not null)
  )`),
  pgPolicy('research_jobs_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const syncJobs = pgTable('sync_jobs', {
  ...jobColumns,
  kind: text('kind').$type<SyncKind>().notNull(),
  accountId: bigint('account_id', { mode: 'number' }).references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull(),
  result: jsonb('result'),
  errorCode: text('error_code'),
}, (table) => [
  uniqueIndex('sync_jobs_active_idx').on(table.householdId, table.kind, sql`coalesce(${table.accountId}, 0)`).where(sql`${table.status} in ('queued', 'running')`),
  check('sync_jobs_kind_check', sql`${table.kind} in ('account', 'snapshot')`),
  check('sync_jobs_account_check', sql`(${table.kind} = 'account' and ${table.accountId} is not null) or (${table.kind} = 'snapshot' and ${table.accountId} is null)`),
  check('sync_jobs_trigger_check', sql`${table.trigger} in ('user', 'schedule')`),
  check('sync_jobs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('sync_jobs_error_code_check', sql`${table.errorCode} is null or ${table.errorCode} in ('auth_failed', 'rate_limited', 'provider_error', 'timeout', 'worker_stopped', 'lease_expired')`),
  pgPolicy('sync_jobs_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

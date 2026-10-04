CREATE TABLE "broker_positions" (
	"household_id" uuid NOT NULL,
	"account_id" bigint NOT NULL,
	"security_id" bigint NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"avg_cost" numeric(18, 4) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fx_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"pair" text DEFAULT 'USDKRW' NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_pair_check" CHECK ("fx_rates"."pair" in ('USDKRW'))
);
--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investment_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"broker" text DEFAULT 'kiwoom' NOT NULL,
	"broker_account_no" text NOT NULL,
	"credential_ref" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_accounts_broker_check" CHECK ("investment_accounts"."broker" in ('kiwoom')),
	CONSTRAINT "investment_accounts_owner_check" CHECK (length("investment_accounts"."owner") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "investment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_securities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investment_securities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"exposure_currency" text NOT NULL,
	"sector" text,
	"watching" boolean DEFAULT false NOT NULL,
	"thesis" text,
	"horizon_years" numeric(4, 1),
	"funds_needed_at" text,
	"loss_limit_pct" numeric(5, 2),
	"weight_basis" text DEFAULT 'stock_accounts' NOT NULL,
	"business_type" text,
	"next_check_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_securities_market_check" CHECK ("investment_securities"."market" in ('KR', 'US')),
	CONSTRAINT "investment_securities_currency_check" CHECK ("investment_securities"."currency" in ('KRW', 'USD') and "investment_securities"."exposure_currency" in ('KRW', 'USD')),
	CONSTRAINT "investment_securities_weight_basis_check" CHECK ("investment_securities"."weight_basis" in ('total_assets', 'stock_accounts')),
	CONSTRAINT "investment_securities_symbol_check" CHECK ("investment_securities"."symbol" ~ '^[A-Z0-9.]{1,12}$')
);
--> statement-breakpoint
ALTER TABLE "investment_securities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"research_daily_limit" integer DEFAULT 10 NOT NULL,
	"research_instructions" text,
	"advisor_instructions" text,
	"discover_instructions" text,
	"report_areas" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "investment_settings_limit_check" CHECK ("investment_settings"."research_daily_limit" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "investment_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investment_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"account_id" bigint NOT NULL,
	"security_id" bigint,
	"kind" text NOT NULL,
	"trade_date" date NOT NULL,
	"quantity" numeric(18, 6),
	"price" numeric(18, 4),
	"fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"broker_ref" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_transactions_kind_check" CHECK ("investment_transactions"."kind" in ('buy', 'sell', 'dividend', 'deposit', 'withdraw', 'fee', 'adjust')),
	CONSTRAINT "investment_transactions_currency_check" CHECK ("investment_transactions"."currency" in ('KRW', 'USD')),
	CONSTRAINT "investment_transactions_source_check" CHECK ("investment_transactions"."source" in ('kiwoom', 'manual')),
	CONSTRAINT "investment_transactions_trade_fields_check" CHECK ("investment_transactions"."kind" not in ('buy', 'sell') or ("investment_transactions"."security_id" is not null and "investment_transactions"."quantity" is not null and "investment_transactions"."quantity" > 0 and "investment_transactions"."price" is not null and "investment_transactions"."price" >= 0)),
	CONSTRAINT "investment_transactions_cash_fields_check" CHECK ("investment_transactions"."kind" not in ('deposit', 'withdraw', 'fee') or ("investment_transactions"."security_id" is null and "investment_transactions"."quantity" is null and "investment_transactions"."price" is null)),
	CONSTRAINT "investment_transactions_dividend_check" CHECK ("investment_transactions"."kind" <> 'dividend' or "investment_transactions"."security_id" is not null),
	CONSTRAINT "investment_transactions_adjust_check" CHECK ("investment_transactions"."kind" <> 'adjust' or ("investment_transactions"."security_id" is not null and "investment_transactions"."quantity" is not null and "investment_transactions"."amount" = 0)),
	CONSTRAINT "investment_transactions_source_ref_check" CHECK ("investment_transactions"."source" <> 'kiwoom' or "investment_transactions"."broker_ref" is not null)
);
--> statement-breakpoint
ALTER TABLE "investment_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "latest_quotes" (
	"security_id" bigint PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"change_rate" numeric(8, 4),
	"quoted_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "latest_quotes_source_check" CHECK ("latest_quotes"."source" in ('kiwoom_ws', 'kiwoom_rest', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "latest_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"security_id" bigint NOT NULL,
	"date" date NOT NULL,
	"close" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"claim_token" uuid,
	"worker_id" uuid,
	"kind" text NOT NULL,
	"security_id" bigint,
	"mode" text,
	"question" text,
	"prompt_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"prompt_input" jsonb,
	"report" jsonb,
	"error_code" text,
	CONSTRAINT "research_jobs_kind_check" CHECK ("research_jobs"."kind" in ('security', 'portfolio', 'discover')),
	CONSTRAINT "research_jobs_security_check" CHECK (("research_jobs"."kind" = 'security' and "research_jobs"."security_id" is not null and "research_jobs"."mode" in ('quarterly', 'monthly', 'event')) or ("research_jobs"."kind" <> 'security' and "research_jobs"."security_id" is null and "research_jobs"."mode" is null)),
	CONSTRAINT "research_jobs_status_check" CHECK ("research_jobs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "research_jobs_error_code_check" CHECK ("research_jobs"."error_code" is null or "research_jobs"."error_code" in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired', 'daily_limit')),
	CONSTRAINT "research_jobs_question_check" CHECK ("research_jobs"."question" is null or length("research_jobs"."question") <= 500),
	CONSTRAINT "research_jobs_result_check" CHECK ((
    ("research_jobs"."status" in ('queued', 'running') and "research_jobs"."report" is null and "research_jobs"."error_code" is null and "research_jobs"."completed_at" is null)
    or ("research_jobs"."status" = 'completed' and "research_jobs"."report" is not null and "research_jobs"."error_code" is null and "research_jobs"."completed_at" is not null)
    or ("research_jobs"."status" = 'failed' and "research_jobs"."report" is null and "research_jobs"."error_code" is not null and "research_jobs"."completed_at" is not null)
  ))
);
--> statement-breakpoint
ALTER TABLE "research_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"claim_token" uuid,
	"worker_id" uuid,
	"kind" text NOT NULL,
	"account_id" bigint,
	"trigger" text NOT NULL,
	"result" jsonb,
	"error_code" text,
	CONSTRAINT "sync_jobs_kind_check" CHECK ("sync_jobs"."kind" in ('account', 'snapshot')),
	CONSTRAINT "sync_jobs_account_check" CHECK (("sync_jobs"."kind" = 'account' and "sync_jobs"."account_id" is not null) or ("sync_jobs"."kind" = 'snapshot' and "sync_jobs"."account_id" is null)),
	CONSTRAINT "sync_jobs_trigger_check" CHECK ("sync_jobs"."trigger" in ('user', 'schedule')),
	CONSTRAINT "sync_jobs_status_check" CHECK ("sync_jobs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "sync_jobs_error_code_check" CHECK ("sync_jobs"."error_code" is null or "sync_jobs"."error_code" in ('auth_failed', 'rate_limited', 'provider_error', 'timeout', 'worker_stopped', 'lease_expired'))
);
--> statement-breakpoint
ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "broker_positions" ADD CONSTRAINT "broker_positions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_positions" ADD CONSTRAINT "broker_positions_account_id_investment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_positions" ADD CONSTRAINT "broker_positions_security_id_investment_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."investment_securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_securities" ADD CONSTRAINT "investment_securities_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_settings" ADD CONSTRAINT "investment_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_account_id_investment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_security_id_investment_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."investment_securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_security_id_investment_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."investment_securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_security_id_investment_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."investment_securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_worker_id_diagnosis_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."diagnosis_workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_security_id_investment_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."investment_securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_worker_id_diagnosis_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."diagnosis_workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_account_id_investment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."investment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_positions_account_security" ON "broker_positions" USING btree ("account_id","security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_household_pair_date" ON "fx_rates" USING btree ("household_id","pair","date");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_accounts_household_broker_no" ON "investment_accounts" USING btree ("household_id","broker","broker_account_no");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_securities_household_market_symbol" ON "investment_securities" USING btree ("household_id","market","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_transactions_account_broker_ref" ON "investment_transactions" USING btree ("account_id","broker_ref") WHERE "investment_transactions"."broker_ref" is not null;--> statement-breakpoint
CREATE INDEX "investment_transactions_household_date_idx" ON "investment_transactions" USING btree ("household_id","trade_date");--> statement-breakpoint
CREATE INDEX "investment_transactions_security_idx" ON "investment_transactions" USING btree ("security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_snapshots_security_date" ON "price_snapshots" USING btree ("security_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "research_jobs_active_idx" ON "research_jobs" USING btree ("household_id","kind",coalesce("security_id", 0)) WHERE "research_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "research_jobs_history_idx" ON "research_jobs" USING btree ("household_id","kind","security_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_active_idx" ON "sync_jobs" USING btree ("household_id","kind",coalesce("account_id", 0)) WHERE "sync_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE POLICY "broker_positions_member_select" ON "broker_positions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("broker_positions"."household_id"));--> statement-breakpoint
CREATE POLICY "fx_rates_member_select" ON "fx_rates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("fx_rates"."household_id"));--> statement-breakpoint
CREATE POLICY "investment_accounts_member_select" ON "investment_accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("investment_accounts"."household_id"));--> statement-breakpoint
CREATE POLICY "investment_securities_member_select" ON "investment_securities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("investment_securities"."household_id"));--> statement-breakpoint
CREATE POLICY "investment_settings_member_select" ON "investment_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("investment_settings"."household_id"));--> statement-breakpoint
CREATE POLICY "investment_transactions_member_select" ON "investment_transactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("investment_transactions"."household_id"));--> statement-breakpoint
CREATE POLICY "latest_quotes_member_select" ON "latest_quotes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("latest_quotes"."household_id"));--> statement-breakpoint
CREATE POLICY "price_snapshots_member_select" ON "price_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("price_snapshots"."household_id"));--> statement-breakpoint
CREATE POLICY "research_jobs_member_select" ON "research_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("research_jobs"."household_id"));--> statement-breakpoint
CREATE POLICY "sync_jobs_member_select" ON "sync_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("sync_jobs"."household_id"));
--> statement-breakpoint
REVOKE ALL ON TABLE public.investment_accounts, public.investment_securities, public.investment_transactions, public.latest_quotes, public.price_snapshots, public.fx_rates, public.broker_positions, public.investment_settings, public.research_jobs, public.sync_jobs FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON TABLE public.investment_accounts, public.investment_securities, public.investment_transactions, public.latest_quotes, public.price_snapshots, public.fx_rates, public.broker_positions, public.investment_settings, public.research_jobs, public.sync_jobs TO authenticated;

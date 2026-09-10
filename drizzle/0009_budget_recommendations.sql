CREATE TABLE "budget_recommendation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"prompt_input" jsonb,
	"fingerprint" text NOT NULL,
	"report" jsonb,
	"error_code" text,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"claim_token" uuid,
	"worker_id" uuid,
	CONSTRAINT "budget_recommendation_household_request" UNIQUE("household_id","request_id"),
	CONSTRAINT "budget_recommendation_month_check" CHECK ("budget_recommendation_jobs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_recommendation_status_check" CHECK ("budget_recommendation_jobs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "budget_recommendation_fingerprint_check" CHECK ("budget_recommendation_jobs"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "budget_recommendation_snapshot_check" CHECK (coalesce(jsonb_typeof("budget_recommendation_jobs"."snapshot") = 'object'
    and "budget_recommendation_jobs"."snapshot"->'version' = '1'::jsonb and "budget_recommendation_jobs"."snapshot"->>'month' = "budget_recommendation_jobs"."month", false)),
	CONSTRAINT "budget_recommendation_prompt_input_check" CHECK ("budget_recommendation_jobs"."prompt_input" is null or coalesce(
    jsonb_typeof("budget_recommendation_jobs"."prompt_input") = 'object'
    and jsonb_typeof("budget_recommendation_jobs"."prompt_input"->'version') = 'number'
    and ("budget_recommendation_jobs"."prompt_input"->>'version') ~ '^[1-9][0-9]*$'
    and "budget_recommendation_jobs"."prompt_input"->>'kind' = 'budget'
    and octet_length("budget_recommendation_jobs"."prompt_input"::text) <= 131072, false)),
	CONSTRAINT "budget_recommendation_error_check" CHECK ("budget_recommendation_jobs"."error_code" in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired')),
	CONSTRAINT "budget_recommendation_result_check" CHECK ((
    ("budget_recommendation_jobs"."status" in ('queued', 'running') and "budget_recommendation_jobs"."report" is null and "budget_recommendation_jobs"."error_code" is null and "budget_recommendation_jobs"."completed_at" is null)
    or ("budget_recommendation_jobs"."status" = 'completed' and "budget_recommendation_jobs"."report" is not null and "budget_recommendation_jobs"."error_code" is null and "budget_recommendation_jobs"."completed_at" is not null)
    or ("budget_recommendation_jobs"."status" = 'failed' and "budget_recommendation_jobs"."report" is null and "budget_recommendation_jobs"."error_code" is not null and "budget_recommendation_jobs"."completed_at" is not null)
  )),
	CONSTRAINT "budget_recommendation_lease_check" CHECK ((
    ("budget_recommendation_jobs"."status" = 'running' and "budget_recommendation_jobs"."lease_expires_at" is not null and "budget_recommendation_jobs"."claim_token" is not null and "budget_recommendation_jobs"."worker_id" is not null)
    or ("budget_recommendation_jobs"."status" <> 'running' and "budget_recommendation_jobs"."lease_expires_at" is null and "budget_recommendation_jobs"."claim_token" is null and "budget_recommendation_jobs"."worker_id" is null)
  ))
);
--> statement-breakpoint
ALTER TABLE "budget_recommendation_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "recommendation_job_id" uuid;--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ADD COLUMN "prompt_input" jsonb;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "budget_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "budget_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "prompt_protocol_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "prompt_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "configured_model" text;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD COLUMN "configured_timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "budget_recommendation_jobs" ADD CONSTRAINT "budget_recommendation_jobs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recommendation_jobs" ADD CONSTRAINT "budget_recommendation_jobs_worker_id_diagnosis_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."diagnosis_workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_recommendation_one_active" ON "budget_recommendation_jobs" USING btree ("household_id","month") WHERE "budget_recommendation_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "budget_recommendation_queue" ON "budget_recommendation_jobs" USING btree ("household_id","status","created_at","id");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_recommendation_job_id_budget_recommendation_jobs_id_fk" FOREIGN KEY ("recommendation_job_id") REFERENCES "public"."budget_recommendation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_jobs_household_request_idx" ON "diagnosis_jobs" USING btree ("household_id","request_id") WHERE "diagnosis_jobs"."request_id" is not null;--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ADD CONSTRAINT "diagnosis_jobs_prompt_input_check" CHECK ("diagnosis_jobs"."prompt_input" is null or coalesce(
    jsonb_typeof("diagnosis_jobs"."prompt_input") = 'object'
    and jsonb_typeof("diagnosis_jobs"."prompt_input"->'version') = 'number'
    and ("diagnosis_jobs"."prompt_input"->>'version') ~ '^[1-9][0-9]*$'
    and "diagnosis_jobs"."prompt_input"->>'kind' = 'ledger'
    and octet_length("diagnosis_jobs"."prompt_input"::text) <= 131072, false));--> statement-breakpoint
CREATE POLICY "budget_recommendation_member_select" ON "budget_recommendation_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("budget_recommendation_jobs"."household_id"));

--> statement-breakpoint
REVOKE ALL ON TABLE public.budget_recommendation_jobs FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON TABLE public.budget_recommendation_jobs TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.heartbeat_ai_worker(p_token text, p_model text, p_timeout_ms integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_worker public.diagnosis_workers%ROWTYPE;
BEGIN
  IF p_timeout_ms IS NULL OR p_timeout_ms NOT BETWEEN 1 AND 300000
    OR (p_model IS NOT NULL AND p_model !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
  THEN RETURN false; END IF;
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN RETURN false; END IF;
  SELECT * INTO v_worker FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.diagnosis_workers
  SET prompt_protocol_version = 1, prompt_last_seen_at = clock_timestamp(), last_seen_at = clock_timestamp(),
    configured_model = p_model, configured_timeout_ms = p_timeout_ms
  WHERE id = v_worker.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.heartbeat_budget_worker(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_worker public.diagnosis_workers%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN RETURN false; END IF;
  SELECT * INTO v_worker FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.diagnosis_workers
  SET budget_protocol_version = 1, budget_last_seen_at = clock_timestamp(), last_seen_at = clock_timestamp()
  WHERE id = v_worker.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Preserve the original legacy RPC byte-for-byte except its queued-input filter.
CREATE OR REPLACE FUNCTION public.claim_diagnosis_job(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.diagnosis_workers%ROWTYPE;
  v_job public.diagnosis_jobs%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_worker
  FROM public.diagnosis_workers
  WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.diagnosis_workers
  SET last_seen_at = clock_timestamp()
  WHERE id = v_worker.id;

  -- A crashed or sleeping Mac cannot hold a month indefinitely. Expiry is
  -- visible as a failure so the user can request another diagnosis explicitly.
  UPDATE public.diagnosis_jobs
  SET status = 'failed', error_code = 'lease_expired', completed_at = clock_timestamp(),
      lease_expires_at = NULL, claim_token = NULL
  WHERE household_id = v_worker.household_id
    AND status = 'running'
    AND lease_expires_at <= clock_timestamp();

  SELECT * INTO v_job
  FROM public.diagnosis_jobs
  WHERE household_id = v_worker.household_id AND status = 'queued' AND prompt_input IS NULL
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.diagnosis_jobs
  SET status = 'running', started_at = clock_timestamp(), worker_id = v_worker.id,
      claim_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '180 seconds'
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('id', v_job.id, 'claimToken', v_job.claim_token, 'snapshot', v_job.snapshot);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.claim_configured_diagnosis_job(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.diagnosis_workers%ROWTYPE;
  v_job public.diagnosis_jobs%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_worker
  FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.diagnosis_workers
  SET last_seen_at = clock_timestamp()
  WHERE id = v_worker.id;

  -- A crashed or sleeping Mac cannot hold a month indefinitely. Expiry is
  -- visible as a failure so the user can request another diagnosis explicitly.
  UPDATE public.diagnosis_jobs
  SET status = 'failed', error_code = 'lease_expired', completed_at = clock_timestamp(),
      lease_expires_at = NULL, claim_token = NULL
  WHERE household_id = v_worker.household_id
    AND status = 'running'
    AND lease_expires_at <= clock_timestamp();

  SELECT * INTO v_job
  FROM public.diagnosis_jobs
  WHERE household_id = v_worker.household_id AND status = 'queued'
    AND (prompt_input IS NULL OR (prompt_input->'version' = '1'::jsonb AND prompt_input->>'kind' = 'ledger'
      AND v_worker.prompt_protocol_version = 1
      AND v_worker.prompt_last_seen_at > clock_timestamp() - interval '90 seconds'))
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.diagnosis_jobs
  SET status = 'running', started_at = clock_timestamp(), worker_id = v_worker.id,
      claim_token = pg_catalog.gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '180 seconds'
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('id', v_job.id, 'claimToken', v_job.claim_token, 'snapshot', v_job.snapshot, 'promptInput', v_job.prompt_input);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.claim_budget_recommendation_job(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.diagnosis_workers%ROWTYPE;
  v_job public.budget_recommendation_jobs%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_worker
  FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_worker.budget_protocol_version <> 1 OR v_worker.budget_last_seen_at IS NULL
    OR v_worker.budget_last_seen_at <= clock_timestamp() - interval '90 seconds' THEN RETURN NULL; END IF;

  UPDATE public.diagnosis_workers
  SET last_seen_at = clock_timestamp()
  WHERE id = v_worker.id;

  -- A crashed or sleeping Mac cannot hold a month indefinitely. Expiry is
  -- visible as a failure so the user can request another diagnosis explicitly.
  UPDATE public.budget_recommendation_jobs
  SET status = 'failed', error_code = 'lease_expired', completed_at = clock_timestamp(),
      lease_expires_at = NULL, claim_token = NULL, worker_id = NULL
  WHERE household_id = v_worker.household_id
    AND status = 'running'
    AND lease_expires_at <= clock_timestamp();

  SELECT * INTO v_job
  FROM public.budget_recommendation_jobs
  WHERE household_id = v_worker.household_id AND status = 'queued'
    AND (prompt_input IS NULL OR (prompt_input->'version' = '1'::jsonb AND prompt_input->>'kind' = 'budget'
      AND v_worker.prompt_protocol_version = 1
      AND v_worker.prompt_last_seen_at > clock_timestamp() - interval '90 seconds'))
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.budget_recommendation_jobs
  SET status = 'running', started_at = clock_timestamp(), worker_id = v_worker.id,
      claim_token = pg_catalog.gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '180 seconds'
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('id', v_job.id, 'claimToken', v_job.claim_token, 'snapshot', v_job.snapshot, 'promptInput', v_job.prompt_input);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.heartbeat_budget_recommendation_job(p_token text, p_job_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.diagnosis_workers%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_worker
  FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.budget_recommendation_jobs
  SET lease_expires_at = clock_timestamp() + interval '180 seconds'
  WHERE id = p_job_id AND household_id = v_worker.household_id AND worker_id = v_worker.id
    AND status = 'running' AND claim_token = p_claim_token
    AND lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.diagnosis_workers SET last_seen_at = clock_timestamp() WHERE id = v_worker.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.finish_budget_recommendation_job(
  p_token text, p_job_id uuid, p_claim_token uuid, p_report jsonb, p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.diagnosis_workers%ROWTYPE;
  v_valid_report boolean;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 1024 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_worker
  FROM public.diagnosis_workers
  WHERE token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF p_report IS NULL THEN
    IF p_error_code IS NULL OR p_error_code NOT IN (
      'timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired'
    ) THEN RETURN false; END IF;
  ELSE
    -- Full narrative/evidence validation is performed by the worker. This
    -- boundary rejects malformed payloads and never accepts raw CLI errors.
    v_valid_report := jsonb_typeof(p_report) = 'object'
      AND octet_length(p_report::text) <= 65536
      AND p_report->'version' = '1'::jsonb
      AND jsonb_typeof(p_report->'rows') = 'array';
    IF p_error_code IS NOT NULL OR NOT coalesce(v_valid_report, false) THEN RETURN false; END IF;
  END IF;

  UPDATE public.budget_recommendation_jobs
  SET status = CASE WHEN p_report IS NULL THEN 'failed' ELSE 'completed' END,
      report = p_report, error_code = p_error_code, completed_at = clock_timestamp(),
      lease_expires_at = NULL, claim_token = NULL, worker_id = NULL
  WHERE id = p_job_id AND household_id = v_worker.household_id AND worker_id = v_worker.id
    AND status = 'running' AND claim_token = p_claim_token
    AND lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.diagnosis_workers SET last_seen_at = clock_timestamp() WHERE id = v_worker.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_budget_recommendation_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.household_id, NEW.month, NEW.request_id, NEW.snapshot, NEW.prompt_input, NEW.fingerprint, NEW.requested_by)
    IS DISTINCT FROM ROW(OLD.household_id, OLD.month, OLD.request_id, OLD.snapshot, OLD.prompt_input, OLD.fingerprint, OLD.requested_by)
  THEN RAISE EXCEPTION 'immutable_budget_recommendation_input' USING ERRCODE = '23514'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed')) OR
    (OLD.status = 'running' AND NEW.status IN ('completed', 'failed'))
  ) THEN RAISE EXCEPTION 'invalid_budget_recommendation_transition' USING ERRCODE = '23514'; END IF;
  IF OLD.status IN ('completed', 'failed') AND NEW IS DISTINCT FROM OLD
  THEN RAISE EXCEPTION 'immutable_budget_recommendation_result' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_recommendation_immutable BEFORE UPDATE ON public.budget_recommendation_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_budget_recommendation_job();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_diagnosis_job_input()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.household_id, NEW.month, NEW.request_id, NEW.snapshot, NEW.prompt_input, NEW.fingerprint, NEW.requested_by)
    IS DISTINCT FROM ROW(OLD.household_id, OLD.month, OLD.request_id, OLD.snapshot, OLD.prompt_input, OLD.fingerprint, OLD.requested_by)
  THEN RAISE EXCEPTION 'immutable_diagnosis_input' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER diagnosis_input_immutable BEFORE UPDATE ON public.diagnosis_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_diagnosis_job_input();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_budget_recommendation_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.recommendation_job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.budget_recommendation_jobs j
    WHERE j.id = NEW.recommendation_job_id AND j.household_id = NEW.household_id
      AND j.month = NEW.month AND j.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(j.report->'rows') r
        WHERE r->>'major' = NEW.major
      )
  ) THEN RAISE EXCEPTION 'invalid_budget_recommendation_reference' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budgets_recommendation_reference BEFORE INSERT OR UPDATE ON public.budgets
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_recommendation_reference();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_budget_recommendation_job(), public.guard_diagnosis_job_input(),
  public.validate_budget_recommendation_reference() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.heartbeat_ai_worker(text, text, integer), public.heartbeat_budget_worker(text),
  public.claim_configured_diagnosis_job(text), public.claim_budget_recommendation_job(text),
  public.heartbeat_budget_recommendation_job(text, uuid, uuid),
  public.finish_budget_recommendation_job(text, uuid, uuid, jsonb, text)
FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.heartbeat_ai_worker(text, text, integer), public.heartbeat_budget_worker(text),
  public.claim_configured_diagnosis_job(text), public.claim_budget_recommendation_job(text),
  public.heartbeat_budget_recommendation_job(text, uuid, uuid),
  public.finish_budget_recommendation_job(text, uuid, uuid, jsonb, text)
TO anon, authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';

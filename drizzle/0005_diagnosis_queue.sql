CREATE TABLE "diagnosis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"snapshot" jsonb NOT NULL,
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
	CONSTRAINT "diagnosis_jobs_month_check" CHECK ("diagnosis_jobs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "diagnosis_jobs_status_check" CHECK ("diagnosis_jobs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "diagnosis_jobs_fingerprint_check" CHECK ("diagnosis_jobs"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "diagnosis_jobs_error_code_check" CHECK ("diagnosis_jobs"."error_code" in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired')),
	CONSTRAINT "diagnosis_jobs_result_check" CHECK ((
    ("diagnosis_jobs"."status" in ('queued', 'running') and "diagnosis_jobs"."report" is null and "diagnosis_jobs"."error_code" is null and "diagnosis_jobs"."completed_at" is null)
    or ("diagnosis_jobs"."status" = 'completed' and "diagnosis_jobs"."report" is not null and "diagnosis_jobs"."error_code" is null and "diagnosis_jobs"."completed_at" is not null)
    or ("diagnosis_jobs"."status" = 'failed' and "diagnosis_jobs"."report" is null and "diagnosis_jobs"."error_code" is not null and "diagnosis_jobs"."completed_at" is not null)
  ))
);
--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "diagnosis_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "diagnosis_workers_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "diagnosis_workers_token_hash_check" CHECK ("diagnosis_workers"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ADD CONSTRAINT "diagnosis_jobs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_jobs" ADD CONSTRAINT "diagnosis_jobs_worker_id_diagnosis_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."diagnosis_workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_workers" ADD CONSTRAINT "diagnosis_workers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_jobs_active_household_month_idx" ON "diagnosis_jobs" USING btree ("household_id","month") WHERE "diagnosis_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "diagnosis_jobs_household_month_created_idx" ON "diagnosis_jobs" USING btree ("household_id","month","created_at");--> statement-breakpoint
CREATE INDEX "diagnosis_jobs_queue_idx" ON "diagnosis_jobs" USING btree ("household_id","created_at") WHERE "diagnosis_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "diagnosis_workers_household_idx" ON "diagnosis_workers" USING btree ("household_id");--> statement-breakpoint
CREATE POLICY "diagnosis_jobs_member_select" ON "diagnosis_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("diagnosis_jobs"."household_id"));--> statement-breakpoint
-- The application uses its owner connection to enqueue after requireHousehold.
-- Data API users can only read their household's jobs. Worker credentials never
-- appear in any browser-readable table, including for household members.
REVOKE ALL ON TABLE public.diagnosis_jobs, public.diagnosis_workers FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON TABLE public.diagnosis_jobs TO authenticated;
--> statement-breakpoint
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
  WHERE household_id = v_worker.household_id AND status = 'queued'
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
CREATE OR REPLACE FUNCTION public.heartbeat_diagnosis_job(p_token text, p_job_id uuid, p_claim_token uuid)
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
  WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.diagnosis_jobs
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
CREATE OR REPLACE FUNCTION public.finish_diagnosis_job(
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
  WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
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
      AND jsonb_typeof(p_report->'headline') = 'string'
      AND length(p_report->>'headline') BETWEEN 1 AND 240
      AND jsonb_typeof(p_report->'summary') = 'string'
      AND jsonb_typeof(p_report->'changes') = 'array'
      AND jsonb_typeof(p_report->'trend') = 'object'
      AND jsonb_typeof(p_report->'trend'->'summary') = 'string'
      AND jsonb_typeof(p_report->'trend'->'caveat') = 'string'
      AND jsonb_typeof(p_report->'checks') = 'array'
      AND jsonb_typeof(p_report->'actions') = 'array'
      AND jsonb_typeof(p_report->'positive') IN ('string', 'null');
    IF p_error_code IS NOT NULL OR NOT coalesce(v_valid_report, false) THEN RETURN false; END IF;
  END IF;

  UPDATE public.diagnosis_jobs
  SET status = CASE WHEN p_report IS NULL THEN 'failed' ELSE 'completed' END,
      report = p_report, error_code = p_error_code, completed_at = clock_timestamp(),
      lease_expires_at = NULL, claim_token = NULL
  WHERE id = p_job_id AND household_id = v_worker.household_id AND worker_id = v_worker.id
    AND status = 'running' AND claim_token = p_claim_token
    AND lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.diagnosis_workers SET last_seen_at = clock_timestamp() WHERE id = v_worker.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_diagnosis_job(text),
  public.heartbeat_diagnosis_job(text, uuid, uuid),
  public.finish_diagnosis_job(text, uuid, uuid, jsonb, text)
FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_diagnosis_job(text),
  public.heartbeat_diagnosis_job(text, uuid, uuid),
  public.finish_diagnosis_job(text, uuid, uuid, jsonb, text)
TO anon, authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';

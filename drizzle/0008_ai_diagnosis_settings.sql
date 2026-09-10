CREATE TABLE "ai_diagnosis_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"common_instructions" text,
	"ledger_instructions" text,
	"budget_instructions" text,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "ai_diagnosis_settings_common_length_check" CHECK (length("ai_diagnosis_settings"."common_instructions") <= 4000),
	CONSTRAINT "ai_diagnosis_settings_ledger_length_check" CHECK (length("ai_diagnosis_settings"."ledger_instructions") <= 6000),
	CONSTRAINT "ai_diagnosis_settings_budget_length_check" CHECK (length("ai_diagnosis_settings"."budget_instructions") <= 6000),
	CONSTRAINT "ai_diagnosis_settings_revision_check" CHECK ("ai_diagnosis_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_diagnosis_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_diagnosis_settings" ADD CONSTRAINT "ai_diagnosis_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "ai_settings_member_select" ON "ai_diagnosis_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_member("ai_diagnosis_settings"."household_id"));--> statement-breakpoint
REVOKE ALL ON public.ai_diagnosis_settings FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT ON public.ai_diagnosis_settings TO authenticated;

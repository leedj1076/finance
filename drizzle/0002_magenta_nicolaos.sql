CREATE TABLE "merchant_lookup" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "merchant_lookup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"norm_merchant" text NOT NULL,
	"display_merchant" text,
	"business_type" text,
	"category_id" bigint,
	"flow" "flow" DEFAULT 'expense' NOT NULL,
	"source" text NOT NULL,
	"confidence" text DEFAULT 'high' NOT NULL,
	"ai_note" text,
	"always_confirm" boolean DEFAULT false NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "merchant_lookup_household_norm" UNIQUE("household_id","norm_merchant")
);
--> statement-breakpoint
ALTER TABLE "import_inbox" ADD COLUMN "confidence" text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_lookup" ADD CONSTRAINT "merchant_lookup_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_lookup" ADD CONSTRAINT "merchant_lookup_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
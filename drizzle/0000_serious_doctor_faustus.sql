CREATE TYPE "public"."category_kind" AS ENUM('income', 'saving', 'expense');--> statement-breakpoint
CREATE TYPE "public"."flow" AS ENUM('income', 'saving', 'expense');--> statement-breakpoint
CREATE TYPE "public"."inbox_kind" AS ENUM('normal', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('pending', 'done', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_aliases" (
	"household_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"alias" text NOT NULL,
	"account_id" bigint NOT NULL,
	CONSTRAINT "account_aliases_household_id_owner_alias_pk" PRIMARY KEY("household_id","owner","alias")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner" text,
	"type" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"memo" text,
	CONSTRAINT "accounts_household_name" UNIQUE("household_id","name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"kind" "category_kind" NOT NULL,
	"major" text NOT NULL,
	"sub" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "categories_household_kind_major_sub" UNIQUE("household_id","kind","major","sub")
);
--> statement-breakpoint
CREATE TABLE "category_meta" (
	"household_id" uuid NOT NULL,
	"major" text NOT NULL,
	"irregular" boolean DEFAULT false NOT NULL,
	CONSTRAINT "category_meta_household_id_major_pk" PRIMARY KEY("household_id","major")
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "category_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" bigint,
	"account_id" bigint,
	"flow" "flow",
	"fixed" boolean,
	"priority" integer DEFAULT 100 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_rules_household_type_pattern" UNIQUE("household_id","match_type","pattern")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"source" text NOT NULL,
	"filename" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"flow" "flow" NOT NULL,
	"fixed" boolean DEFAULT true NOT NULL,
	"category_id" bigint,
	"memo" text,
	"amount" bigint NOT NULL,
	"account_id" bigint,
	"day" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"flow" "flow" NOT NULL,
	"fixed" boolean DEFAULT false NOT NULL,
	"category_id" bigint,
	"memo" text,
	"amount" bigint NOT NULL,
	"account_id" bigint,
	"source" text DEFAULT 'manual' NOT NULL,
	"raw_merchant" text,
	"import_batch_id" bigint,
	"recurring_id" bigint,
	"import_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_household_import_uid" UNIQUE("household_id","import_uid")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "budgets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"major" text NOT NULL,
	"month" text DEFAULT '*' NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "budgets_household_major_month" UNIQUE("household_id","major","month")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"household_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text,
	CONSTRAINT "settings_household_id_key_pk" PRIMARY KEY("household_id","key")
);
--> statement-breakpoint
CREATE TABLE "asset_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "asset_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"major" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "asset_accounts_household_major_name" UNIQUE("household_id","major","name")
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "balance_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"account_id" bigint NOT NULL,
	"month" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "balance_snapshots_household_account_month" UNIQUE("household_id","account_id","month")
);
--> statement-breakpoint
CREATE TABLE "import_inbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_inbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"household_id" uuid NOT NULL,
	"import_uid" text NOT NULL,
	"owner" text NOT NULL,
	"date" text NOT NULL,
	"time" text,
	"merchant" text,
	"amount" bigint NOT NULL,
	"flow" "flow" NOT NULL,
	"kind" "inbox_kind" DEFAULT 'normal' NOT NULL,
	"bs_cat1" text,
	"bs_cat2" text,
	"pay" text,
	"account_id" bigint,
	"category_id" bigint,
	"memo" text,
	"sug_source" text,
	"dup_note" text,
	"status" "inbox_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_household_import_uid" UNIQUE("household_id","import_uid")
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_aliases" ADD CONSTRAINT "account_aliases_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_aliases" ADD CONSTRAINT "account_aliases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_meta" ADD CONSTRAINT "category_meta_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring" ADD CONSTRAINT "recurring_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_id_recurring_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_accounts" ADD CONSTRAINT "asset_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_asset_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."asset_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_inbox" ADD CONSTRAINT "import_inbox_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_inbox" ADD CONSTRAINT "import_inbox_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_inbox" ADD CONSTRAINT "import_inbox_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_household_date" ON "transactions" USING btree ("household_id","date");--> statement-breakpoint
CREATE INDEX "inbox_household_status" ON "import_inbox" USING btree ("household_id","status");
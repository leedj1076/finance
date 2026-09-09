CREATE TABLE "ledger_months" (
	"household_id" uuid NOT NULL,
	"month" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"closed_revision" bigint,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_months_household_id_month_pk" PRIMARY KEY("household_id","month"),
	CONSTRAINT "ledger_month_valid" CHECK ("ledger_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "ledger_months"."month" >= '0001-01'),
	CONSTRAINT "ledger_month_revision_valid" CHECK ("ledger_months"."revision" >= 0 and ("ledger_months"."closed_revision" is null or ("ledger_months"."closed_revision" >= 0 and "ledger_months"."closed_revision" <= "ledger_months"."revision" and "ledger_months"."closed_at" is not null and "ledger_months"."closed_by" is not null)))
);
--> statement-breakpoint
ALTER TABLE "ledger_months" ADD CONSTRAINT "ledger_months_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.ledger_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ledger_months FROM anon, authenticated;
GRANT SELECT ON public.ledger_months TO authenticated;
CREATE POLICY ledger_months_member_read ON public.ledger_months FOR SELECT TO authenticated
USING (public.is_member(household_id));
--> statement-breakpoint
-- Statement transition tables exclude skipped INSERTs and let multi-month
-- updates acquire state locks in one deterministic order. Existing data is
-- deliberately NOT closed, and no transaction values are backfilled.
CREATE FUNCTION public.track_ledger_month_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  affected jsonb;
  target record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT jsonb_agg(jsonb_build_object('household_id', household_id, 'month', to_char(date, 'YYYY-MM')))
    INTO affected FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(jsonb_build_object('household_id', household_id, 'month', to_char(date, 'YYYY-MM')))
    INTO affected FROM old_rows;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('household_id', household_id, 'month', month)) INTO affected
    FROM (
      SELECT o.household_id, to_char(o.date, 'YYYY-MM') AS month
      FROM old_rows o JOIN new_rows n USING (id)
      WHERE ROW(o.household_id, o.date, o.flow, o.amount, o.fixed, o.category_id, o.account_id, o.memo, o.raw_merchant)
        IS DISTINCT FROM ROW(n.household_id, n.date, n.flow, n.amount, n.fixed, n.category_id, n.account_id, n.memo, n.raw_merchant)
      UNION
      SELECT n.household_id, to_char(n.date, 'YYYY-MM') AS month
      FROM old_rows o JOIN new_rows n USING (id)
      WHERE ROW(o.household_id, o.date, o.flow, o.amount, o.fixed, o.category_id, o.account_id, o.memo, o.raw_merchant)
        IS DISTINCT FROM ROW(n.household_id, n.date, n.flow, n.amount, n.fixed, n.category_id, n.account_id, n.memo, n.raw_merchant)
    ) changed;
  END IF;

  FOR target IN
    SELECT DISTINCT k.household_id, k.month
    FROM jsonb_to_recordset(coalesce(affected, '[]'::jsonb)) AS k(household_id uuid, month text)
    JOIN public.households h ON h.id = k.household_id
    ORDER BY k.household_id, k.month
  LOOP
    INSERT INTO public.ledger_months AS m (household_id, month, revision)
    VALUES (target.household_id, target.month, 1)
    ON CONFLICT (household_id, month) DO UPDATE
      SET revision = m.revision + 1, updated_at = now();
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.track_ledger_month_revision() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER ledger_month_insert AFTER INSERT ON public.transactions
REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_ledger_month_revision();
CREATE TRIGGER ledger_month_update AFTER UPDATE ON public.transactions
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_ledger_month_revision();
CREATE TRIGGER ledger_month_delete AFTER DELETE ON public.transactions
REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.track_ledger_month_revision();

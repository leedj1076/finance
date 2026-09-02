grant select, insert, update, delete on merchant_lookup to authenticated;
--> statement-breakpoint
grant usage, select on sequence merchant_lookup_id_seq to authenticated;
--> statement-breakpoint
alter table "merchant_lookup" enable row level security;
--> statement-breakpoint
create policy "merchant_lookup_household_rls" on "merchant_lookup"
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));

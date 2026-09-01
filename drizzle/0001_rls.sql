-- Custom SQL migration file, put your code below! --
-- Data API roles receive no implicit access in new Supabase projects. Public
-- finance data is never exposed to anon.
grant usage on schema public to anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to authenticated;
--> statement-breakpoint
grant usage, select on all sequences in schema public to authenticated;
--> statement-breakpoint
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
--> statement-breakpoint
alter table "household_members"
  add constraint "household_members_user_fk"
  foreign key ("user_id") references "auth"."users"("id") on delete cascade;
--> statement-breakpoint
create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members member
    where member.household_id = hid
      and member.user_id = auth.uid()
  );
$$;
--> statement-breakpoint
alter table "households" enable row level security;
--> statement-breakpoint
create policy "households_select" on "households"
  for select to authenticated using (public.is_member(id));
--> statement-breakpoint
alter table "household_members" enable row level security;
--> statement-breakpoint
create policy "members_select" on "household_members"
  for select to authenticated using (public.is_member(household_id));
--> statement-breakpoint
-- Users cannot self-join an arbitrary household. Initial membership is created
-- only through the owner connection used by scripts/link-user.ts.
create policy "members_insert" on "household_members"
  for insert to authenticated with check (public.is_member(household_id));
--> statement-breakpoint
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts',
    'categories',
    'category_meta',
    'category_rules',
    'account_aliases',
    'import_batches',
    'recurring',
    'transactions',
    'budgets',
    'settings',
    'asset_accounts',
    'balance_snapshots',
    'import_inbox'
  ]
  loop
    execute format('alter table %I enable row level security;', table_name);
    execute format(
      'create policy %I on %I for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));',
      table_name || '_household_rls',
      table_name
    );
  end loop;
end $$;

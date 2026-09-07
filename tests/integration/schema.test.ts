import { expect, test } from 'vitest'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

import { db } from '@/db/client'

test('can connect to local postgres', async () => {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false })
  const rows = await sql`select 1 as ok`
  expect(rows[0].ok).toBe(1)
  await sql.end()
})

test('all core tables exist', async () => {
  const rows = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `)
  const names = rows.map((row) => row.table_name)

  for (const table of [
    'households',
    'household_members',
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
    'import_inbox',
    'merchant_lookup',
  ]) {
    expect(names, `missing table ${table}`).toContain(table)
  }
})

test('import_inbox has confidence column', async () => {
  const rows = await db.execute<{ column_name: string }>(sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'import_inbox'
  `)

  expect(rows.map((row) => row.column_name)).toContain('confidence')
})

test('merchant_lookup has household RLS enabled', async () => {
  const [table] = await db.execute<{ relrowsecurity: boolean }>(sql`
    select relrowsecurity
    from pg_class
    where oid = 'public.merchant_lookup'::regclass
  `)
  const policies = await db.execute<{ policyname: string }>(sql`
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'merchant_lookup'
  `)

  expect(table?.relrowsecurity).toBe(true)
  expect(policies.map((policy) => policy.policyname)).toContain('merchant_lookup_household_rls')
})

test('merchant and inbox confidence constraints reject invalid values', async () => {
  const [household] = await db.execute<{ id: string }>(sql`
    insert into households (name) values (${`schema-check-${Date.now()}`}) returning id
  `)

  try {
    await expect(db.execute(sql`
      insert into merchant_lookup (household_id, norm_merchant, source, confidence)
      values (${household.id}, 'invalid-source', 'history', 'high')
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into merchant_lookup (household_id, norm_merchant, source, confidence)
      values (${household.id}, 'invalid-confidence', 'user', 'review')
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into import_inbox
        (household_id, import_uid, owner, date, amount, flow, confidence)
      values
        (${household.id}, 'invalid-inbox-confidence', 'DJ', '2026-09-02', 1000, 'expense', 'low')
    `)).rejects.toThrow()
  } finally {
    await db.execute(sql`delete from households where id = ${household.id}`)
  }
})

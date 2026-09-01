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
  ]) {
    expect(names, `missing table ${table}`).toContain(table)
  }
})

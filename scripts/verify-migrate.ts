import './load-env'

import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'

import { db } from '../src/db/client'
import { DEFAULT_HOUSEHOLD_NAME } from './migrate-sqlite'

const sqlitePath = process.argv[2]
const householdName = process.argv[3] ?? DEFAULT_HOUSEHOLD_NAME

if (!sqlitePath) {
  console.error('usage: tsx scripts/verify-migrate.ts <finance.db> [household name]')
  process.exit(1)
}

const tables = [
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'recurring',
  'asset_accounts',
  'balance_snapshots',
  'category_rules',
  'import_batches',
  'category_meta',
  'account_aliases',
  'import_inbox',
] as const

async function main() {
  const source = new Database(sqlitePath, { readonly: true })
  try {
    const hasTable = (table: string) =>
      Boolean(
        source
          .prepare("select name from sqlite_master where type = 'table' and name = ?")
          .get(table),
      )

    const [migration] = await db.execute<{ household_id: string }>(sql`
      select setting.household_id
      from settings setting
      join households household on household.id = setting.household_id
      where setting.key = 'migrated_from_sqlite'
        and household.name = ${householdName}
      limit 1
    `)
    if (!migration) throw new Error(`no migrated household named ${householdName}`)

    let valid = true
    for (const table of tables) {
      const sqliteCount = hasTable(table)
        ? (source.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count
        : 0
      const [postgresCount] = await db.execute<{ count: number }>(sql`
        select count(*)::int as count
        from ${sql.identifier(table)}
        where household_id = ${migration.household_id}
      `)
      const matches = sqliteCount === postgresCount.count
      valid &&= matches
      console.log(
        `${matches ? 'OK ' : 'MISMATCH'} ${table.padEnd(18)} sqlite=${sqliteCount} postgres=${postgresCount.count}`,
      )
    }

    const [brokenReferences] = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from transactions tx
      left join categories category
        on category.id = tx.category_id
       and category.household_id = tx.household_id
      left join accounts account
        on account.id = tx.account_id
       and account.household_id = tx.household_id
      left join recurring recurrence
        on recurrence.id = tx.recurring_id
       and recurrence.household_id = tx.household_id
      left join import_batches batch
        on batch.id = tx.import_batch_id
       and batch.household_id = tx.household_id
      where tx.household_id = ${migration.household_id}
        and (
          (tx.category_id is not null and category.id is null)
          or (tx.account_id is not null and account.id is null)
          or (tx.recurring_id is not null and recurrence.id is null)
          or (tx.import_batch_id is not null and batch.id is null)
        )
    `)
    const referencesValid = brokenReferences.count === 0
    valid &&= referencesValid
    console.log(
      `${referencesValid ? 'OK ' : 'FAIL'} broken or cross-household transaction references = ${brokenReferences.count}`,
    )

    if (!valid) process.exitCode = 1
  } finally {
    source.close()
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })

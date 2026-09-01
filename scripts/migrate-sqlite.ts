import './load-env'

import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'

import { db } from '../src/db/client'
import { households, settings } from '../src/db/schema'

const DEFAULT_HOUSEHOLD_NAME = '이동재·김유진 가구'

export type MigrationResult = {
  householdId: string
  counts: Record<string, number>
  skipped: boolean
}

export async function migrateSqlite(
  sqlitePath: string,
  householdName: string = DEFAULT_HOUSEHOLD_NAME,
): Promise<MigrationResult> {
  const source = new Database(sqlitePath, { readonly: true })
  const counts: Record<string, number> = {}

  try {
    const existing = await db.execute<{ household_id: string }>(sql`
      select setting.household_id
      from settings setting
      join households household on household.id = setting.household_id
      where setting.key = 'migrated_from_sqlite'
        and household.name = ${householdName}
      limit 1
    `)
    if (existing.length > 0) {
      return { householdId: existing[0].household_id, counts, skipped: true }
    }

    const hasColumn = (table: string, column: string) =>
      (source.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).some(
        (item) => item.name === column,
      )
    const hasTable = (table: string) =>
      Boolean(
        source
          .prepare("select name from sqlite_master where type = 'table' and name = ?")
          .get(table),
      )
    void hasColumn
    void hasTable

    const householdId = await db.transaction(async (transaction) => {
      const [household] = await transaction
        .insert(households)
        .values({ name: householdName })
        .returning()
      const householdId = household.id

      const accountRows = source.prepare('select * from accounts').all() as Array<
        Record<string, unknown>
      >
      for (const row of accountRows) {
        await transaction.execute(sql`
          insert into accounts
            (id, household_id, name, owner, type, active, sort_order, memo)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.name}, ${row.owner}, ${row.type},
            ${Boolean(row.active)}, ${row.sort_order}, ${row.memo}
          )
        `)
      }
      counts.accounts = accountRows.length

      const categoryRows = source.prepare('select * from categories').all() as Array<
        Record<string, unknown>
      >
      for (const row of categoryRows) {
        await transaction.execute(sql`
          insert into categories
            (id, household_id, kind, major, sub, sort_order, hidden)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.kind}, ${row.major}, ${row.sub},
            ${row.sort_order}, ${Boolean(row.hidden)}
          )
        `)
      }
      counts.categories = categoryRows.length

      // Task 8 inserts the remaining tables here in foreign-key-safe order.

      await transaction.insert(settings).values({
        householdId,
        key: 'migrated_from_sqlite',
        value: '1',
      })
      return householdId
    })

    return { householdId, counts, skipped: false }
  } finally {
    source.close()
  }
}

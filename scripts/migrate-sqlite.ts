import './load-env'

import Database from 'better-sqlite3'
import { sql } from 'drizzle-orm'

import { db } from '../src/db/client'
import { households, settings } from '../src/db/schema'

export const DEFAULT_HOUSEHOLD_NAME = '이동재·김유진 가구'

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

      const batchRows = source.prepare('select * from import_batches').all() as Array<
        Record<string, unknown>
      >
      for (const row of batchRows) {
        await transaction.execute(sql`
          insert into import_batches
            (id, household_id, source, filename, imported_at, row_count)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.source}, ${row.filename},
            coalesce(${row.imported_at ?? null}::timestamp at time zone 'Asia/Seoul', now()),
            ${row.row_count}
          )
        `)
      }
      counts.import_batches = batchRows.length

      const recurringRows = source.prepare('select * from recurring').all() as Array<
        Record<string, unknown>
      >
      for (const row of recurringRows) {
        await transaction.execute(sql`
          insert into recurring
            (id, household_id, flow, fixed, category_id, memo, amount, account_id,
             day, active, sort_order)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.flow}, ${Boolean(row.fixed)},
            ${row.category_id}, ${row.memo}, ${row.amount}, ${row.account_id},
            ${row.day}, ${Boolean(row.active)}, ${row.sort_order}
          )
        `)
      }
      counts.recurring = recurringRows.length

      const assetRows = source.prepare('select * from asset_accounts').all() as Array<
        Record<string, unknown>
      >
      for (const row of assetRows) {
        await transaction.execute(sql`
          insert into asset_accounts
            (id, household_id, major, name, kind, sort_order, active)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.major}, ${row.name}, ${row.kind},
            ${row.sort_order}, ${Boolean(row.active)}
          )
        `)
      }
      counts.asset_accounts = assetRows.length

      const transactionRows = source.prepare('select * from transactions').all() as Array<
        Record<string, unknown>
      >
      for (const row of transactionRows) {
        await transaction.execute(sql`
          insert into transactions
            (id, household_id, date, flow, fixed, category_id, memo, amount,
             account_id, source, raw_merchant, import_batch_id, recurring_id,
             import_uid, created_at)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.date}, ${row.flow}, ${Boolean(row.fixed)},
            ${row.category_id}, ${row.memo}, ${row.amount}, ${row.account_id},
            ${row.source}, ${row.raw_merchant}, ${row.import_batch_id},
            ${row.recurring_id},
            ${hasColumn('transactions', 'import_uid') ? row.import_uid : null},
            coalesce(${row.created_at ?? null}::timestamp at time zone 'Asia/Seoul', now())
          )
        `)
      }
      counts.transactions = transactionRows.length

      const balanceRows = source.prepare('select * from balance_snapshots').all() as Array<
        Record<string, unknown>
      >
      for (const row of balanceRows) {
        await transaction.execute(sql`
          insert into balance_snapshots
            (id, household_id, account_id, month, amount)
          overriding system value
          values (${row.id}, ${householdId}, ${row.account_id}, ${row.month}, ${row.amount})
        `)
      }
      counts.balance_snapshots = balanceRows.length

      const ruleRows = source.prepare('select * from category_rules').all() as Array<
        Record<string, unknown>
      >
      for (const row of ruleRows) {
        const fixed = row.fixed === null || row.fixed === undefined ? null : Boolean(row.fixed)
        await transaction.execute(sql`
          insert into category_rules
            (id, household_id, match_type, pattern, category_id, account_id,
             flow, fixed, priority, hits)
          overriding system value
          values (
            ${row.id}, ${householdId}, ${row.match_type}, ${row.pattern},
            ${row.category_id}, ${row.account_id}, ${row.flow || null}, ${fixed},
            ${row.priority}, ${row.hits}
          )
        `)
      }
      counts.category_rules = ruleRows.length

      if (hasTable('category_meta')) {
        const metaRows = source.prepare('select * from category_meta').all() as Array<
          Record<string, unknown>
        >
        for (const row of metaRows) {
          await transaction.execute(sql`
            insert into category_meta (household_id, major, irregular)
            values (${householdId}, ${row.major}, ${Boolean(row.irregular)})
          `)
        }
        counts.category_meta = metaRows.length
      }

      if (hasTable('account_aliases')) {
        const aliasRows = source.prepare('select * from account_aliases').all() as Array<
          Record<string, unknown>
        >
        for (const row of aliasRows) {
          await transaction.execute(sql`
            insert into account_aliases (household_id, owner, alias, account_id)
            values (${householdId}, ${row.owner}, ${row.alias}, ${row.account_id})
          `)
        }
        counts.account_aliases = aliasRows.length
      }

      const budgetRows = source.prepare('select * from budgets').all() as Array<
        Record<string, unknown>
      >
      for (const row of budgetRows) {
        await transaction.execute(sql`
          insert into budgets (id, household_id, major, month, amount)
          overriding system value
          values (${row.id}, ${householdId}, ${row.major}, ${row.month ?? '*'}, ${row.amount})
        `)
      }
      counts.budgets = budgetRows.length

      const settingRows = source.prepare('select * from settings').all() as Array<
        Record<string, unknown>
      >
      for (const row of settingRows) {
        await transaction.execute(sql`
          insert into settings (household_id, key, value)
          values (${householdId}, ${row.key}, ${row.value})
          on conflict do nothing
        `)
      }
      counts.settings = settingRows.length

      if (hasTable('import_inbox')) {
        const inboxRows = source.prepare('select * from import_inbox').all() as Array<
          Record<string, unknown>
        >
        for (const row of inboxRows) {
          await transaction.execute(sql`
            insert into import_inbox
              (id, household_id, import_uid, owner, date, time, merchant, amount,
               flow, kind, bs_cat1, bs_cat2, pay, account_id, category_id, memo,
               sug_source, dup_note, status, created_at)
            overriding system value
            values (
              ${row.id}, ${householdId}, ${row.import_uid}, ${row.owner}, ${row.date},
              ${row.time}, ${row.merchant}, ${row.amount}, ${row.flow}, ${row.kind},
              ${row.bs_cat1}, ${row.bs_cat2}, ${row.pay}, ${row.account_id},
              ${row.category_id}, ${row.memo},
              ${hasColumn('import_inbox', 'sug_source') ? row.sug_source : null},
              ${hasColumn('import_inbox', 'dup_note') ? row.dup_note : null},
              ${row.status},
              coalesce(${row.created_at ?? null}::timestamp at time zone 'Asia/Seoul', now())
            )
          `)
        }
        counts.import_inbox = inboxRows.length
      }

      // Explicit legacy IDs do not advance identity sequences. greatest(..., 1)
      // also keeps negative-only test fixtures valid after sequence reset.
      for (const table of [
        'accounts',
        'categories',
        'import_batches',
        'recurring',
        'asset_accounts',
        'transactions',
        'balance_snapshots',
        'category_rules',
        'budgets',
        'import_inbox',
      ]) {
        await transaction.execute(
          sql.raw(`
            select setval(
              pg_get_serial_sequence('${table}', 'id'),
              greatest(coalesce((select max(id) from ${table}), 0) + 1, 1),
              false
            )
          `),
        )
      }

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

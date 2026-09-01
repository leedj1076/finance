import Database from 'better-sqlite3'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { migrateSqlite } from '../../scripts/migrate-sqlite'
import { db } from '@/db/client'

const testHouseholdName = 'TEST 가구'
const fixturePaths = new Set<string>()

function makeFixture(): string {
  const path = join(tmpdir(), `finance-migrate-${process.pid}-${Date.now()}.db`)
  fixturePaths.add(path)
  const source = new Database(path)
  source.exec(
    readFileSync('/Users/leedj/workspace/Personal/finance/schema.sql', 'utf8'),
  )
  // Negative fixture IDs cannot collide with preserved positive IDs after the
  // real household has been migrated into the same local database.
  source.exec(`
    insert into accounts (id, name, owner, type)
    values (-10001, 'DJ 국민', 'DJ', 'card'), (-10002, '현금', '공용', 'cash');
  `)
  source.exec(`
    insert into categories (id, kind, major, sub)
    values (-20001, 'expense', '식비', '외식'), (-20002, 'income', '월급', '남편월급');
  `)
  // Reproduce schema added at runtime by the legacy db.py migrations.
  source.exec('alter table transactions add column import_uid text;')
  source.exec(`
    create table category_meta (
      major text primary key,
      irregular integer not null default 0
    );
  `)
  source.exec(`
    create table account_aliases (
      owner text not null,
      alias text not null,
      account_id integer not null references accounts(id),
      primary key (owner, alias)
    );
  `)
  source.exec(`
    create table import_inbox (
      id integer primary key,
      import_uid text not null unique,
      owner text not null,
      date text not null,
      time text,
      merchant text,
      amount integer not null,
      flow text not null,
      kind text not null default 'normal',
      bs_cat1 text,
      bs_cat2 text,
      pay text,
      account_id integer references accounts(id),
      category_id integer references categories(id),
      memo text,
      status text not null default 'pending',
      created_at text not null default '2026-06-01 00:00:00',
      sug_source text,
      dup_note text
    );
  `)
  source.exec(`
    insert into import_batches (id, source, filename, imported_at, row_count)
    values (-30001, 'banksalad', 'fixture.xlsx', '2026-06-01 09:00:00', 1);
    insert into recurring
      (id, flow, category_id, memo, amount, account_id, day)
    values (-40001, 'expense', -20001, '정기 점심', 25000, -10001, 10);
    insert into asset_accounts (id, major, name, kind)
    values (-50001, '현금', '국민통장', 'asset');
    insert into transactions
      (id, date, flow, category_id, account_id, amount, memo, import_batch_id,
       recurring_id, import_uid)
    values (
      -60001, '2026-06-10', 'expense', -20001, -10001, 25000, '점심',
      -30001, -40001, 'uid-tx-1'
    );
    insert into balance_snapshots (id, account_id, month, amount)
    values (-70001, -50001, '2026-06', 1000000);
    insert into category_rules
      (id, match_type, pattern, category_id, account_id, flow, fixed)
    values (-80001, 'merchant_norm', '점심집', -20001, -10001, 'expense', 0);
    insert into budgets (id, major, month, amount)
    values (-90001, '식비', '*', 800000);
    insert into settings (key, value) values ('savings_target_rate', '30');
    insert into category_meta (major, irregular) values ('여행', 1);
    insert into account_aliases (owner, alias, account_id)
    values ('DJ', '네이버페이', -10001);
    insert into import_inbox
      (id, import_uid, owner, date, amount, flow, account_id, category_id,
       sug_source, dup_note)
    values (
      -100001, 'uid-ib-1', 'DJ', '2026-06-11', 3000, 'expense', -10001,
      -20001, 'history', '유사거래 있음'
    );
  `)
  source.close()
  return path
}

async function wipeTestHousehold() {
  await db.execute(sql`delete from households where name = ${testHouseholdName}`)
}

beforeEach(wipeTestHousehold)
afterEach(async () => {
  await wipeTestHousehold()
  for (const path of fixturePaths) unlinkSync(path)
  fixturePaths.clear()
})

test('migrates accounts and categories preserving ids', async () => {
  const result = await migrateSqlite(makeFixture(), testHouseholdName)
  expect(result.counts.accounts).toBe(2)
  expect(result.counts.categories).toBe(2)

  const accounts = await db.execute<{ id: number; name: string }>(sql`
    select id::int, name
    from accounts
    where household_id = ${result.householdId}
    order by id
  `)
  expect(accounts[0]).toMatchObject({ id: -10002, name: '현금' })
  expect(accounts[1]).toMatchObject({ id: -10001, name: 'DJ 국민' })
})

test('is idempotent and skips the second run', async () => {
  const fixture = makeFixture()
  await migrateSqlite(fixture, testHouseholdName)
  const second = await migrateSqlite(fixture, testHouseholdName)
  expect(second.skipped).toBe(true)
})

test('migrates runtime-added tables and resets identity sequences', async () => {
  const result = await migrateSqlite(makeFixture(), testHouseholdName)

  expect(result.counts).toMatchObject({
    import_batches: 1,
    recurring: 1,
    asset_accounts: 1,
    transactions: 1,
    balance_snapshots: 1,
    category_rules: 1,
    category_meta: 1,
    account_aliases: 1,
    budgets: 1,
    settings: 1,
    import_inbox: 1,
  })

  const [transaction] = await db.execute<{ import_uid: string }>(sql`
    select import_uid
    from transactions
    where household_id = ${result.householdId}
  `)
  expect(transaction.import_uid).toBe('uid-tx-1')

  const [inbox] = await db.execute<{ sug_source: string; dup_note: string }>(sql`
    select sug_source, dup_note
    from import_inbox
    where household_id = ${result.householdId}
  `)
  expect(inbox).toMatchObject({
    sug_source: 'history',
    dup_note: '유사거래 있음',
  })

  await db.execute(sql`
    insert into transactions (household_id, date, flow, amount)
    values (${result.householdId}, '2026-07-01', 'income', 5000)
  `)
  const [count] = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from transactions
    where household_id = ${result.householdId}
  `)
  expect(count.count).toBe(2)
})

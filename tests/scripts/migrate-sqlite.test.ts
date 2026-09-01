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

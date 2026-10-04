import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { db } from '@/db/client'
import { households, investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'

const householdIds: string[] = []
const userIds = [randomUUID(), randomUUID()]
const raw = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const tables = ['investment_accounts', 'investment_securities', 'investment_transactions', 'latest_quotes', 'price_snapshots', 'fx_rates', 'broker_positions', 'investment_settings', 'research_jobs', 'sync_jobs']
let accountId = 0
let securityId = 0

beforeAll(async () => {
  const created = await db.insert(households).values([{ name: 'TEST-invest-schema' }, { name: 'TEST-invest-other' }]).returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  const [account] = await db.insert(investmentAccounts).values({
    householdId: householdIds[0], owner: 'DJ', name: 'DJ 키움 종합', broker: 'kiwoom', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom',
  }).returning({ id: investmentAccounts.id })
  accountId = account.id
  const [security] = await db.insert(investmentSecurities).values({
    householdId: householdIds[0], market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW',
  }).returning({ id: investmentSecurities.id })
  securityId = security.id
  for (const [i, householdId] of householdIds.entries()) {
    await raw`insert into auth.users (id) values (${userIds[i]})`
    await raw`insert into household_members (household_id, user_id) values (${householdId}, ${userIds[i]})`
    const [account] = await raw`insert into investment_accounts (household_id, owner, name, broker_account_no, credential_ref) values (${householdId}, 'YJ', 'RLS account', '87654321', 'test-reference') returning id`
    const [security] = await raw`insert into investment_securities (household_id, market, symbol, name, currency, exposure_currency) values (${householdId}, 'US', 'TEST', 'RLS security', 'USD', 'USD') returning id`
    await raw`insert into investment_transactions (household_id, account_id, kind, trade_date, amount, currency, source) values (${householdId}, ${account.id}, 'deposit', '2026-09-01', 100, 'USD', 'manual')`
    await raw`insert into latest_quotes (household_id, security_id, price, quoted_at, source) values (${householdId}, ${security.id}, 10, now(), 'manual')`
    await raw`insert into price_snapshots (household_id, security_id, date, close, currency, source) values (${householdId}, ${security.id}, '2026-09-01', 10, 'USD', 'manual')`
    await raw`insert into fx_rates (household_id, date, rate, source) values (${householdId}, '2026-09-01', 1380, 'manual')`
    await raw`insert into broker_positions (household_id, account_id, security_id, quantity, avg_cost, synced_at) values (${householdId}, ${account.id}, ${security.id}, 1, 10, now())`
    await raw`insert into investment_settings (household_id) values (${householdId})`
    await raw`insert into research_jobs (household_id, kind, prompt_version, snapshot) values (${householdId}, 'portfolio', 'test', '{}')`
    await raw`insert into sync_jobs (household_id, kind, trigger) values (${householdId}, 'snapshot', 'user')`
  }
})

afterAll(async () => {
  for (const id of householdIds) await db.delete(households).where(eq(households.id, id))
  await raw`delete from auth.users where id in ${raw(userIds)}`
  await raw.end()
})

describe('investment schema constraints', () => {
  test.each(tables)('%s exposes own household only and grants authenticated read only', async (table) => {
    for (const [i, userId] of userIds.entries()) {
      const rows = await raw.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`
        return tx`select household_id from ${tx(table)}`
      })
      expect(rows.length).toBeGreaterThan(0)
      expect([...new Set(rows.map((row) => row.household_id))]).toEqual([householdIds[i]])
    }
    for (const role of ['authenticated', 'anon', 'service_role']) {
      const [privilege] = await raw`select has_table_privilege(${role}, ${table}, 'SELECT') as read, has_table_privilege(${role}, ${table}, 'INSERT, UPDATE, DELETE') as write`
      expect(privilege).toEqual({ read: role === 'authenticated', write: false })
    }
  })
  test('rejects an unknown transaction kind', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'gift' as never, tradeDate: '2026-09-01',
      quantity: '1', price: '1', fee: '0', amount: '-1', currency: 'KRW', source: 'manual',
    })).rejects.toMatchObject({ cause: { constraint_name: 'investment_transactions_kind_check' } })
  })

  test('rejects buy without quantity and price', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'buy', tradeDate: '2026-09-01',
      quantity: null, price: null, fee: '0', amount: '0', currency: 'KRW', source: 'manual',
    })).rejects.toMatchObject({ cause: { constraint_name: 'investment_transactions_trade_fields_check' } })
  })

  test('rejects deposit with a security', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'deposit', tradeDate: '2026-09-01',
      quantity: null, price: null, fee: '0', amount: '1000', currency: 'KRW', source: 'manual',
    })).rejects.toMatchObject({ cause: { constraint_name: 'investment_transactions_cash_fields_check' } })
  })

  test('rejects kiwoom rows without broker_ref and duplicates of the same broker_ref', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'buy', tradeDate: '2026-09-01',
      quantity: '1', price: '70000', fee: '0', amount: '-70000', currency: 'KRW', source: 'kiwoom', brokerRef: null,
    })).rejects.toMatchObject({ cause: { constraint_name: 'investment_transactions_source_ref_check' } })
    const row = {
      householdId: householdIds[0], accountId, securityId, kind: 'buy' as const, tradeDate: '2026-09-01',
      quantity: '1', price: '70000', fee: '0', amount: '-70000', currency: 'KRW' as const, source: 'kiwoom' as const, brokerRef: 'F-1',
    }
    await db.insert(investmentTransactions).values(row)
    await expect(db.insert(investmentTransactions).values(row)).rejects.toMatchObject({ cause: { constraint_name: 'investment_transactions_account_broker_ref' } })
  })

  test('securities are unique per household, market and symbol', async () => {
    await expect(db.insert(investmentSecurities).values({
      householdId: householdIds[0], market: 'KR', symbol: '005930', name: '중복', currency: 'KRW', exposureCurrency: 'KRW',
    })).rejects.toMatchObject({ cause: { constraint_name: 'investment_securities_household_market_symbol' } })
  })

  test('authenticated role can only select rows of its own household', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
    try {
      const rows = await sql.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' })}, true)`
        return tx`select id from public.investment_accounts`
      })
      expect(rows).toHaveLength(0)
      await expect(sql.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`insert into public.investment_accounts (household_id, owner, name, broker, broker_account_no, credential_ref) values (${householdIds[0]}, 'DJ', 'x', 'kiwoom', '1', 'r')`
      })).rejects.toThrow(/permission denied/)
    } finally {
      await sql.end()
    }
  })
})

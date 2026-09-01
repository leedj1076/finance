import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const raw = postgres(process.env.DATABASE_URL!, { prepare: false })
const createdUserIds: string[] = []
const context: {
  householdA?: string
  householdB?: string
  clientA?: SupabaseClient
  clientB?: SupabaseClient
} = {}

let admin: SupabaseClient

async function makeUser(email: string) {
  const password = 'passw0rd!'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  createdUserIds.push(data.user.id)

  const client = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  return { user: data.user, client }
}

beforeAll(async () => {
  admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const suffix = Date.now()
  const userA = await makeUser(`rls-a-${suffix}@test.local`)
  const userB = await makeUser(`rls-b-${suffix}@test.local`)
  context.clientA = userA.client
  context.clientB = userB.client

  const [householdA] = await raw`
    insert into households (name) values (${`RLS-A-${suffix}`}) returning id
  `
  const [householdB] = await raw`
    insert into households (name) values (${`RLS-B-${suffix}`}) returning id
  `
  context.householdA = householdA.id
  context.householdB = householdB.id

  await raw`
    insert into household_members (household_id, user_id)
    values (${householdA.id}, ${userA.user.id})
  `
  await raw`
    insert into household_members (household_id, user_id)
    values (${householdB.id}, ${userB.user.id})
  `
  await raw`
    insert into transactions (household_id, date, flow, amount, memo)
    values (${householdA.id}, '2026-06-01', 'expense', 12345, 'A-secret')
  `
})

afterAll(async () => {
  const householdIds = [context.householdA, context.householdB].filter(
    (id): id is string => Boolean(id),
  )
  if (householdIds.length > 0) {
    await raw`delete from households where id in ${raw(householdIds)}`
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id)
  }
  await raw.end()
})

test('member A sees own household transaction', async () => {
  const { data, error } = await context.clientA!.from('transactions').select('memo')
  expect(error).toBeNull()
  expect(data?.map((row) => row.memo)).toContain('A-secret')
})

test('member B cannot see household A transaction', async () => {
  const { data, error } = await context.clientB!.from('transactions').select('memo')
  expect(error).toBeNull()
  expect(data ?? []).toHaveLength(0)
})

test('user cannot self-join another household', async () => {
  const { data } = await context.clientB!.auth.getUser()
  const { error } = await context.clientB!.from('household_members').insert({
    household_id: context.householdA!,
    user_id: data.user!.id,
  })
  expect(error).not.toBeNull()
})

test('user with no membership sees nothing', async () => {
  const client = (await makeUser(`rls-none-${Date.now()}@test.local`)).client
  const { data, error } = await client.from('transactions').select('memo')
  expect(error).toBeNull()
  expect(data ?? []).toHaveLength(0)
})

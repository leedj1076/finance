import './load-env'

import { createClient } from '@supabase/supabase-js'
import { sql } from 'drizzle-orm'

import { db } from '../src/db/client'
import { DEFAULT_HOUSEHOLD_NAME } from './migrate-sqlite'

const email = process.argv[2]
const householdName = process.argv[3] ?? DEFAULT_HOUSEHOLD_NAME

if (!email) {
  console.error('usage: tsx scripts/link-user.ts <email> [household name]')
  process.exit(1)
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error

  const user = data.users.find((candidate) => candidate.email === email)
  if (!user) {
    throw new Error(`no auth user for ${email}; create the account first`)
  }

  const households = await db.execute<{ id: string }>(sql`
    select household.id
    from households household
    join settings setting on setting.household_id = household.id
    where household.name = ${householdName}
      and setting.key = 'migrated_from_sqlite'
    limit 1
  `)
  if (households.length === 0) {
    throw new Error(`no migrated household named ${householdName}`)
  }

  await db.execute(sql`
    insert into household_members (household_id, user_id, role)
    values (${households[0].id}, ${user.id}, 'owner')
    on conflict do nothing
  `)
  console.log(`linked ${email} to household ${households[0].id}`)
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })

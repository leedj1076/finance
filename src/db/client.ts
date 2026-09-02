import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// Supabase's transaction pooler does not support prepared statements. A very
// small pool lets independent dashboard queries run concurrently while
// Supabase's transaction pooler still prevents direct Postgres fan-out.
// This owner connection bypasses RLS, so every domain query must additionally
// filter by the household id returned by requireHousehold().
const queryClient = postgres(url, {
  prepare: false,
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(queryClient, { schema })

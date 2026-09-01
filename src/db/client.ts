import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// Supabase's transaction pooler does not support prepared statements. Keeping
// one connection per serverless instance also prevents connection fan-out.
// This owner connection bypasses RLS, so every domain query must additionally
// filter by the household id returned by requireHousehold().
const queryClient = postgres(url, { prepare: false, max: 1 })

export const db = drizzle(queryClient, { schema })

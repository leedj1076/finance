import { expect, test } from 'vitest'
import postgres from 'postgres'

test('can connect to local postgres', async () => {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false })
  const rows = await sql`select 1 as ok`
  expect(rows[0].ok).toBe(1)
  await sql.end()
})

import './load-env'

import { migrateSqlite } from './migrate-sqlite'

const sqlitePath = process.argv[2]
const householdName = process.argv[3]

if (!sqlitePath) {
  console.error('usage: tsx scripts/run-migrate.ts <finance.db> [household name]')
  process.exit(1)
}

migrateSqlite(sqlitePath, householdName)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })

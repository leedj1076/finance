import './load-env'

import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, open, realpath, rm } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import postgres from 'postgres'
import { parseDiagnosisWorkerConfig } from '../src/features/diagnosis/worker'

const usage = `Usage:
  pnpm diagnosis:setup --list
  pnpm diagnosis:setup --household <uuid> [--config <private-json-path>] [--codex <absolute-path>] [--model <model>] [--label <name>]
  pnpm diagnosis:setup --household <uuid> --revoke <worker-uuid>

Uses DATABASE_URL only for registration; worker config contains only a household-scoped token and the public Supabase key.
Existing config files are never overwritten. Stop a worker before revoking its connection.`

async function main() {
  const options = new Map<string, string>()
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help')) { console.log(usage); return }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (!['--list', '--household', '--config', '--codex', '--model', '--label', '--revoke'].includes(key) || options.has(key)) throw new Error('invalid_arguments')
    if (key === '--list') options.set(key, 'true')
    else {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('invalid_arguments')
      options.set(key, value)
    }
  }
  const householdId = options.get('--household')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!options.has('--list') && (!householdId || !uuid.test(householdId))) throw new Error('invalid_arguments')
  if (options.has('--list') && options.size !== 1) throw new Error('invalid_arguments')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('missing_database_url')
  const database = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 10 })
  try {
    if (options.has('--list')) {
      const rows = await database<{ id: string; name: string }[]>`select id, name from households order by created_at`
      for (const row of rows) console.log(`${row.id}  ${row.name}`)
      return
    }
    const [household] = await database`select id from households where id = ${householdId!}`
    if (!household) throw new Error('household_not_found')
    const revoke = options.get('--revoke')
    if (revoke) {
      if (!uuid.test(revoke) || options.size !== 2) throw new Error('invalid_arguments')
      const rows = await database`update diagnosis_workers set revoked_at = now() where id = ${revoke} and household_id = ${householdId!} returning id`
      if (!rows.length) throw new Error('worker_not_found')
      console.log(`Revoked worker ${revoke}.`)
      return
    }
    const configPath = resolve(options.get('--config') ?? join(homedir(), '.config', 'finance-web', 'diagnosis-worker.json'))
    const codexPath = await realpath(options.get('--codex') ?? join(homedir(), '.local', 'bin', 'codex'))
    await access(codexPath, constants.X_OK)
    const token = randomBytes(32).toString('base64url')
    const config = parseDiagnosisWorkerConfig({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, workerToken: token, codexPath, ...(options.has('--model') ? { model: options.get('--model') } : {}) })
    const label = options.get('--label') ?? hostname()
    if (!label.trim() || label.length > 100 || /[\u0000-\u001f]/.test(label)) throw new Error('invalid_arguments')
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 })
    const file = await open(configPath, 'wx', 0o600)
    try {
      await database.begin(async tx => {
        const [worker] = await tx`insert into diagnosis_workers (household_id, token_hash, label) values (${householdId!}, ${createHash('sha256').update(token).digest('hex')}, ${label}) returning id`
        await file.writeFile(JSON.stringify(config, null, 2) + '\n')
        await file.sync()
        console.log(`Registered worker ${worker.id} for household ${householdId}.`)
      })
    } catch (error) {
      await rm(configPath, { force: true })
      throw error
    } finally { await file.close() }
    console.log(`Private configuration: ${configPath}`)
    console.log('Run: pnpm diagnosis:worker --config <the-private-configuration-path>')
  } finally { await database.end() }
}

main().catch(error => {
  const known = new Set(['invalid_arguments', 'missing_database_url', 'household_not_found', 'worker_not_found'])
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  console.error(code === 'EEXIST' ? 'Configuration already exists; choose another --config path or explicitly revoke the old worker first.' : error instanceof Error && known.has(error.message) ? error.message : 'Worker registration failed. Check database migration, household ID, public Supabase settings and Codex executable.')
  process.exitCode = 1
})

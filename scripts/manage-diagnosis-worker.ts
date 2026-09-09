import { execFileSync } from 'node:child_process'
import { access, chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { loadDiagnosisWorkerConfig } from '../src/features/diagnosis/worker'

const label = 'family.blissful.diagnosis-worker'
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const domain = `gui/${process.getuid?.()}`
const xml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const launchctl = (args: string[]) => execFileSync('/bin/launchctl', args, { stdio: 'pipe', encoding: 'utf8' })

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === '--help') {
    console.log('Usage: pnpm diagnosis:service install [--config <path>] | status | uninstall')
    return
  }
  if (process.platform !== 'darwin') throw new Error('macOS is required for the background service.')
  if (!['install', 'status', 'uninstall'].includes(command)) throw new Error('Unknown command.')
  if (command === 'status') {
    if (args.length) throw new Error('Unexpected arguments.')
    try { console.log(launchctl(['print', `${domain}/${label}`])) } catch { console.log('Diagnosis worker is not loaded.') }
    return
  }
  if (command === 'uninstall') {
    if (args.length) throw new Error('Unexpected arguments.')
    // This command only touches the one explicitly named service we installed.
    const contents = await readFile(plist, 'utf8')
    if (!contents.includes('finance-web diagnosis worker')) throw new Error('Service file ownership marker did not match.')
    try { launchctl(['bootout', domain, plist]) } catch { /* Already stopped. */ }
    await unlink(plist)
    console.log('Background service removed. The private worker token remains available for manual use or revocation.')
    return
  }
  if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Unexpected arguments.')
  const configPath = resolve(args[1] ?? join(homedir(), '.config', 'finance-web', 'diagnosis-worker.json'))
  await loadDiagnosisWorkerConfig(configPath)
  const repo = resolve(dirname(process.argv[1]), '..')
  const require = createRequire(join(repo, 'package.json'))
  const tsx = require.resolve('tsx/cli')
  const logDir = join(homedir(), 'Library', 'Logs', 'finance-web')
  await mkdir(dirname(plist), { recursive: true })
  await mkdir(logDir, { recursive: true, mode: 0o700 })
  const stdout = join(logDir, 'diagnosis-worker.log')
  const stderr = join(logDir, 'diagnosis-worker-error.log')
  for (const path of [stdout, stderr]) { await writeFile(path, '', { flag: 'a', mode: 0o600 }); await chmod(path, 0o600) }
  await access(join(repo, 'scripts', 'diagnosis-worker.ts'))
  const values = [process.execPath, tsx, join(repo, 'scripts', 'diagnosis-worker.ts'), '--config', configPath]
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- finance-web diagnosis worker -->
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${values.map(value => `<string>${xml(value)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(repo)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${xml(stdout)}</string>
<key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict></plist>\n`
  await writeFile(plist, content, { flag: 'wx', mode: 0o600 })
  try {
    execFileSync('/usr/bin/plutil', ['-lint', plist], { stdio: 'pipe' })
    launchctl(['bootstrap', domain, plist])
  } catch {
    await unlink(plist)
    throw new Error('Could not load the background service.')
  }
  console.log('Diagnosis worker installed for this macOS login. The Mac must remain awake to process requests.')
}

main().catch(error => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  console.error(code === 'EEXIST' ? 'Service already exists; uninstall it explicitly before installing again.' : 'Could not manage the diagnosis service. Check command arguments, private configuration and service status.')
  process.exitCode = 1
})

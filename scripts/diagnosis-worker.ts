import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DiagnosisWorkerError, loadDiagnosisWorkerConfig, runDiagnosisWorker } from '../src/features/diagnosis/worker'

function argumentsForWorker(args: string[]) {
  let configPath = join(homedir(), '.config', 'finance-web', 'diagnosis-worker.json')
  let once = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--once') once = true
    else if (args[index] === '--config' && args[index + 1] && !args[index + 1].startsWith('--')) configPath = resolve(args[++index])
    else throw new DiagnosisWorkerError('invalid_worker_config')
  }
  return { configPath, once }
}

async function main() {
  const { configPath, once } = argumentsForWorker(process.argv.slice(2))
  const config = await loadDiagnosisWorkerConfig(configPath)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  try {
    await runDiagnosisWorker(config, { once, signal: controller.signal,
      log: (event, jobId) => process.stdout.write(JSON.stringify({ event, ...(jobId ? { jobId } : {}) }) + '\n') })
  } finally {
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

main().catch(error => {
  // Never print a config path, token, prompt, report or upstream error body.
  const code = error instanceof DiagnosisWorkerError ? error.code : 'rpc_failed'
  process.stderr.write(JSON.stringify({ event: code }) + '\n')
  process.exitCode = 1
})

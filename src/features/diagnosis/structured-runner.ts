import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import type { DiagnosisErrorCode } from './types'

export type StructuredRunnerOptions = {
  codexPath: string
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export class DiagnosisRunnerError extends Error {
  constructor(readonly code: DiagnosisErrorCode) {
    super(code)
    this.name = 'DiagnosisRunnerError'
  }
}

export function getDiagnosisErrorCode(error: unknown): DiagnosisErrorCode {
  return error instanceof DiagnosisRunnerError ? error.code : 'cli_failed'
}

const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 16 * 1024
export const DEFAULT_STRUCTURED_TIMEOUT_MS = 180_000
export const MAX_STRUCTURED_TIMEOUT_MS = 300_000
const KILL_GRACE_MS = 1_000

const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'code_mode', 'code_mode_only', 'js_repl',
  'hooks', 'plugin_hooks', 'apps', 'plugins', 'multi_agent', 'multi_agent_v2',
  'enable_fanout', 'memories', 'view_image', 'image_generation', 'browser_use',
  'computer_use', 'shell_snapshot', 'request_permissions_tool', 'tool_suggest',
  'standalone_web_search', 'deferred_executor',
]

export function structuredTimeoutMs(value?: number): number {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new DiagnosisRunnerError('cli_failed')
  }
  return Math.min(value ?? DEFAULT_STRUCTURED_TIMEOUT_MS, MAX_STRUCTURED_TIMEOUT_MS)
}

function childEnvironment(jobDir: string): NodeJS.ProcessEnv {
  const actualHome = homedir()
  const codexHome = process.env.CODEX_HOME || join(actualHome, '.codex')
  if (!isAbsolute(codexHome)) throw new DiagnosisRunnerError('cli_failed')
  return {
    HOME: actualHome,
    CODEX_HOME: codexHome,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TMPDIR: jobDir,
    NO_COLOR: '1',
    NODE_ENV: 'production',
  }
}

function killGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal)
  } catch {
    // An already-exited invocation has no process group left to stop.
  }
}

async function readFinalReport<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) throw new Error('invalid')
      const buffer = Buffer.alloc(MAX_OUTPUT_BYTES + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (!bytesRead || bytesRead > MAX_OUTPUT_BYTES) throw new Error('invalid')
      return parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')))
    } finally {
      await file.close()
    }
  } catch {
    throw new DiagnosisRunnerError('invalid_output')
  }
}

export async function runStructuredCodex<T>(
  input: { prompt: string; schema: object; parse: (value: unknown) => T },
  options: StructuredRunnerOptions,
): Promise<T> {
  if (options.signal?.aborted) throw new DiagnosisRunnerError('worker_stopped')
  if (!isAbsolute(options.codexPath)
    || (options.model !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(options.model))) {
    throw new DiagnosisRunnerError('cli_failed')
  }
  const timeoutMs = structuredTimeoutMs(options.timeoutMs)
  let jobDir: string | undefined
  try {
    jobDir = await mkdtemp(join(tmpdir(), 'finance-diagnosis-'))
    const schemaPath = join(jobDir, 'schema.json')
    const outputPath = join(jobDir, 'report.json')
    await writeFile(schemaPath, JSON.stringify(input.schema), { mode: 0o400, flag: 'wx' })
    const args = [
      '-a', 'never', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
      '--strict-config', '--sandbox', 'read-only', '--skip-git-repo-check', '--json',
      '--color', 'never', '--cd', jobDir, '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-c', 'web_search="disabled"',
      '-c', 'orchestrator.mcp.enabled=false',
      '-c', 'orchestrator.skills.enabled=false',
      '-c', 'skills.include_instructions=false',
      '-c', 'project_doc_max_bytes=0',
      '-c', 'include_environment_context=false',
      '-c', 'include_apps_instructions=false',
      '-c', 'allow_login_shell=false',
      '-c', 'shell_environment_policy.inherit="none"',
      '-c', 'memories.use_memories=false',
      '-c', 'memories.generate_memories=false',
      '-c', 'tools.update_plan.enabled=false',
      '-c', 'tools.experimental_request_user_input.enabled=false',
      ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
      ...(options.model ? ['--model', options.model] : []),
      '-',
    ]
    const env = childEnvironment(jobDir)
    if (options.signal?.aborted) throw new DiagnosisRunnerError('worker_stopped')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.codexPath, args, {
        shell: false, cwd: jobDir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
      let failure: DiagnosisErrorCode | undefined
      let stdoutBytes = 0
      let stderrBytes = 0
      let completedTurn = false
      let pendingLine = ''
      const decoder = new StringDecoder('utf8')
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (code: DiagnosisErrorCode) => {
        if (failure) return
        failure = code
        child.stdin.destroy()
        killGroup(child.pid, 'SIGTERM')
        killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS)
      }
      const abort = () => stop('worker_stopped')
      const consumeEvent = (line: string) => {
        if (!line.trim() || failure) return
        try {
          const event = JSON.parse(line)
          if (!event || typeof event !== 'object') throw new Error()
          if (event.type === 'turn.failed' || event.type === 'error') {
            stop('cli_failed')
          } else if (event.type === 'turn.completed') {
            completedTurn = true
          } else if (['item.started', 'item.updated', 'item.completed'].includes(event.type)) {
            if (!['agent_message', 'reasoning'].includes(event.item?.type)) stop('invalid_output')
          } else if (!['thread.started', 'turn.started'].includes(event.type)) {
            stop('invalid_output')
          }
        } catch {
          stop('invalid_output')
        }
      }
      const timer = setTimeout(() => stop('timeout'), timeoutMs)
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > MAX_OUTPUT_BYTES) { stop('invalid_output'); return }
        pendingLine += decoder.write(chunk)
        let newline: number
        while ((newline = pendingLine.indexOf('\n')) !== -1) {
          consumeEvent(pendingLine.slice(0, newline))
          pendingLine = pendingLine.slice(newline + 1)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        if (stderrBytes > MAX_STDERR_BYTES) stop('cli_failed')
      })
      child.stdin.on('error', () => stop('cli_failed'))
      child.on('error', () => stop('cli_failed'))
      child.on('close', (code) => {
        consumeEvent(pendingLine + decoder.end())
        clearTimeout(timer)
        clearTimeout(killTimer)
        options.signal?.removeEventListener('abort', abort)
        killGroup(child.pid, 'SIGKILL')
        if (failure) reject(new DiagnosisRunnerError(failure))
        else if (code !== 0) reject(new DiagnosisRunnerError('cli_failed'))
        else if (!completedTurn) reject(new DiagnosisRunnerError('invalid_output'))
        else resolve()
      })
      child.stdin.end(input.prompt)
    })
    if (options.signal?.aborted) throw new DiagnosisRunnerError('worker_stopped')
    return await readFinalReport(outputPath, input.parse)
  } catch (error) {
    throw error instanceof DiagnosisRunnerError ? error : new DiagnosisRunnerError('cli_failed')
  } finally {
    if (jobDir) await rm(jobDir, { recursive: true, force: true }).catch(() => {})
  }
}

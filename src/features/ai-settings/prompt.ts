import { createHash } from 'node:crypto'

import { AI_DEFAULTS, AI_DEFAULTS_VERSION } from './defaults'
import type { AiKind, AiPromptInput, AiPromptPolicy, AiSettingsState, ResolvedAiInstructions } from './types'

const PROMPT_INPUT_LIMIT = 128 * 1024
const HASH = /^[0-9a-f]{64}$/
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/
const VERSION = /^[a-z0-9][a-z0-9_-]{0,63}$/

function invalid(): never {
  throw new Error('invalid_ai_prompt')
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) invalid()
}

function canonical(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid()
    return JSON.stringify(value)
  }
  if (typeof value !== 'object' || seen.has(value)) invalid()
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) invalid()
        items.push(canonical(value[index], seen))
      }
      return `[${items.join(',')}]`
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) invalid()
    const input = value as Record<string, unknown>
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonical(input[key], seen)}`).join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalAiJson(value: unknown): string {
  return canonical(value, new Set())
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function resolveAiInstructions(settings: AiSettingsState, kind: AiKind): ResolvedAiInstructions {
  const taskValue = kind === 'ledger' ? settings.ledgerInstructions : settings.budgetInstructions
  return {
    kind,
    settingsRevision: settings.revision,
    defaultsVersion: AI_DEFAULTS_VERSION,
    common: settings.commonInstructions ?? AI_DEFAULTS.commonInstructions,
    task: taskValue ?? (kind === 'ledger' ? AI_DEFAULTS.ledgerInstructions : AI_DEFAULTS.budgetInstructions),
    commonSource: settings.commonInstructions === null ? 'default' : 'custom',
    taskSource: taskValue === null ? 'default' : 'custom',
  }
}

export function aiInstructionsHash(instructions: ResolvedAiInstructions, policyVersion: string): string {
  return sha256(canonicalAiJson({
    kind: instructions.kind,
    common: instructions.common,
    task: instructions.task,
    defaultsVersion: instructions.defaultsVersion,
    policyVersion,
  }))
}

function validatePolicy(policy: AiPromptPolicy) {
  const input = plainRecord(policy)
  exactKeys(input, ['version', 'before', 'after', 'dataTag'])
  if (typeof policy.version !== 'string' || !VERSION.test(policy.version)) invalid()
  if (typeof policy.before !== 'string' || typeof policy.after !== 'string') invalid()
  if (!IDENTIFIER.test(policy.dataTag)) invalid()
}

function validateInstructions(value: unknown, kind: AiKind): ResolvedAiInstructions {
  const input = plainRecord(value)
  exactKeys(input, ['kind', 'settingsRevision', 'defaultsVersion', 'common', 'task', 'commonSource', 'taskSource'])
  if (input.kind !== kind || !Number.isInteger(input.settingsRevision) || (input.settingsRevision as number) < 0) invalid()
  if (typeof input.defaultsVersion !== 'string' || !VERSION.test(input.defaultsVersion)) invalid()
  if (typeof input.common !== 'string' || typeof input.task !== 'string') invalid()
  if ([...input.common].length > 4_000 || [...input.task].length > 6_000) invalid()
  if (!['default', 'custom'].includes(input.commonSource as string) || !['default', 'custom'].includes(input.taskSource as string)) invalid()
  return input as ResolvedAiInstructions
}

export function freezeAiPromptInput(
  instructions: ResolvedAiInstructions,
  policy: AiPromptPolicy,
  snapshot: unknown,
): AiPromptInput {
  const checked = validateInstructions(instructions, instructions.kind)
  validatePolicy(policy)
  const data = canonicalAiJson(snapshot)
  const instructionBlock = canonicalAiJson({
    commonInstructions: checked.common,
    taskInstructions: checked.task,
  })
  const prefix = `${policy.before}\n<editable_ai_instructions_json>\n${instructionBlock}\n</editable_ai_instructions_json>\n${policy.after}\n<${policy.dataTag}>\n`
  const suffix = `\n</${policy.dataTag}>`
  const result: AiPromptInput = {
    version: 1,
    kind: checked.kind,
    instructions: checked,
    policyVersion: policy.version,
    instructionsHash: aiInstructionsHash(checked, policy.version),
    prefix,
    suffix,
    promptHash: sha256(prefix + data + suffix),
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > PROMPT_INPUT_LIMIT) invalid()
  return result
}

export function parseAiPromptInput(value: unknown, kind: AiKind, snapshot: unknown): AiPromptInput {
  const input = plainRecord(value)
  exactKeys(input, ['version', 'kind', 'instructions', 'policyVersion', 'instructionsHash', 'prefix', 'suffix', 'promptHash'])
  if (input.version !== 1 || input.kind !== kind) invalid()
  if (typeof input.policyVersion !== 'string' || !VERSION.test(input.policyVersion)) invalid()
  if (typeof input.prefix !== 'string' || typeof input.suffix !== 'string') invalid()
  if (typeof input.instructionsHash !== 'string' || !HASH.test(input.instructionsHash)) invalid()
  if (typeof input.promptHash !== 'string' || !HASH.test(input.promptHash)) invalid()
  const instructions = validateInstructions(input.instructions, kind)
  if (input.instructionsHash !== aiInstructionsHash(instructions, input.policyVersion)) invalid()
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > PROMPT_INPUT_LIMIT) invalid()
  if (input.promptHash !== sha256(input.prefix + canonicalAiJson(snapshot) + input.suffix)) invalid()
  return { ...input, version: 1, kind, instructions } as AiPromptInput
}

export function renderAiPrompt(input: AiPromptInput, snapshot: unknown): string {
  const parsed = parseAiPromptInput(input, input.kind, snapshot)
  return parsed.prefix + canonicalAiJson(snapshot) + parsed.suffix
}

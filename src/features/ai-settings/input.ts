import type { AiSettingsSave, AiSettingsValues } from './types'

const SETTINGS_BODY_LIMIT = 128 * 1024
const VALUE_KEYS = ['commonInstructions', 'ledgerInstructions', 'budgetInstructions'] as const
const LIMITS = { commonInstructions: 4_000, ledgerInstructions: 6_000, budgetInstructions: 6_000 } as const

function invalid(): never {
  throw new Error('invalid_ai_settings')
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid()
  const input = value as Record<string, unknown>
  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch {
    invalid()
  }
  if (Buffer.byteLength(serialized!, 'utf8') > SETTINGS_BODY_LIMIT) invalid()
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid()
  return input
}

function valuesFrom(input: Record<string, unknown>): AiSettingsValues {
  const result = {} as AiSettingsValues
  for (const key of VALUE_KEYS) {
    const value = input[key]
    if (value !== null && typeof value !== 'string') invalid()
    if (typeof value === 'string' && [...value].length > LIMITS[key]) invalid()
    result[key] = value as string | null
  }
  return result
}

export function parseAiSettingsValues(value: unknown): AiSettingsValues {
  return valuesFrom(record(value, VALUE_KEYS))
}

export function parseAiSettingsSave(value: unknown): AiSettingsSave {
  const input = record(value, [...VALUE_KEYS, 'expectedRevision'])
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) invalid()
  return { ...valuesFrom(input), expectedRevision: input.expectedRevision as number }
}

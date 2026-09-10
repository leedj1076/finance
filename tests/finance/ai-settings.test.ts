import { describe, expect, test } from 'vitest'

import { AI_DEFAULTS } from '@/features/ai-settings/defaults'
import { parseAiSettingsSave, parseAiSettingsValues } from '@/features/ai-settings/input'

const values = {
  commonInstructions: null,
  ledgerInstructions: '',
  budgetInstructions: '한글 지침',
}

describe('AI settings input', () => {
  test('preserves null defaults and intentional empty custom instructions', () => {
    expect(parseAiSettingsValues(values)).toEqual(values)
    expect(parseAiSettingsSave({ ...values, expectedRevision: 0 })).toEqual({ ...values, expectedRevision: 0 })
  })

  test('accepts each documented character limit', () => {
    expect(parseAiSettingsSave({
      commonInstructions: '한'.repeat(4_000),
      ledgerInstructions: '나'.repeat(6_000),
      budgetInstructions: '다'.repeat(6_000),
      expectedRevision: 23,
    }).expectedRevision).toBe(23)
  })

  test.each([
    undefined,
    null,
    [],
    { ...values, expectedRevision: -1 },
    { ...values, expectedRevision: 1.2 },
    { ...values, expectedRevision: '0' },
    { ...values, commonInstructions: 1, expectedRevision: 0 },
    { ...values, commonInstructions: 'x'.repeat(4_001), expectedRevision: 0 },
    { ...values, ledgerInstructions: 'x'.repeat(6_001), expectedRevision: 0 },
    { ...values, budgetInstructions: 'x'.repeat(6_001), expectedRevision: 0 },
    { ...values, expectedRevision: 0, updatedBy: 'forged' },
    { ...values, expectedRevision: 0, file: new Uint8Array([1]) },
    { ...values, expectedRevision: 0, extra: BigInt(1) },
  ])('rejects malformed, over-limit, or extra settings fields', (input) => {
    expect(() => parseAiSettingsSave(input)).toThrow('invalid_ai_settings')
  })

  test('rejects a multibyte settings body over 128 KiB even within individual character limits', () => {
    expect(() => parseAiSettingsSave({
      commonInstructions: '한'.repeat(4_000),
      ledgerInstructions: '나'.repeat(6_000),
      budgetInstructions: '다'.repeat(6_000),
      expectedRevision: 0,
    })).not.toThrow()
    expect(() => parseAiSettingsValues({
      commonInstructions: '한'.repeat(4_000),
      ledgerInstructions: '한'.repeat(6_000),
      budgetInstructions: '한'.repeat(6_000),
      padding: 'x'.repeat(90_000),
    })).toThrow('invalid_ai_settings')
  })

  test('counts Unicode characters rather than UTF-16 code units', () => {
    expect(() => parseAiSettingsSave({
      commonInstructions: '😀'.repeat(4_000),
      ledgerInstructions: null,
      budgetInstructions: null,
      expectedRevision: 0,
    })).not.toThrow()
  })

  test('ships non-empty editable defaults for both diagnosis kinds', () => {
    expect(AI_DEFAULTS.commonInstructions.length).toBeGreaterThan(0)
    expect(AI_DEFAULTS.ledgerInstructions.length).toBeGreaterThan(0)
    expect(AI_DEFAULTS.budgetInstructions.length).toBeGreaterThan(0)
  })
})

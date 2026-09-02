import { describe, expect, test } from 'vitest'

import {
  manageFlow,
  optionalId,
  optionalText,
  positiveId,
  requiredText,
  safePriority,
} from '@/features/manage/manage-input'

describe('manage input validation', () => {
  test('normalizes required and optional text', () => {
    expect(requiredText('  DJ   카드  ', '이름')).toEqual({ ok: true, value: 'DJ 카드' })
    expect(optionalText('   카드   메모 ')).toEqual({ ok: true, value: '카드 메모' })
    expect(optionalText('')).toEqual({ ok: true, value: null })
  })

  test('rejects empty or oversized text', () => {
    expect(requiredText(' ', '이름', 10)).toEqual({ ok: false, error: '이름은(는) 1~10자로 입력해 주세요.' })
    expect(optionalText('a'.repeat(201))).toEqual({ ok: false, error: '메모는 200자 이내로 입력해 주세요.' })
  })

  test('accepts only safe identifiers, flows, and priorities', () => {
    expect(positiveId('12')).toBe(12)
    expect(positiveId('-1')).toBeNull()
    expect(optionalId('')).toBeNull()
    expect(optionalId('abc')).toBeUndefined()
    expect(manageFlow('saving')).toBe('saving')
    expect(manageFlow('transfer')).toBeNull()
    expect(safePriority('100')).toBe(100)
    expect(safePriority('1000')).toBeNull()
  })
})

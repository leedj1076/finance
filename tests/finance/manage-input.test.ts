import { describe, expect, test } from 'vitest'

import {
  manageFlow,
  optionalId,
  optionalText,
  parseBulkAccounts,
  parseBulkCategories,
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

  test('parses ordered account batches and rejects duplicate names', () => {
    expect(parseBulkAccounts(JSON.stringify([
      { id: 2, name: ' YJ 카드 ', owner: 'YJ', type: 'card', memo: '', active: true },
      { id: null, name: '공용 계좌', owner: '공용', type: 'bank', memo: ' 생활비 ', active: true },
    ]))).toEqual({
      ok: true,
      value: [
        { id: 2, name: 'YJ 카드', owner: 'YJ', type: 'card', memo: null, active: true },
        { id: null, name: '공용 계좌', owner: '공용', type: 'bank', memo: '생활비', active: true },
      ],
    })
    expect(parseBulkAccounts(JSON.stringify([
      { id: 1, name: 'DJ 카드', owner: 'DJ', type: 'card', memo: '', active: true },
      { id: 2, name: 'dj 카드', owner: 'DJ', type: 'card', memo: '', active: true },
    ]))).toEqual({ ok: false, error: '같은 이름의 결제수단이 있습니다.' })
  })

  test('parses hierarchical category batches and keeps delete intent', () => {
    expect(parseBulkCategories(JSON.stringify([
      { id: 10, kind: 'expense', major: '식비', sub: '마트', hidden: false, deleted: false },
      { id: 11, kind: 'expense', major: '식비', sub: '외식', hidden: true, deleted: true },
      { id: null, kind: 'saving', major: '투자', sub: 'ETF', hidden: false, deleted: false },
    ]))).toEqual({
      ok: true,
      value: [
        { id: 10, kind: 'expense', major: '식비', sub: '마트', hidden: false, deleted: false },
        { id: 11, kind: 'expense', major: '식비', sub: '외식', hidden: true, deleted: true },
        { id: null, kind: 'saving', major: '투자', sub: 'ETF', hidden: false, deleted: false },
      ],
    })
    expect(parseBulkCategories(JSON.stringify([
      { id: 10, kind: 'expense', major: '식비', sub: '마트', hidden: false, deleted: false },
      { id: 11, kind: 'expense', major: '식비', sub: '마트', hidden: false, deleted: false },
    ]))).toEqual({ ok: false, error: '같은 카테고리가 중복되어 있습니다.' })
  })
})

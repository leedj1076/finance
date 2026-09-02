import { expect, test } from 'vitest'

import {
  categoriesForFlow,
  categorySelectionForFlow,
  type InboxCategoryOption,
} from '@/features/inbox/taxonomy'

const categories: InboxCategoryOption[] = [
  { id: 1, kind: 'expense', major: '식비', sub: '외식' },
  { id: 2, kind: 'expense', major: '교통비', sub: '대중교통' },
  { id: 3, kind: 'income', major: '월급', sub: '급여' },
  { id: 4, kind: 'saving', major: '저축_투자', sub: '주식' },
]

test('flow switch immediately rebuilds category options from that flow taxonomy', () => {
  expect(categoriesForFlow(categories, 'income')).toEqual([
    { id: 3, kind: 'income', major: '월급', sub: '급여' },
  ])
  expect(categoriesForFlow(categories, 'saving')).toEqual([
    { id: 4, kind: 'saving', major: '저축_투자', sub: '주식' },
  ])
})

test('flow switch clears an incompatible category while preserving a compatible one', () => {
  expect(categorySelectionForFlow(categories, 'income', 1)).toBe('')
  expect(categorySelectionForFlow(categories, 'income', 3)).toBe('3')
  expect(categorySelectionForFlow(categories, 'expense', null)).toBe('')
})

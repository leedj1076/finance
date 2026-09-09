import { expect, test } from 'vitest'

import { buildHomeTodos, type HomeTodoInput } from '@/features/analytics/home-todos'

const base: HomeTodoInput = {
  month: '2026-09',
  anomalies: [{ major: '식비', current: 520_000, typical: 380_000 }],
  paceWarnings: [],
  pendingInboxCount: 0,
  unclassifiedCount: 0,
  needsReview: false,
  ungeneratedRecurringCount: 0,
  closeTargets: [],
}

test('an ended open month is the first todo and names what is left to clean up', () => {
  const todos = buildHomeTodos({
    ...base,
    closeTargets: [{ month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 5, unpostedRecurringCount: 1 }],
  })
  expect(todos[0]).toMatchObject({
    kind: 'close',
    title: '8월 마무리하기',
    detail: '미분류 5건 · 정기거래 미반영 1건 · 마감 전',
    href: '/ledger?month=2026-08',
  })
  expect(todos[1].kind).toBe('anomaly')
})

test('a clean month says so, a reviewed month asks to close again, several months fold into one line', () => {
  expect(buildHomeTodos({
    ...base,
    closeTargets: [{ month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 }],
  })[0].detail).toBe('정리 완료 · 마감 전')
  expect(buildHomeTodos({
    ...base,
    closeTargets: [{ month: '2026-08', state: 'needs_review', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 }],
  })[0]).toMatchObject({ title: '8월 다시 마감하기', detail: '마감 뒤 내역이 바뀌었습니다' })
  const many = buildHomeTodos({
    ...base,
    closeTargets: [
      { month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 2, unpostedRecurringCount: 0 },
      { month: '2026-07', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
    ],
  })[0]
  expect(many).toMatchObject({
    title: '8월 · 7월 마무리하기',
    detail: '미분류 2건 · 마감 전 · 2개월',
    href: '/ledger?month=2026-08',
  })
})

test('long close queues keep two months in the title and count every month in the detail', () => {
  const open = buildHomeTodos({
    ...base,
    closeTargets: [
      { month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
      { month: '2026-07', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
      { month: '2026-06', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
    ],
  })[0]
  expect(open).toMatchObject({ title: '8월 · 7월 마무리하기', detail: '정리 완료 · 마감 전 · 3개월' })

  const reviewed = buildHomeTodos({
    ...base,
    closeTargets: [
      { month: '2026-08', state: 'needs_review', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
      { month: '2026-07', state: 'needs_review', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
    ],
  })[0]
  expect(reviewed).toMatchObject({ title: '8월 다시 마감하기', detail: '마감 뒤 내역이 바뀌었습니다 · 2개월' })
})

test('no ended open month means no close todo', () => {
  expect(buildHomeTodos(base).some((todo) => todo.kind === 'close')).toBe(false)
})

import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'

import { MonthStatusLabel, YearStatusLabel, monthStatusText } from '@/features/month-close/month-status-label'
import type { MonthStatus } from '@/features/month-close/state'

const open: MonthStatus = { month: '2026-08', revision: 3, closedRevision: null, closedAt: null, state: 'open' }
const closed: MonthStatus = { month: '2026-05', revision: 1, closedRevision: 1, closedAt: '2026-06-02T03:00:00.000Z', state: 'closed' }
const review: MonthStatus = { month: '2026-04', revision: 2, closedRevision: 1, closedAt: '2026-05-01T00:00:00.000Z', state: 'needs_review' }

test('heading text names the month in words and one state word', () => {
  expect(monthStatusText(open, '2026-09')).toEqual({ text: '2026년 8월 · 미마감 · 잠정', tone: 'amber' })
  expect(monthStatusText(closed, '2026-09')).toEqual({ text: '2026년 5월 · 마감 · 6/2 확정', tone: 'green' })
  expect(monthStatusText(review, '2026-09')).toEqual({ text: '2026년 4월 · 재확인 필요 · 마감 뒤 내역 변경', tone: 'red' })
  expect(monthStatusText({ ...open, month: '2026-09' }, '2026-09', { day: 9, days: 30 })).toEqual({ text: '2026년 9월 · 진행 중 · 9일 경과 / 30일', tone: 'amber' })
  expect(monthStatusText({ ...open, month: '2026-11' }, '2026-09')).toEqual({ text: '2026년 11월 · 예정', tone: 'faint' })
})

test('closed date is formatted in KST across the UTC date boundary', () => {
  expect(monthStatusText({ ...closed, closedAt: '2026-06-01T15:00:00.000Z' }, '2026-09')).toEqual({
    text: '2026년 5월 · 마감 · 6/2 확정',
    tone: 'green',
  })
})

test('compact variant keeps the control-row wording', () => {
  expect(renderToStaticMarkup(<MonthStatusLabel status={open} />)).toContain('2026-08 · 미마감 · 잠정 내역 기준')
  expect(renderToStaticMarkup(<MonthStatusLabel status={closed} />)).toContain('2026-05 · 마감')
})

test('compact review state uses red and explains why it needs review', () => {
  const html = renderToStaticMarkup(<MonthStatusLabel status={review} />)
  expect(html).toContain('text-finance-red')
  expect(html).toContain('title="마감 뒤 내역이 바뀌어 통계에서 잠정 값으로 돌아갔습니다. 다시 마감하면 확정됩니다."')
})

test('heading variant carries a title explaining the state', () => {
  const html = renderToStaticMarkup(<MonthStatusLabel status={open} variant="heading" currentMonthKey="2026-09" />)
  expect(html).toContain('2026년 8월 · 미마감 · 잠정')
  expect(html).toContain('title="마감 전이라 통계의 평균·비교에는 들어가지 않습니다."')
})

test('year label counts closed and provisional months', () => {
  const html = renderToStaticMarkup(<YearStatusLabel year={2026} closedMonths={[1, 2, 3, 4, 5]} provisionalMonths={[6, 7, 8]} />)
  expect(html).toContain('2026년 · 마감 5개월 · 잠정 3개월 (6·7·8월)')
  expect(renderToStaticMarkup(<YearStatusLabel year={2026} closedMonths={[]} provisionalMonths={[1, 2]} />)).toContain('2026년 · 마감 0개월 · 잠정 2개월 (1·2월)')
})

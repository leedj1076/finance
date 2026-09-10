import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { DiagnosisPanel } from '@/features/diagnosis/diagnosis-panel'
import type { DiagnosisPageData, DiagnosisSnapshot } from '@/features/diagnosis/types'

const snapshot: DiagnosisSnapshot = {
  version: 1,
  month: '2026-07',
  asOf: '2026-09-09T00:00:00.000Z',
  sourceHash: 'fixture',
  current: { month: '2026-07', count: 166, income: 7681047, salary: 7101720, salaryCount: 2, expense: 5603949, saving: 850000, comparableExpense: 5388186, otherIncome: 579327, salaryRemainder: 647771, totalRemainder: 1227098, savingsRate: 27.0419 },
  months: [
    { month: '2026-04', count: 1, income: 0, salary: 0, salaryCount: 0, expense: 6452877, saving: 0, comparableExpense: 6152877 },
    { month: '2026-05', count: 1, income: 0, salary: 0, salaryCount: 0, expense: 10435238, saving: 0, comparableExpense: 5936262 },
    { month: '2026-06', count: 1, income: 0, salary: 0, salaryCount: 0, expense: 5556547, saving: 0, comparableExpense: 5556547 },
    { month: '2026-07', count: 166, income: 7681047, salary: 7101720, salaryCount: 2, expense: 5603949, saving: 850000, comparableExpense: 5388186 },
  ],
  comparison: { previousExpense: 5556547, expenseDelta: 47402, expenseChangeRate: 0.9, baselineMonthCount: 3, expenseAverage: 7481554, comparableExpenseAverage: 5881895 },
  categories: [{ major: '자녀', amount: 1259230, previous: 692045, delta: 567185, count: 22, budget: 1003865 }],
  budget: { total: 6185671, savingsRateTarget: 30 },
  transactions: [{ id: 17, date: '2026-07-24', flow: 'expense', amount: 184000, major: '자녀', sub: '교육', merchant: '수업' }],
  evidenceCount: 1,
}

function page(overrides: Partial<DiagnosisPageData> = {}): DiagnosisPageData {
  return {
    month: '2026-07', currentSnapshot: snapshot, latestJob: null, completed: null,
    isStale: false, workerOnline: true, setupRequired: false, instructionsChanged: false, promptSetupRequired: false, ...overrides,
  }
}
function complete(overrides: Partial<DiagnosisPageData> = {}): DiagnosisPageData {
  return page({
    latestJob: { id: 'report-1', status: 'completed', createdAt: snapshot.asOf, startedAt: snapshot.asOf, completedAt: snapshot.asOf, errorCode: null },
    completed: {
      id: 'report-1', completedAt: snapshot.asOf, snapshot,
      report: {
        version: 1, headline: '총액보다 쓰인 곳이 달라졌어요', summary: '자녀 지출의 증가와 다른 항목의 감소를 함께 보세요.',
        changes: [{ title: '자녀 지출 증가', body: '다음 달에도 필요한 항목을 확인해 보세요.', category: '자녀', transactionIds: [17] }],
        trend: { summary: '전월과 지출이 비슷해요.', caveat: '여행과 경조사는 같은 기준으로 제외했어요.' },
        checks: [{ title: '수업 결제 확인', body: '다음 달 결제 여부를 확인하세요.', transactionIds: [17] }],
        actions: [{ title: '다음 달 자녀 비용 적기', body: '예상 금액을 정해 보세요.' }], positive: '전체 지출은 전월 수준을 유지했어요.',
      },
    }, ...overrides,
  })
}
function render(data: DiagnosisPageData) {
  return renderToStaticMarkup(createElement(DiagnosisPanel, { initialData: data }))
}

describe('monthly diagnosis report', () => {
  test('combines salary cashflow with all five narrative sections and source records', () => {
    const html = render(complete())
    expect(html).toContain('710.2')
    expect(html).toContain('647,771원')
    expect(html).toContain('월급으로 지출과 저축을 감당했을까?')
    for (const heading of ['이달의 총평', '지출이 달라진 이유', '우리집의 평소와 비교', '눈여겨볼 점', '다음 달에 해볼 일']) expect(html).toContain(heading)
    expect(html).toContain('근거 내역 1건')
    expect(html).toContain('다시 진단하기')
    expect(html).toContain('계좌 잔액')
  })

  test('keeps all completed report numbers on its original snapshot when current ledger changes', () => {
    const html = render(complete({ isStale: true, currentSnapshot: { ...snapshot, current: { ...snapshot.current, salary: 9900000, expense: 7777777, count: 199 } } }))
    expect(html).toContain('7,101,720원')
    expect(html).toContain('5,603,949원')
    expect(html).not.toContain('7,777,777원')
    expect(html).toContain('진단 이후 내역이 바뀌었어요')
  })

  test('shows real empty state without a prepared AI narrative', () => {
    const html = render(page())
    expect(html).toContain('아직 7월 진단이 없어요')
    expect(html).toContain('7월 AI 진단하기')
    expect(html).not.toContain('총액보다 쓰인 곳이 달라졌어요')
  })

  test('keeps a previous successful report while a queued Mac waits and prevents duplicate requests', () => {
    const html = render(complete({ workerOnline: false, latestJob: { id: 'new', status: 'queued', createdAt: snapshot.asOf, startedAt: null, completedAt: null, errorCode: null } }))
    expect(html).toContain('Mac 연결 대기')
    expect(html).toContain('총액보다 쓰인 곳이 달라졌어요')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>진단 대기 중/)
  })

  test('explains running state and preserves a previous report after failure', () => {
    const running = render(complete({ latestJob: { id: 'new', status: 'running', createdAt: snapshot.asOf, startedAt: snapshot.asOf, completedAt: null, errorCode: null } }))
    expect(running).toContain('이번 달 보고서를 정리하고 있어요')
    const failed = render(complete({ latestJob: { id: 'new', status: 'failed', createdAt: snapshot.asOf, startedAt: snapshot.asOf, completedAt: snapshot.asOf, errorCode: 'timeout' } }))
    expect(failed).toContain('진단 시간이 길어져 중단됐어요')
    expect(failed).toContain('총액보다 쓰인 곳이 달라졌어요')
    expect(failed).toContain('다시 진단하기')
  })

  test('distinguishes missing salary classification and negative remainder from spare cash', () => {
    const negative = render(page({ currentSnapshot: { ...snapshot, current: { ...snapshot.current, salaryRemainder: -250000 } } }))
    expect(negative).toContain('기록상 부족한 금액')
    expect(negative).toContain('−25.0')
    const missing = render(page({ currentSnapshot: { ...snapshot, current: { ...snapshot.current, salary: 0, salaryCount: 0, salaryRemainder: -6453949 } } }))
    expect(missing).toContain('월급으로 분류된 수입이 없어요')
    expect(missing).toContain('월급 기준 계산 보류')
  })

  test('does not draw missing comparison months as zero spending or expose unsupported budget', () => {
    const data = complete()
    const incomplete = { ...snapshot, months: snapshot.months.map((month, index) => index < 3 ? { ...month, count: 0, expense: 0 } : month), comparison: { ...snapshot.comparison, baselineMonthCount: 0, previousExpense: null, expenseDelta: null, expenseChangeRate: null, expenseAverage: null, comparableExpenseAverage: null }, budget: { total: null, savingsRateTarget: null } }
    data.completed = { ...data.completed!, snapshot: incomplete }
    const html = render(data)
    expect(html).toContain('비교할 월의 내역이 없어요')
    expect(html).toContain('내역 없음')
    expect(html).not.toContain('카테고리 예산 대비')
  })

  test('renders model content as text and hides nonexistent evidence links', () => {
    const data = complete()
    data.completed!.report.headline = '<script>alert(1)</script>'
    data.completed!.report.changes[0].transactionIds = [999999]
    data.completed!.report.checks = []
    const html = render(data)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('근거 내역 1건')
  })

  test('labels a report captured during the selected month even when viewed later', () => {
    const data = complete()
    data.completed = { ...data.completed!, snapshot: { ...snapshot, asOf: '2026-07-15T12:00:00.000Z' } }
    expect(render(data)).toContain('월중 기록 기준')
    expect(render(complete())).not.toContain('월중 기록 기준')
  })

  test('shows setup requirement without pretending a job or report exists', () => {
    const html = render(page({ setupRequired: true, workerOnline: false }))
    expect(html).toContain('Mac에서 진단 연결을 준비해 주세요')
    expect(html).not.toContain('이번 달 보고서를 정리하고 있어요')
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })
})

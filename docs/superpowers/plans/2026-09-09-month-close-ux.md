# 월 마감 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 통계가 미마감 월을 숨기지 않고 잠정으로 보이게 하고, 내역에 마무리 체크리스트를 얹고, 홈은 마감 할 일 한 줄과 세 섹션 제거, 월 단위 화면의 설명 문장을 상태 칩 하나로 바꾼다.

**Architecture:** 마감 데이터 모델·서비스·트리거는 그대로 두고 읽기 모델과 화면만 바꾼다. `getStatsReportData`가 확정(마감 월)과 잠정(끝난 월 전부) 두 결과를 함께 내고, 화면은 "확정 값이 있으면 확정 값, 없으면 회색 잠정 값" 규칙으로 고른다. 체크리스트 상태와 홈 할 일은 순수 함수(`wrapUpSteps`, `buildHomeTodos`)로 두어 DB 없이 테스트한다. 차트의 잠정 표시는 `chart-js.ts`의 패턴·대시 상수 한 곳에서 나온다.

**Tech Stack:** Next.js 15 App Router (서버 컴포넌트 + 서버 액션), Drizzle, Chart.js 4 + react-chartjs-2, Tailwind v4, Vitest (`pnpm test` 유닛 / `pnpm test:db` 통합), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-month-close-ux-design.md` (정책 원본은 `2026-09-09-monthly-close-design.md`)

## Global Constraints

- 모든 Drizzle 쿼리에 `householdId` 조건. 폼의 가구 ID는 신뢰하지 않는다.
- 마감 서비스(`closeMonth`, `reopenMonth`), `ledger_months`, 트리거, RLS, `/api/cell-tx` 서버 로직은 수정하지 않는다. 마이그레이션 없음.
- 색은 토큰만: 잠정은 `text-finance-faint`/`--finance-faint`(회색), 확정 태그는 green, 미마감 칩은 amber, 재확인은 red. 원시 `text-[Npx]` 금지, `t-*` 타입 스케일 사용.
- 문장 하나로 상태를 설명하지 않는다. 상태는 칩, 설명은 칩의 `title`.
- 각 태스크 끝에 `pnpm exec tsc --noEmit`과 해당 테스트가 통과해야 커밋한다. 통합 테스트(`pnpm test:db`)는 로컬 Supabase(Docker) 필요. E2E는 `pnpm e2e`.
- 커밋은 태스크 단위, 메시지는 기존 컨벤션(`feat(stats): …`, `refactor(home): …`).
- 다른 세션의 untracked 파일(`docs/superpowers/plans/2026-09-07-reliability-first-refactor.md`, `docs/design/swiss-ledger/ai-diagnosis-*`, `outputs/`)은 `git add`에 포함하지 않는다. 경로를 명시해 add 한다.

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/features/month-close/wrap-up.ts` (신규) | `wrapUpSteps`: 마감 요약 → 체크리스트 모델. 순수 |
| `src/features/month-close/month-wrap-up.tsx` (신규) | 내역 상단 체크리스트 블록(서버 컴포넌트) |
| `src/features/month-close/month-status-label.tsx` | 칩 변형(`heading`), `title`, `YearStatusLabel` |
| `src/features/month-close/month-close-control.tsx` | 문구 한 곳 수정 |
| `src/app/ledger/page.tsx` | h1 칩, 체크리스트 삽입, AI 탭 문장 삭제 |
| `src/features/analytics/home-todos.ts` | `close` 할 일 종류와 월 상태 조회 |
| `src/app/dashboard/page.tsx` | KPI 두 칸, 섹션 제거, 헤더 칩 |
| `src/features/analytics/net-worth.ts` (삭제), `home-trend-charts.tsx` (`CashflowWaterfall` 삭제) | 홈에서만 쓰던 코드 |
| `src/features/analytics/stats-report.ts` | 확정·잠정 두 결과, 월 상태 |
| `src/features/analytics/category-detail.ts` | `CategoryDetail`에 `endedMonths`, `states`, `provisionalDivisor` |
| `src/features/analytics/stats-monthly.ts` | 표시 대상/확정 대상 마스크 분리, 확정 합계·평균 |
| `src/features/analytics/chart-js.ts` | `provisionalPattern`, `PROVISIONAL_DASH` |
| `src/features/analytics/series-chart.tsx`, `annual-flow-overview.tsx` | 월별 잠정 스타일 |
| `src/features/analytics/stats-monthly-section.tsx` | 표의 잠정 열, `scope=live`, 헤더 |
| `src/app/report/page.tsx` | 칩, 스트립, 확정/잠정 태그, 빈 상태 교체 |
| `src/app/budgets/page.tsx`, `src/app/budgets/review/page.tsx` | 문장 삭제, 칩을 h1 옆으로 |
| `tests/finance/wrap-up.test.ts`, `tests/finance/home-todos.test.ts`, `tests/finance/month-status-label.test.ts` (신규) | 순수 함수·칩 테스트 |
| `tests/finance/stats-monthly.test.ts`, `tests/finance/closed-report.test.ts`, `tests/integration/closed-report.test.ts`, `tests/integration/home-dashboard.test.ts`, `tests/finance/diagnosis-ledger-page.test.ts` | 기존 테스트 갱신 |
| `tests/e2e/month-close.spec.ts` | 빈 화면 확인 → 잠정 표시 확인, 체크리스트·홈 할 일 흐름 |

---

### Task 1: `wrapUpSteps` 순수 함수

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 단일 summary 인자는 유지한다(summary.month/closable이 중복 인자를 대체). 실제 소비 태스크는 Task 3. 각각의 미완료 항목·모두 완료·표시 제외 상태를 테스트한다.

**Files:**
- Create: `src/features/month-close/wrap-up.ts`
- Test: `tests/finance/wrap-up.test.ts`

**Interfaces:**
- Consumes: `MonthCloseSummary` (`src/features/month-close/state.ts`: `state`, `closable`, `pendingCount`, `unclassifiedCount`, `unpostedRecurringCount`, `month`)
- Produces: `wrapUpSteps(summary): WrapUpModel`, `WrapUpStep`, `WrapUpModel` — Task 2·4가 사용

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/finance/wrap-up.test.ts
import { describe, expect, test } from 'vitest'

import type { MonthCloseSummary } from '@/features/month-close/state'
import { wrapUpSteps } from '@/features/month-close/wrap-up'

function summary(overrides: Partial<MonthCloseSummary> = {}): MonthCloseSummary {
  return {
    month: '2026-08', revision: 3, closedRevision: null, closedAt: null, state: 'open',
    count: 187, income: 5_400_000, expense: 3_812_400, saving: 700_000,
    pendingCount: 0, unclassifiedCount: 5, unpostedRecurringCount: 0,
    closable: true, requiresAcknowledgment: true,
    ...overrides,
  }
}

describe('wrapUpSteps', () => {
  test('lists the three clean-up items with counts and marks the empty ones done', () => {
    const model = wrapUpSteps(summary())
    expect(model.visible).toBe(true)
    expect(model.steps.map((step) => [step.key, step.count, step.done])).toEqual([
      ['inbox', 0, true],
      ['recurring', 0, true],
      ['unclassified', 5, false],
    ])
    expect(model.doneCount).toBe(2)
    expect(model.allClear).toBe(false)
    expect(model.steps[2].href).toBe('/inbox?tab=unclassified')
    expect(model.steps[1].href).toBeNull()
  })

  test('collapses to all clear when every count is zero', () => {
    const model = wrapUpSteps(summary({ unclassifiedCount: 0, requiresAcknowledgment: false }))
    expect(model.allClear).toBe(true)
    expect(model.doneCount).toBe(3)
  })

  test('is hidden for the current month, closed months and months needing review', () => {
    expect(wrapUpSteps(summary({ closable: false })).visible).toBe(false)
    expect(wrapUpSteps(summary({ state: 'closed', closedRevision: 3, closedAt: '2026-09-02T00:00:00Z' })).visible).toBe(false)
    expect(wrapUpSteps(summary({ state: 'needs_review', closedRevision: 2, closedAt: '2026-09-02T00:00:00Z' })).visible).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/wrap-up.test.ts`
Expected: FAIL — `Cannot find module '@/features/month-close/wrap-up'`

- [ ] **Step 3: 구현**

```ts
// src/features/month-close/wrap-up.ts
import type { MonthCloseSummary } from './state'

export type WrapUpStepKey = 'inbox' | 'recurring' | 'unclassified'

export type WrapUpStep = {
  key: WrapUpStepKey
  label: string
  count: number
  done: boolean
  /** null: the action lives on the same page (recurring apply form). */
  href: string | null
  note?: string
}

export type WrapUpModel = {
  visible: boolean
  steps: WrapUpStep[]
  doneCount: number
  allClear: boolean
}

/**
 * The checklist only exists for a month that has ended and was never closed.
 * A closed month has nothing to clean up here, and a month needing review
 * goes straight back to the close control below the list.
 */
export function wrapUpSteps(summary: MonthCloseSummary): WrapUpModel {
  const steps: WrapUpStep[] = [
    { key: 'inbox', label: '가져오기 대기', count: summary.pendingCount, done: summary.pendingCount === 0, href: '/inbox' },
    { key: 'recurring', label: '정기거래 미반영', count: summary.unpostedRecurringCount, done: summary.unpostedRecurringCount === 0, href: null },
    {
      key: 'unclassified', label: '미분류 거래', count: summary.unclassifiedCount, done: summary.unclassifiedCount === 0,
      href: '/inbox?tab=unclassified', note: '분류하면 통계의 카테고리 표에 들어갑니다',
    },
  ]
  const doneCount = steps.filter((step) => step.done).length
  return {
    visible: summary.state === 'open' && summary.closable,
    steps,
    doneCount,
    allClear: doneCount === steps.length,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/wrap-up.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/features/month-close/wrap-up.ts tests/finance/wrap-up.test.ts
git commit -m "feat(month-close): derive the wrap-up checklist from the close summary"
```

---

### Task 2: 상태 칩 변형과 `YearStatusLabel`

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 테스트 확장자는 처음부터 .test.tsx이며 vitest.config.ts도 수정한다. 마지막 KST Intl 구현을 사용하고 UTC/KST 날짜 경계를 테스트한다. compact 문구는 보존하되 needs_review는 red와 적절한 title을 사용한다.

**Files:**
- Modify: `src/features/month-close/month-status-label.tsx`
- Test: `tests/finance/month-status-label.test.ts`

**Interfaces:**
- Consumes: `MonthStatus` (`state`, `month`, `closedAt`)
- Produces: `MonthStatusLabel({ status, variant?: 'compact' | 'heading', currentMonthKey?, elapsed? })`, `YearStatusLabel({ year, closedMonths, provisionalMonths })`, 순수 헬퍼 `monthStatusText(status, currentMonthKey, elapsed?)` — Task 3·4·8이 사용. `compact`(기본)는 기존 문구를 그대로 유지해 `MonthCloseControl`과 E2E `'2026-08 · 마감'` 확인을 깨지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/finance/month-status-label.test.ts
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

test('compact variant keeps the control-row wording', () => {
  expect(renderToStaticMarkup(<MonthStatusLabel status={open} />)).toContain('2026-08 · 미마감 · 잠정 내역 기준')
  expect(renderToStaticMarkup(<MonthStatusLabel status={closed} />)).toContain('2026-05 · 마감')
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
```

파일 확장자는 `.tsx`가 아니라 `.test.ts`이므로 JSX를 쓰려면 `tests/finance/month-status-label.test.tsx`로 만들고 vitest include에 `tests/**/*.test.tsx`를 추가한다:

```ts
// vitest.config.ts — unit 프로젝트의 include
include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
```

`react-dom/server`는 `diagnosis-ledger-page.test.ts`가 이미 쓰고 있어 추가 설치는 없다.

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/month-status-label.test.tsx`
Expected: FAIL — `monthStatusText`, `YearStatusLabel` 없음

- [ ] **Step 3: 구현**

```tsx
// src/features/month-close/month-status-label.tsx
import { MONTH_STATE_LABELS, type MonthStatus } from './state'

type Tone = 'amber' | 'green' | 'red' | 'faint'

const TONE_CLASS: Record<Tone, string> = {
  amber: 'text-finance-amber',
  green: 'text-finance-green',
  red: 'text-finance-red',
  faint: 'text-finance-faint',
}

const TITLE: Record<Tone, string> = {
  amber: '마감 전이라 통계의 평균·비교에는 들어가지 않습니다.',
  green: '이 달의 숫자는 통계에서 확정 값으로 계산됩니다.',
  red: '마감 뒤 내역이 바뀌어 통계에서 잠정 값으로 돌아갔습니다. 다시 마감하면 확정됩니다.',
  faint: '아직 오지 않은 달입니다.',
}

function monthWords(month: string) {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`
}

function shortDate(iso: string) {
  const date = new Date(iso)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** One vocabulary for every month-scoped heading. */
export function monthStatusText(
  status: MonthStatus,
  currentMonthKey: string,
  elapsed?: { day: number; days: number },
): { text: string; tone: Tone } {
  const words = monthWords(status.month)
  if (status.month > currentMonthKey) return { text: `${words} · 예정`, tone: 'faint' }
  if (status.month === currentMonthKey) {
    return { text: `${words} · 진행 중${elapsed ? ` · ${elapsed.day}일 경과 / ${elapsed.days}일` : ''}`, tone: 'amber' }
  }
  if (status.state === 'closed') {
    return { text: `${words} · 마감${status.closedAt ? ` · ${shortDate(status.closedAt)} 확정` : ''}`, tone: 'green' }
  }
  if (status.state === 'needs_review') return { text: `${words} · 재확인 필요 · 마감 뒤 내역 변경`, tone: 'red' }
  return { text: `${words} · 미마감 · 잠정`, tone: 'amber' }
}

export function MonthStatusLabel({
  status,
  variant = 'compact',
  currentMonthKey,
  elapsed,
}: {
  status: MonthStatus
  variant?: 'compact' | 'heading'
  currentMonthKey?: string
  elapsed?: { day: number; days: number }
}) {
  if (variant === 'heading' && currentMonthKey) {
    const { text, tone } = monthStatusText(status, currentMonthKey, elapsed)
    return <span className={`inline-flex items-center gap-1.5 t-caption font-medium ${TONE_CLASS[tone]}`} title={TITLE[tone]}>
      <span aria-hidden className="h-[7px] w-[7px] bg-current" />
      {text}
    </span>
  }
  return <span className={`inline-flex items-center gap-1.5 t-caption ${status.state === 'closed' ? 'text-finance-green' : 'text-finance-amber'}`}>
    <span aria-hidden className={`h-1.5 w-1.5 ${status.state === 'closed' ? 'bg-finance-green' : 'bg-finance-amber'}`} />
    {status.month} · {MONTH_STATE_LABELS[status.state]}{status.state !== 'closed' && ' · 잠정 내역 기준'}
  </span>
}

export function YearStatusLabel({ year, closedMonths, provisionalMonths }: { year: number; closedMonths: number[]; provisionalMonths: number[] }) {
  const list = provisionalMonths.length > 0 ? ` (${provisionalMonths.join('·')}월)` : ''
  return <span className="inline-flex items-center gap-1.5 t-caption font-medium text-finance-green" title="마감 월은 확정 값으로, 미마감 월은 회색 잠정 값으로 계산합니다.">
    <span aria-hidden className="h-[7px] w-[7px] bg-current" />
    {year}년 · 마감 {closedMonths.length}개월 · 잠정 {provisionalMonths.length}개월{list}
  </span>
}
```

`shortDate`는 서버 시간대로 계산되므로 `TZ=Asia/Seoul`이 아닌 환경에서 날짜가 하루 어긋날 수 있다. 서버(Vercel)와 로컬 모두 KST가 아니므로 `new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })`로 바꾼다:

```ts
function shortDate(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).formatToParts(new Date(iso))
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${Number(month)}/${Number(day)}`
}
```

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/month-status-label.test.tsx`
Expected: PASS (4 tests). `closed.closedAt = 2026-06-02T03:00Z` → KST 6/2.

- [ ] **Step 5: 커밋**

```bash
git add src/features/month-close/month-status-label.tsx tests/finance/month-status-label.test.tsx vitest.config.ts
git commit -m "feat(month-close): heading variant and year summary for the status chip"
```

---

### Task 3: 내역 · 체크리스트 블록과 h1 칩

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 스펙 §3.1의 표시 조건은 open && closable뿐이므로 아래 tab !== 'ai' 가드를 제거한다. AI 탭에서도 체크리스트를 보여주되 기존 전체 월 진단 범위·불필요한 분석 로더 생략은 유지한다. 정기거래 액션 노드는 monthClose.unpostedRecurringCount로 만들 수 있어 AI 탭에서 정기거래 목록을 로드할 필요가 없다. 기존 AI 테스트는 '정기거래 텍스트 없음' 대신 중복 입력/필터 없음과 체크리스트 존재를 확인한다. Self-Review에만 있던 allClear?: boolean prop 및 ended/open/allClear일 때 초록 마감 버튼을 이 태스크에서 구현한다. 확인 창의 해제 설명도 '잠정 값으로 돌아갑니다'로 바꾼다. 완료된 정기거래 줄은 '정기거래 반영 완료'. 현재 /budgets/review?month=는 작성할 예산 월을 받으므로 다음 달 링크 예시를 유지하며 연도 경계를 검증한다. mock 상태는 beforeEach에서 복원한다.

**Files:**
- Create: `src/features/month-close/month-wrap-up.tsx`
- Modify: `src/app/ledger/page.tsx:112-195`, `src/features/month-close/month-close-control.tsx:66`
- Test: `tests/finance/diagnosis-ledger-page.test.ts` (기존, 갱신)

**Interfaces:**
- Consumes: `wrapUpSteps` (Task 1), `MonthStatusLabel` heading variant (Task 2), 페이지가 이미 읽는 `monthClose: MonthCloseSummary`, `recurringPending`
- Produces: `MonthWrapUp({ summary, month, recurringForm })` 서버 컴포넌트. `recurringForm`은 페이지가 이미 렌더하는 `applyRecurringMonth` 폼 노드를 그대로 넘긴다(정기거래 줄의 액션).

- [ ] **Step 1: 실패하는 테스트 작성** — `diagnosis-ledger-page.test.ts`에 테스트 추가

```ts
  test('an ended open month shows the wrap-up checklist above the close control and the heading chip', async () => {
    const html = renderToStaticMarkup(await LedgerPage({ searchParams: Promise.resolve({ month: '2026-07' }) }))
    expect(html).toContain('2026년 7월 · 미마감 · 잠정')
    expect(html).toContain('7월 마무리')
    expect(html).toContain('정리 완료 · 아래에서 마감')
    expect(html.indexOf('7월 마무리')).toBeLessThan(html.indexOf('월 마감 상태'))
    expect(html).not.toContain('잠정 내역 기준 진단 ·')
  })
```

mock의 `getMonthCloseSummary`는 `pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0`이라 접힌 상태(`정리 완료`)가 나와야 한다. 미분류가 있는 경우는 mock을 바꾸는 두 번째 테스트로 덮는다:

```ts
  test('open items render as steps with their links', async () => {
    closeSummary.unclassifiedCount = 5
    const html = renderToStaticMarkup(await LedgerPage({ searchParams: Promise.resolve({ month: '2026-07' }) }))
    expect(html).toContain('미분류 거래')
    expect(html).toContain('href="/inbox?tab=unclassified"')
    expect(html).toContain('정리 2 / 3')
    closeSummary.unclassifiedCount = 0
  })
```

이를 위해 파일 상단의 mock을 변수로 바꾼다:

```ts
const closeSummary = vi.hoisted(() => ({ month: '2026-07', revision: 1, closedRevision: null as number | null, closedAt: null as string | null, state: 'open' as const, count: 166, income: 7681047, expense: 5603949, saving: 850000, pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0, closable: true, requiresAcknowledgment: false }))
vi.mock('@/features/month-close/queries', () => ({ getMonthCloseSummary: async () => ({ ...closeSummary }) }))
```

`MonthWrapUp`은 서버 컴포넌트이므로 mock 하지 않는다(`MonthCloseControl`은 `'use client'`지만 `renderToStaticMarkup`에서 초기 마크업은 렌더된다 — 기존 테스트가 이미 그렇게 동작).

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/diagnosis-ledger-page.test.ts`
Expected: FAIL — `7월 마무리` 없음

- [ ] **Step 3: 컴포넌트 구현**

```tsx
// src/features/month-close/month-wrap-up.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

import type { MonthCloseSummary } from './state'
import { wrapUpSteps } from './wrap-up'

/**
 * Stacked above the close control: the clean-up list only. Closing itself
 * stays in MonthCloseControl, so the two never show the same button twice.
 */
export function MonthWrapUp({ summary, recurringForm }: { summary: MonthCloseSummary; recurringForm: ReactNode }) {
  const model = wrapUpSteps(summary)
  if (!model.visible) return null
  const monthLabel = `${Number(summary.month.slice(5, 7))}월`
  const nextMonth = `${Number(summary.month.slice(5, 7)) % 12 + 1}월`
  const reviewMonth = summary.month.slice(5, 7) === '12'
    ? `${Number(summary.month.slice(0, 4)) + 1}-01`
    : `${summary.month.slice(0, 4)}-${String(Number(summary.month.slice(5, 7)) + 1).padStart(2, '0')}`

  return (
    <section aria-label={`${monthLabel} 마무리`} className="mt-4 border-t border-finance-ink border-b border-finance-hairline py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="t-body-strong text-finance-ink">{monthLabel} 마무리</h2>
        <span className="t-caption text-finance-muted">{model.allClear ? '정리 완료' : `정리 ${model.doneCount} / ${model.steps.length}`}</span>
        <span className="ml-auto t-caption text-finance-muted">{model.allClear ? '아래에서 마감합니다' : '정리가 끝나면 아래에서 마감합니다'}</span>
      </div>
      <ul className="mt-2">
        {model.allClear ? (
          <li className="flex items-center gap-3 py-2 t-body text-finance-muted"><span aria-hidden className="h-2 w-2 bg-finance-green" />정리 완료 · 아래에서 마감</li>
        ) : model.steps.map((step) => (
          <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 border-t border-finance-track py-2 first:border-t-0" key={step.key}>
            <span aria-hidden className={`h-2 w-2 justify-self-center ${step.done ? 'bg-finance-green' : 'bg-finance-amber'}`} />
            <div className="t-body">
              <span className={step.done ? 'text-finance-muted line-through decoration-finance-faint' : 'font-semibold text-finance-ink'}>{step.label}</span>
              <span className="ml-2 t-caption text-finance-muted">{step.done ? (step.key === 'recurring' ? '반영 완료' : '0건') : `${step.count}건`}</span>
              {!step.done && step.note && <span className="ml-2 t-caption text-finance-muted">· {step.note}</span>}
            </div>
            {step.done ? <span className="t-caption text-finance-faint">완료</span>
              : step.href ? <Link className="t-caption font-semibold text-finance-blue" href={step.href}>{step.key === 'inbox' ? '검토하기 →' : '분류하기 →'}</Link>
              : recurringForm}
          </li>
        ))}
        <li className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 border-t border-finance-track py-2">
          <span aria-hidden className="h-2 w-2 justify-self-center bg-finance-faint" />
          <div className="t-body text-finance-faint">AI 진단 · {nextMonth} 예산 만들기<span className="ml-2 t-caption">선택 · 마감 뒤에</span></div>
          <span className="flex gap-3 t-caption font-medium text-finance-faint">
            <Link className="hover:text-finance-blue" href={`/ledger?month=${summary.month}&tab=ai`}>진단 →</Link>
            <Link className="hover:text-finance-blue" href={`/budgets/review?month=${reviewMonth}`}>예산 →</Link>
          </span>
        </li>
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: 페이지에 연결**

`src/app/ledger/page.tsx`:

(a) import 추가:

```ts
import { MonthWrapUp } from '@/features/month-close/month-wrap-up'
import { MonthStatusLabel } from '@/features/month-close/month-status-label'
```

(b) h1을 다음으로 교체 (line 119):

```tsx
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              내역
              <MonthStatusLabel currentMonthKey={currentMonth} elapsed={shell.month === currentMonth ? { day: Number(defaultDate.slice(8, 10)), days: new Date(Date.UTC(Number(shell.month.slice(0, 4)), Number(shell.month.slice(5, 7)), 0)).getUTCDate() } : undefined} status={monthClose} variant="heading" />
            </h1>
```

`currentMonth`와 `defaultDate`는 현재 return 아래(line 107-110)에서 계산되므로 그 두 줄을 `monthClose` 계산 직후(line 79)로 올린다.

(c) 정기거래 반영 폼을 변수로 뽑는다. 기존 `<form action={applyRecurringMonth}>…</form>`을 `const recurringApplyForm = monthClose.unpostedRecurringCount > 0 ? (<form …>…</form>) : null`로 return 앞에 정의한다. 체크리스트가 보이면 이 노드는 MonthWrapUp 안에서만 렌더하고, 기존 자리는 체크리스트가 보이지 않을 때만 렌더한다. 같은 이름의 정기거래 반영 액션이 두 번 표시되지 않도록 렌더 테스트에서 액션 개수가 1임을 검증한다. 필터/탭은 마감 요약과 반영 대상 월을 바꾸지 않는다.

(d) line 141 `<MonthCloseControl …/>` 바로 **위**에 삽입:

```tsx
        {tab !== 'ai' && <MonthWrapUp recurringForm={recurringApplyForm ?? <span className="t-caption text-finance-faint">내역에서 반영</span>} summary={monthClose} />}
```

(e) line 193의 AI 탭 문장 `<p className="mt-4 t-caption text-finance-amber">잠정 내역 기준 진단 · …</p>` 줄을 삭제한다.

(f) `src/features/month-close/month-close-control.tsx` line 66의 문장을 바꾼다:

```tsx
        <p className="mt-3 t-caption leading-relaxed text-finance-muted">현재 탭·필터와 무관한 한 달 전체 거래입니다. 마감하면 통계에서 확정 값으로 계산되고, 이후 내역이 바뀌면 다시 확인해야 합니다.</p>
```

그리고 line 45의 성공 문구 `${month} 전체를 마감했습니다. 통계에 반영됩니다.` → `${month} 전체를 마감했습니다. 통계에서 확정 값으로 계산됩니다.`, 해제 문구 `통계에서 제외됩니다.` → `통계에서 잠정 값으로 돌아갑니다.`

- [ ] **Step 5: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/diagnosis-ledger-page.test.ts && NODE_OPTIONS= pnpm exec tsc --noEmit`
Expected: PASS (4 tests), tsc 0 errors. 기존 `orders tabs` 테스트의 `not.toContain('정기거래')`는 AI 탭에서만 확인하므로 체크리스트(`tab !== 'ai'`)와 충돌하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/month-close/month-wrap-up.tsx src/features/month-close/month-close-control.tsx src/app/ledger/page.tsx tests/finance/diagnosis-ledger-page.test.ts
git commit -m "feat(ledger): stack the wrap-up checklist above the month close control"
```

---

### Task 4: 홈 · `close` 할 일, KPI 두 칸, 섹션 제거

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 첫 거래 월 쿼리는 householdId로 한정하고 이전 12개월 상태를 첫 거래 월 이후로 필터한다. 첫 거래가 없으면 closeTargets=[]. 제목은 최대 두 월, 복수면 상세 끝에 N개월(최신이 needs_review인 경우도 포함), 최신 needs_review는 '다시 마감하기'. 기존 통합 buildHomeTodos 호출에도 closeTargets: [] 추가. 현재 net-worth 관련 순수 테스트는 세 개이므로 모두 제거하되 고정비/변동비 검증 보존. 8월 fixture 추가 시 미분류 총수도 실제에 맞춘다. 테스트 시계는 KST 기준으로 고정하며 빈 가구와 여러 재확인 월을 추가 검증한다.

**Files:**
- Modify: `src/features/analytics/home-todos.ts`, `src/app/dashboard/page.tsx`
- Delete: `src/features/analytics/net-worth.ts`; `src/features/analytics/home-trend-charts.tsx`에서 `CashflowWaterfall` 제거
- Test: `tests/finance/home-todos.test.ts` (신규), `tests/integration/home-dashboard.test.ts` (갱신)

**Interfaces:**
- Consumes: `readMonthStatuses(db, householdId, months)`, `readMonthCloseSummary(db, householdId, month)` (`src/features/month-close/queries.ts`), `shiftMonth`, `currentMonthInKorea`
- Produces: `HomeTodoKind = 'close' | …`, `HomeTodoInput.closeTargets: CloseTarget[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/finance/home-todos.test.ts
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
  const todos = buildHomeTodos({ ...base, closeTargets: [{ month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 5, unpostedRecurringCount: 1 }] })
  expect(todos[0]).toMatchObject({ kind: 'close', title: '8월 마무리하기', detail: '미분류 5건 · 정기거래 미반영 1건 · 마감 전', href: '/ledger?month=2026-08' })
  expect(todos[1].kind).toBe('anomaly')
})

test('a clean month says so, a reviewed month asks to close again, several months fold into one line', () => {
  expect(buildHomeTodos({ ...base, closeTargets: [{ month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 }] })[0].detail).toBe('정리 완료 · 마감 전')
  expect(buildHomeTodos({ ...base, closeTargets: [{ month: '2026-08', state: 'needs_review', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 }] })[0]).toMatchObject({ title: '8월 다시 마감하기', detail: '마감 뒤 내역이 바뀌었습니다' })
  const many = buildHomeTodos({ ...base, closeTargets: [
    { month: '2026-08', state: 'open', pendingCount: 0, unclassifiedCount: 2, unpostedRecurringCount: 0 },
    { month: '2026-07', state: 'open', pendingCount: 0, unclassifiedCount: 0, unpostedRecurringCount: 0 },
  ] })[0]
  expect(many).toMatchObject({ title: '8월 · 7월 마무리하기', detail: '미분류 2건 · 마감 전 · 2개월', href: '/ledger?month=2026-08' })
})

test('no ended open month means no close todo', () => {
  expect(buildHomeTodos(base).some((todo) => todo.kind === 'close')).toBe(false)
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/home-todos.test.ts`
Expected: FAIL — `closeTargets` 타입 없음 / `close` 없음

- [ ] **Step 3: `buildHomeTodos` 구현**

`src/features/analytics/home-todos.ts`:

```ts
export type HomeTodoKind = 'close' | 'anomaly' | 'pace' | 'inbox' | 'unclassified' | 'review' | 'recurring'

export type CloseTarget = {
  month: string
  state: 'open' | 'needs_review'
  pendingCount: number
  unclassifiedCount: number
  unpostedRecurringCount: number
}

export type HomeTodoInput = {
  // …기존 필드…
  /** Ended months still open or needing review, most recent first. */
  closeTargets: CloseTarget[]
}

function monthWord(month: string) {
  return `${Number(month.slice(5, 7))}월`
}

function closeTodo(targets: CloseTarget[]): HomeTodo | null {
  const [first] = targets
  if (!first) return null
  const title = first.state === 'needs_review'
    ? `${monthWord(first.month)} 다시 마감하기`
    : `${targets.map((target) => monthWord(target.month)).join(' · ')} 마무리하기`
  const leftovers = [
    first.pendingCount > 0 ? `대기 ${first.pendingCount}건` : null,
    first.unclassifiedCount > 0 ? `미분류 ${first.unclassifiedCount}건` : null,
    first.unpostedRecurringCount > 0 ? `정기거래 미반영 ${first.unpostedRecurringCount}건` : null,
  ].filter((part): part is string => part !== null)
  const detail = first.state === 'needs_review'
    ? '마감 뒤 내역이 바뀌었습니다'
    : [...(leftovers.length > 0 ? leftovers : ['정리 완료']), '마감 전', ...(targets.length > 1 ? [`${targets.length}개월`] : [])].join(' · ')
  return { kind: 'close', priority: 0, title, detail, href: `/ledger?month=${first.month}` }
}
```

`buildHomeTodos` 맨 앞에서 `const close = closeTodo(input.closeTargets); if (close) rows.push(close)`.

- [ ] **Step 4: `getHomeTodos`에 월 상태 조회 추가**

```ts
import { readMonthCloseSummary, readMonthStatuses } from '@/features/month-close/queries'
```

`Promise.all`에 항목 추가:

```ts
    readMonthStatuses(db, householdId, Array.from({ length: 12 }, (_, index) => shiftMonth(month, -(index + 1)))),
```

결과를 `monthStatuses`로 받아 `buildHomeTodos` 호출 전에:

```ts
  const targets = monthStatuses
    .filter((status) => status.state !== 'closed')
    .sort((left, right) => right.month.localeCompare(left.month))
  const [latest] = targets
  const latestSummary = latest ? await readMonthCloseSummary(db, householdId, latest.month) : null
  const closeTargets: CloseTarget[] = targets.map((status) => ({
    month: status.month,
    state: status.state === 'needs_review' ? 'needs_review' : 'open',
    pendingCount: status.month === latest?.month ? latestSummary!.pendingCount : 0,
    unclassifiedCount: status.month === latest?.month ? latestSummary!.unclassifiedCount : 0,
    unpostedRecurringCount: status.month === latest?.month ? latestSummary!.unpostedRecurringCount : 0,
  }))
```

주의: 미마감이 12개월 전부일 수 있다(초기 상태). 그러면 제목이 `8월 · 7월 · … 마무리하기`로 길어진다. `targets.slice(0, 2)`의 월만 제목에 쓰고 `N개월`로 나머지를 표현한다 — `closeTodo`의 `targets.map(...)`을 `targets.slice(0, 2).map(...)`으로 바꾸고, 테스트의 세 번째 기대값은 그대로 두 달이라 영향이 없다. 거래가 한 건도 없는 먼 과거 월(가구 생성 전)이 잡히지 않도록 `readMonthStatuses` 대상은 **첫 거래 월 이후**로 제한한다: `getHomeTodos`가 이미 읽는 `transactionRows`의 최솟값 대신, `db.select({ first: sql<string|null>\`min(to_char(${transactions.date}, 'YYYY-MM'))\` })`를 `Promise.all`에 추가하고 `shiftMonth` 목록을 `month >= first`로 필터한다.

- [ ] **Step 5: 홈 페이지 편집** — `src/app/dashboard/page.tsx`

(a) import에서 `Sparkline`은 유지(카테고리 표), `SavingsProgressRing` 유지. 제거: `CashflowWaterfall`, `getNetWorthSeries`, `NetWorthChart`. 추가: `import { MonthStatusLabel } from '@/features/month-close/month-status-label'`, `import { getMonthStatuses } from '@/features/month-close/queries'`.

(b) 데이터 로드:

```ts
  const [data, todos, [monthStatus]] = await Promise.all([
    getDashboardData(household.householdId, year, month),
    getHomeTodos(household.householdId),
    getMonthStatuses(household.householdId, [month]),
  ])
```

`netWorth`, `latestNetWorth`, `previousNetWorth`, `netWorthDelta` 계산 삭제.

(c) 헤더(line 101-109)를 교체:

```tsx
        <header>
          <p className="t-label uppercase text-finance-blue">이번 달</p>
          <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
            홈
            <MonthStatusLabel currentMonthKey={month} elapsed={{ day: data.pace.elapsed, days: data.pace.daysInMonth }} status={monthStatus} variant="heading" />
          </h1>
        </header>
```

(d) KPI 섹션(line 111-167): `lg:grid-cols-3` → `lg:grid-cols-2`, 세 번째 `<Link … href="/assets">…</Link>` 카드 삭제. 두 번째 article의 `lg:px-8` → `lg:pl-8`.

(e) 할 일 목록의 `TODO_TONES`에 `close: 'bg-finance-amber'` 추가. `visibleTodos = todos.slice(0, 3)`은 유지(마감이 0순위라 항상 보인다).

(f) line 182-202의 `<section …>순자산 추이 … 이번 달 돈의 흐름</section>` 전체 삭제.

(g) `src/features/analytics/home-trend-charts.tsx`에서 `CashflowWaterfall` 함수(88-163행)와 그것만 쓰던 import(`Bar`, `formatWon`이 `SavingsRateChart`에서도 쓰이는지 확인 후 정리) 삭제. `src/features/analytics/net-worth.ts` 삭제.

- [ ] **Step 6: 통합 테스트 갱신** — `tests/integration/home-dashboard.test.ts`

`buildNetWorthSeries`/`getNetWorthSeries` import와 그 두 테스트 블록(`carries account balances across months…` 전체, 그리고 140행 `const netWorth = …`·144-146행 `expect(netWorth)…`)을 삭제한다. `expect(dashboard.current).toMatchObject({ fixedExpense: 3_000_000, variableExpense: 1_500_000 })`는 유지한다. 같은 테스트에 추가:

```ts
    expect(todos[0]).toMatchObject({ kind: 'close', href: '/ledger?month=2026-08' })
```

(fixture는 2026-08 거래가 있고 8월은 미마감이므로 0순위로 나온다. fixture에 8월 거래가 없으면 seed에 한 건 추가한다.)

- [ ] **Step 7: 통과 확인**

Run: `NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 유닛 전부 PASS, tsc·lint 0. Docker가 있으면 `NODE_OPTIONS= pnpm vitest run --project integration tests/integration/home-dashboard.test.ts`도 PASS.

- [ ] **Step 8: 커밋**

```bash
git add src/features/analytics/home-todos.ts src/app/dashboard/page.tsx src/features/analytics/home-trend-charts.tsx tests/finance/home-todos.test.ts tests/integration/home-dashboard.test.ts
git rm src/features/analytics/net-worth.ts
git commit -m "feat(home): put the month close first in the todo list and drop the asset card and two charts"
```

---

### Task 5: 예산·월말 리뷰 · 문장 삭제와 칩 위치

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** tests/finance/month-status-pages.test.tsx를 신규 허용/git add 경로로 추가한다. 외부 로더/인증만 mock하고 실제 페이지를 renderToStaticMarkup하여 선택 월 칩이 h1에 있고 독립 안내 문장이 없는지 실패 테스트부터 작성한다. 이번 달 예산 칩에 KST 경과일/월 일수를 전달한다. 두 파일의 남은 원시 text-[Npx]도 t-*로 바꾸되 로더/계산은 유지한다.

**Files:**
- Modify: `src/app/budgets/page.tsx:70-78`, `src/app/budgets/review/page.tsx:32-39`

**Interfaces:**
- Consumes: `MonthStatusLabel` heading variant (Task 2), `getMonthStatuses`(이미 두 페이지가 호출), `currentMonthInKorea`

- [ ] **Step 1: 예산 페이지** — line 73-77을 교체

```tsx
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              {data.month.replace('-', '년 ')}월 예산
              <MonthStatusLabel currentMonthKey={currentMonth} status={monthStatus} variant="heading" />
            </h1>
```

`<p className="mt-3"><MonthStatusLabel …/></p>`와 `실제 사용액은 마감 전 내역도 포함합니다…` 문장 두 줄을 삭제한다. `currentMonth`는 이미 line 60에 있다.

- [ ] **Step 2: 월말 리뷰 페이지** — line 32의 h1을 t-* 스케일로 바꾸면서 칩을 붙이고, line 38-39 두 줄을 삭제

```tsx
          <div>
            <p className="t-label uppercase text-finance-blue">월말 계획</p>
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              월말 리뷰
              <MonthStatusLabel currentMonthKey={currentMonthInKorea()} status={monthStatus} variant="heading" />
            </h1>
            <p className="mt-2 t-caption text-finance-muted">{data.reviewMonth} 결산 → {data.targetMonth} 예산 만들기</p>
          </div>
```

`import { currentMonthInKorea, formatRate, formatWon } from '@/lib/finance'`로 import를 늘린다. 같은 파일의 `SummaryCard`에 있는 `text-[11px]`·`text-[26px]`는 `t-label`·`t-kpi`로 바꾼다(원시 크기 금지 규칙).

- [ ] **Step 3: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && git grep -n "잠정 내역이 포함될 수\|미마감 내역도 포함한 실시간" -- src`
Expected: tsc·lint 0, grep 결과 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/budgets/page.tsx src/app/budgets/review/page.tsx
git commit -m "refactor(budgets): replace the provisional sentences with the heading chip"
```

---

### Task 6: 통계 읽기 모델 · 확정과 잠정 두 결과

**전년 잠정 비교 보정 (2026-09-09):** `previousComparable`만 모든 대응 월의 전년 마감을 요구한다. `previousEndedComparable`은 `provisionalMonths`와 같은 월 번호 중 전년 거래 또는 명시 0원 마감이 **하나 이상** 있으면 true다(`some`, `every`가 아님). 양쪽 집계 입력의 월 번호 집합은 같게 유지하되, 일부만 기록된 전년은 잠정 값으로 표시한다. 같은 기간에 전년 근거가 전혀 없으면 false다. 일부 전년 기록/전년 전무/기간 밖 전년 기록만 있는 경우를 회귀 테스트로 구분한다.

**추가 실행 보정 (2026-09-09, TOP 비교 경계):** `src/features/analytics/report.ts`를 명시 허용/git add 경로에 추가한다. 기존 `topExpenses` 6개·`topMerchants` 8개 제한은 그대로 유지하고, 제한 전 이미 계산한 행에서 `expenseComparisons`(대분류 이름 키), `merchantComparisons`(normalizeAnalyticsMerchant 키)를 추가 반환한다. 각 값은 기존 amount/previous/delta를 그대로 재사용한다. 집계·정규화·비율·순위 산식 변경 없이 잠정 TOP 밖으로 밀려난 확정 TOP 항목도 Task 8에서 이름으로 비교할 수 있게 하는 메타데이터다. `tests/finance/closed-report.test.ts`에 6/8개 초과 및 확정/잠정 순위가 다른 사례를 검증한다. Task 8은 제한된 TOP 배열을 비교 lookup으로 사용하지 않는다.

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 중요: 스펙 §3.3의 '무거래 미마감 월은 0이 아님'이 아래 예시보다 우선한다. endedMonths는 끝난 달력 월 전부를 유지하되 recordedMonths(실제 거래가 있는 월), provisionalMonths = endedMonths ∩ (recordedMonths ∪ closedMonths)를 별도 반환한다. 잠정 report의 eligibleMonths/provisionalDivisor/달성 분모는 provisionalMonths를 사용한다. CategoryDetail에도 optional recordedMonths/provisionalMonths를 추가한다. hasTransactions는 금액 합계가 아닌 거래 존재로 연도/월에 제공한다. active는 미래 여부이고 값 존재와 별개. 미마감 무기록 월의 account series는 null, 명시 마감 0원은 0. 현재 fixture의 잠정 분모는 마감 전 2, 1·3월 마감 후 3이고 확정 분모는 2이므로 provisionalDivisor=8 예시는 폐기한다. 전년 잠정 비교도 대응 기록/명시 0원 마감 존재를 확인하여 전년 무기록을 0원으로 단정하지 않는다. 비교 양쪽 월 번호 집합을 일치시킨다. currentMonthKey 주입은 필수이며 통합 테스트에 명시한다. 환불만/상쇄 0원/현재달 수입만/미마감 무기록/마감 0원 테스트를 추가한다. report.ts의 기존 산식은 유지한다.

**Files:**
- Modify: `src/features/analytics/stats-report.ts`, `src/features/analytics/category-detail.ts:40-60`, `src/app/report/page.tsx` (컴파일 유지용 최소 변경)
- Test: `tests/integration/closed-report.test.ts` (갱신), `tests/finance/closed-report.test.ts` (추가)

**Interfaces:**
- Produces (`getStatsReportData` 반환):
  - `report: { official: AnnualReport; provisional: AnnualReport }` (`AnnualReport = ReturnType<typeof buildAnnualReport>`)
  - `closedMonths: number[]` (마감·끝난 월), `endedMonths: number[]` (끝난 월 전부), `monthStates: StatsMonthState[]` (길이 12)
  - `monthly: Array<{ month, income, expense, saving, savingsRate, active, state: StatsMonthState }>` — 12개월 전부 집계
  - `details[flow]`: 기존 필드 + `endedMonths`, `states`, `provisionalDivisor`
  - `previousComparable`(확정), `previousEndedComparable`(잠정), `targetHitMonths`(마감 월 기준), `provisionalTargetHitMonths`(끝난 월 기준)
- `export type StatsMonthState = 'closed' | 'open' | 'needs_review' | 'current' | 'future'` — `category-detail.ts`에 둔다(`stats-monthly.ts`와 `stats-report.ts` 모두 import).

- [ ] **Step 1: 통합 테스트 갱신** — `tests/integration/closed-report.test.ts` 첫 테스트를 다음으로 교체

```ts
test('statistics compute an official result from closed months and a provisional one from every ended month', async () => {
  await db.insert(settings).values({ householdId, key: 'savings_target', value: '65' })
  const before = await getStatsReportData(householdId, 2026)
  expect(before.closedMonths).toEqual([])
  expect(before.endedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(before.report.official.annual.expense).toBe(0)
  expect(before.report.provisional.annual.expense).toBe(1399)
  expect(before.monthly[1]).toMatchObject({ expense: 999, state: 'open', active: true })
  expect(before.monthStates.slice(7, 10)).toEqual(['open', 'current', 'future'])

  await close('2026-01'); await close('2026-03')
  const data = await getStatsReportData(householdId, 2026)
  expect(data.savingsTarget).toBe(65)
  expect(data.closedMonths).toEqual([1, 3])
  expect(data.monthStates.slice(0, 3)).toEqual(['closed', 'open', 'closed'])
  expect(data.report.official.annual.expense).toBe(400)
  expect(data.report.official.cashflow.monthlyNet).toBe(300)
  expect(data.report.provisional.annual.expense).toBe(1399)
  expect(data.details.expense.closedMonths).toEqual([1, 3])
  expect(data.details.expense.divisor).toBe(2)
  expect(data.details.expense.provisionalDivisor).toBe(8)
  expect(data.details.expense.groups[0].subs[0].months.slice(0, 3)).toEqual([400, 999, 0])
  expect(data.accountMonthly.expense.series['(미지정)'].slice(0, 3)).toEqual([400, 999, 0])
  expect(data.previousComparable).toBe(false)
  expect(data.previousEndedComparable).toBe(true)
  expect(data.report.provisional.previous.expense).toBe(200)
  await close('2025-01'); await close('2025-03')
  const comparable = await getStatsReportData(householdId, 2026)
  expect(comparable.previousComparable).toBe(true)
  expect(comparable.report.official.previous.expense).toBe(200)
})
```

이 테스트는 `currentMonthKey`가 `2026-09`일 때 맞다. 날짜 의존을 없애려면 `getStatsReportData(householdId, 2026, { currentMonthKey: '2026-09' })` 세 번째 인자를 받게 한다(기본값 `currentMonthInKorea()`). 두 번째 테스트(`closed cell requests …`)는 마지막 줄만 `eligibleMonths` → `closedMonths`로 바꾼다.

- [ ] **Step 2: 유닛 테스트 추가** — `tests/finance/closed-report.test.ts`

```ts
test('the same rows yield an official and a provisional report that only differ by eligibility', () => {
  const official = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1], previousComparable: false })
  const provisional = buildAnnualReport({ year: 2026, currentMonthKey: '2026-09', transactions: rows, assetBalances: [], eligibleMonths: [1, 2, 3, 4, 5, 6, 7, 8], previousComparable: true })
  expect(official.annual.expense).toBe(400)
  expect(official.hasPrevious).toBe(false)
  expect(provisional.annual.expense).toBe(1399)
  expect(provisional.hasPrevious).toBe(true)
  expect(provisional.previous.expense).toBe(900)
  expect(provisional.cashflow.completedMonthDivisor).toBe(8)
})
```

- [ ] **Step 3: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/closed-report.test.ts`
Expected: 새 테스트는 순수 함수만 쓰므로 바로 PASS. 통합 테스트는 Docker가 있을 때 `NODE_OPTIONS= pnpm vitest run --project integration tests/integration/closed-report.test.ts` → FAIL (`closedMonths` undefined).

- [ ] **Step 4: 타입 추가** — `src/features/analytics/category-detail.ts`의 `CategoryDetail`

```ts
export type StatsMonthState = 'closed' | 'open' | 'needs_review' | 'current' | 'future'

export type CategoryDetail = {
  groups: CategoryDetailGroup[]
  months: number[]
  divisor: number
  currentMonth: number | null
  closedMonths?: number[]
  monthRevisions?: Record<number, number>
  /** Every ended month of the year, closed or not. Drives which columns show values. */
  endedMonths?: number[]
  states?: StatsMonthState[]
  /** Denominator for the grey fallback average when no month is closed. */
  provisionalDivisor?: number
}
```

- [ ] **Step 5: `stats-report.ts` 구현** — 함수 본문을 다음으로 교체

```ts
export async function getStatsReportData(
  householdId: string,
  requestedYear?: number,
  options: { currentMonthKey?: string } = {},
) {
  const currentMonthKey = options.currentMonthKey ?? currentMonthInKorea()
  const year = Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100
    ? requestedYear! : Number(currentMonthKey.slice(0, 4))
  return db.transaction(async tx => {
    const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    const statuses = await readMonthStatuses(tx, householdId, [...monthKeys, ...monthKeys.map(key => `${year - 1}${key.slice(4)}`)])
    const months = statuses.slice(0, 12)
    const previous = statuses.slice(12)
    const monthStates: StatsMonthState[] = months.map(row => (
      row.month > currentMonthKey ? 'future' : row.month === currentMonthKey ? 'current' : row.state
    ))
    const closedMonths = months.filter((row, i) => monthStates[i] === 'closed').map(row => Number(row.month.slice(5)))
    const endedMonths = months.filter((_, i) => monthStates[i] !== 'current' && monthStates[i] !== 'future').map(row => Number(row.month.slice(5)))
    const previousClosed = new Set(previous.filter(row => row.state === 'closed').map(row => Number(row.month.slice(5))))
    const previousComparable = closedMonths.length > 0 && closedMonths.every(month => previousClosed.has(month))
    const previousEndedComparable = endedMonths.length > 0

    // rows, balances, taxonomy, target: 기존 쿼리 그대로

    const ended = new Set(endedMonths)
    const yearRows = rows.filter(row => row.date.startsWith(`${year}-`))
    const displayRows = yearRows.filter(row => {
      const month = Number(row.date.slice(5, 7))
      return ended.has(month) || monthStates[month - 1] === 'current'
    })
    const monthly = monthlySummaries(yearRows, year).map((row, index) => ({
      ...row,
      state: monthStates[index],
      active: monthStates[index] !== 'future',
    }))
    const details = buildCategoryDetails({ year, currentMonthKey, taxonomy, transactions: displayRows })
    const monthRevisions = Object.fromEntries(months.filter((row, i) => monthStates[i] === 'closed').map(row => [Number(row.month.slice(5)), row.revision]))
    const accountMonthly = {} as Record<ReportFlow, AccountMonthlyData>
    for (const flow of FLOWS) {
      Object.assign(details[flow], {
        months: Array.from({ length: 12 }, (_, i) => i + 1),
        divisor: closedMonths.length,
        provisionalDivisor: endedMonths.length,
        closedMonths,
        endedMonths,
        states: monthStates,
        monthRevisions,
      })
      const account = buildAccountMonthly(displayRows, flow, { fold: false })
      for (const name of account.accounts) {
        account.series[name] = account.series[name].map((value, i) => monthStates[i] === 'future' ? null : value ?? 0)
      }
      accountMonthly[flow] = account
    }
    const savingsHit = (eligible: number[]) => monthly.filter((row, i) => eligible.includes(i + 1) && row.income > 0 && row.savingsRate >= savingsTarget).length
    return {
      report: {
        official: buildAnnualReport({ year, currentMonthKey, transactions: rows, assetBalances: balances, eligibleMonths: closedMonths, previousComparable }),
        provisional: buildAnnualReport({ year, currentMonthKey, transactions: rows, assetBalances: balances, eligibleMonths: endedMonths, previousComparable: previousEndedComparable }),
      },
      monthly, accountMonthly, details, savingsTarget, months, monthStates,
      closedMonths, endedMonths, previousComparable, previousEndedComparable,
      targetHitMonths: savingsHit(closedMonths),
      provisionalTargetHitMonths: savingsHit(endedMonths),
      assetBasisMonth: balances.map(row => row.month).sort().at(-1) ?? null,
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
```

`import { buildCategoryDetails, type StatsMonthState } from './category-detail'`. `monthlySummaries`가 `active`를 자체 계산하므로 우리가 덮어쓴다.

- [ ] **Step 6: `report/page.tsx` 컴파일 유지** — 이 태스크에서는 이름만 맞춘다. `const data = stats.report` → `const data = stats.report.official`, `stats.eligibleMonths` → `stats.closedMonths`, `completedMonths = stats.closedMonths.length`, `monthList = stats.closedMonths.map(...)`. 화면 규칙(잠정 폴백·칩·스트립)은 Task 8.

- [ ] **Step 7: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS. Docker 있으면 `NODE_OPTIONS= pnpm vitest run --project integration tests/integration/closed-report.test.ts` PASS.

`tests/finance/stats-monthly.test.ts`의 `closed eligibility keeps an intervening open month null…`는 Task 7에서 바뀐다. 이 시점에는 `stats-monthly.ts`가 그대로라 아직 통과한다.

- [ ] **Step 8: 커밋**

```bash
git add src/features/analytics/stats-report.ts src/features/analytics/category-detail.ts src/app/report/page.tsx tests/integration/closed-report.test.ts tests/finance/closed-report.test.ts
git commit -m "feat(stats): compute official and provisional annual results side by side"
```

---

### Task 7: `stats-monthly.ts` · 표시 대상과 확정 대상 분리

**상세 소비자 보정 (2026-09-09):** 실제 상세 확장 경로는 `stats-monthly-section.tsx`의 선택 행/소분류 미니 추이와 소분류 셀이다. `src/features/analytics/stats-monthly-section.tsx`를 이 태스크의 명시 허용/git add 경로에 추가한다. 모델에 값 존재 마스크 `availableMonths: boolean[]`를 반환하고 이 경로가 넓은 표시 마스크 `eligibleMonths` 대신 값 존재 마스크를 사용하게 연결한다. 무기록 open/current는 null/비활성, 명시 마감 0원은 숫자 0/활성을 유지한다. 이 변경은 값 마스크 연결에 한정하며 잠정 색·태그·scope 변경은 Task 8에 남긴다. 기존 모델 테스트에서 선택 행/상세 행과 미니 추이 입력까지 실제 helper를 조합해 null·0 경계를 검증한다.

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** 표시 마스크는 끝난 월+진행 중, 확정은 closed, 잠정 집계는 Task 6 provisionalMonths다. recordedMonths가 있으면 무기록 미마감/현재 월의 series/displayValues는 null이며 0원 점을 만들지 않는다. states/recordedMonths 없는 기존 소비자는 기존 현재 달 제외 평균을 유지한다(아래 monthDisplayed 폴백만으로 기존 평균을 바꾸면 안 됨). 행/소분류/전체에 provisionalTotal도 추가해 fallback 합계가 현재달 포함 total을 쓰지 않게 한다. 제외는 표시·확정·잠정에 동일하게 반영. statsChartSeries 등 상세 확장 경로도 동일 표시 마스크를 사용. 두 축·상세·진행 중·무기록·제외 상태를 검증한다.

**Files:**
- Modify: `src/features/analytics/stats-monthly.ts:59-82,121-138,145-260,260-298`
- Test: `tests/finance/stats-monthly.test.ts`

**Interfaces:**
- Produces (`StatsMonthlyModel` 추가 필드): `monthStates: StatsMonthState[]`, `closedMonths: boolean[]`(확정 마스크), `eligibleMonths: boolean[]`(표시 마스크 = 끝난 월 + 진행 중), `provisionalDivisor: number`, `provisionalAverage: number | null`. 행(`StatsMonthlyRow`, `StatsMonthlySubRow`)에 `provisionalAverage: number | null`, `closedTotal: number` 추가. `total`은 표시 대상 합계, `closedTotal`은 마감 월 합계.
- 규칙: `average`(확정) = 마감 월만 합산 ÷ `divisor`; `divisor === 0`이면 `null`. `provisionalAverage` = 끝난 월 합산 ÷ `provisionalDivisor`(진행 중인 달 제외).

- [ ] **Step 1: 테스트 교체·추가** — `tests/finance/stats-monthly.test.ts`

첫 테스트 `closed eligibility keeps an intervening open month null…`를 교체:

```ts
  test('open months stay visible and provisional while averages use closed months only', () => {
    const closed: CategoryDetails = { ...details, expense: { ...details.expense,
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 2, provisionalDivisor: 3,
      closedMonths: [1, 3], endedMonths: [1, 2, 3], currentMonth: 4,
      states: ['closed', 'open', 'closed', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: closed, accountMonthly, excluded: new Set() })
    expect(model.series[0].values.slice(0, 5)).toEqual([100, 100, 0, 0, null])
    expect(model.eligibleMonths.slice(0, 5)).toEqual([true, true, true, true, false])
    expect(model.closedMonths.slice(0, 4)).toEqual([true, false, true, false])
    expect(model.rows[0].total).toBe(200)
    expect(model.rows[0].closedTotal).toBe(100)
    expect(model.rows[0].average).toBe(50)
    expect(model.rows[0].provisionalAverage).toBe(67)
    expect(model.divisor).toBe(2)
  })

  test('with nothing closed the official average is unavailable and the provisional one is offered', () => {
    const open: CategoryDetails = { ...details, expense: { ...details.expense,
      months: Array.from({ length: 12 }, (_, i) => i + 1), divisor: 0, provisionalDivisor: 2,
      closedMonths: [], endedMonths: [1, 2], currentMonth: 3,
      states: ['open', 'open', 'current', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future', 'future'],
    } }
    const model = buildStatsMonthlyModel({ flow: 'expense', axis: 'category', details: open, accountMonthly, excluded: new Set() })
    expect(model.average).toBeNull()
    expect(model.provisionalAverage).toBe(185)
    expect(model.series.length).toBe(4)
  })
```

`no closed months exposes an unavailable average…` 테스트는 `expect(model.series).toEqual([])`가 더는 맞지 않으므로(미마감 월도 보임) 위 두 번째 테스트로 대체하고 삭제한다. `categoryDetailMonthlyAverage`의 반올림 규칙(현재 `roundLikePython`)에 따라 200/3 → 67, 370/2 → 185.

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/stats-monthly.test.ts`
Expected: FAIL — `closedMonths`, `provisionalAverage` 없음; 2월 값이 `null`

- [ ] **Step 3: 구현**

`monthEligible`을 두 함수로 나눈다:

```ts
/** A month whose values are shown: every ended month plus the month in progress. */
function monthDisplayed(detail: CategoryDetail, month: number) {
  if (detail.states) return detail.states[month] !== 'future'
  return month < (detail.months.at(-1) ?? 0)
}

/** A month that counts toward official totals and averages. */
function monthClosed(detail: CategoryDetail, month: number) {
  return detail.closedMonths ? detail.closedMonths.includes(month + 1) : monthDisplayed(detail, month)
}

/** Ended, closed or not: the provisional denominator's months. */
function monthEnded(detail: CategoryDetail, month: number) {
  if (detail.states) return detail.states[month] !== 'future' && detail.states[month] !== 'current'
  return monthDisplayed(detail, month)
}
```

`averageFor`를 마스크 기반으로 바꾼다:

```ts
function averageFor(values: number[], detail: CategoryDetail) {
  const total = values.reduce((sum, value, month) => monthDisplayed(detail, month) ? sum + value : sum, 0)
  const closedTotal = values.reduce((sum, value, month) => monthClosed(detail, month) ? sum + value : sum, 0)
  const endedTotal = values.reduce((sum, value, month) => monthEnded(detail, month) ? sum + value : sum, 0)
  const provisionalDivisor = detail.provisionalDivisor ?? detail.divisor
  return {
    total,
    closedTotal,
    average: detail.divisor > 0 ? categoryDetailMonthlyAverage(closedTotal, 0, detail.divisor) : null,
    provisionalAverage: provisionalDivisor > 0 ? categoryDetailMonthlyAverage(endedTotal, 0, provisionalDivisor) : null,
  }
}
```

`categoryDetailMonthlyAverage(total, current, divisor)`의 두 번째 인자는 진행 중인 달 금액을 빼는 용도였다. 마스크가 이미 진행 중인 달을 제외하므로 `0`을 넘긴다.

`buildCategoryModel`·`buildAccountModel`의 `series.push({ …values: detail.closedMonths ? values.map(... monthEligible ...) : values })`를 `values.map((value, month) => monthDisplayed(detail, month) ? value : null)`로 바꾸고, 계좌 축의 `.map((value, month) => detail.closedMonths ? monthEligible(detail, month) ? value ?? 0 : null : value)`도 같은 규칙으로 바꾼다. 두 모델의 행 push에 `closedTotal`, `provisionalAverage`를 추가한다.

`buildStatsMonthlyModel` 반환:

```ts
  const displayMask = Array.from({ length: 12 }, (_, month) => monthDisplayed(detail, month))
  const closedMask = Array.from({ length: 12 }, (_, month) => monthClosed(detail, month))
  const endedMask = Array.from({ length: 12 }, (_, month) => monthEnded(detail, month))
  const closedTotal = monthTotals.reduce((sum, value, month) => closedMask[month] ? sum + value : sum, 0)
  const endedTotal = monthTotals.reduce((sum, value, month) => endedMask[month] ? sum + value : sum, 0)
  const provisionalDivisor = detail.provisionalDivisor ?? detail.divisor
  return {
    ...result,
    monthTotals,
    total,
    closedTotal,
    average: detail.divisor > 0 ? categoryDetailMonthlyAverage(closedTotal, 0, detail.divisor) : null,
    provisionalAverage: provisionalDivisor > 0 ? categoryDetailMonthlyAverage(endedTotal, 0, provisionalDivisor) : null,
    activeMonths: detail.states ? displayMask.lastIndexOf(true) + 1 : activeMonths,
    currentMonthIndex,
    divisor: detail.divisor,
    provisionalDivisor,
    monthStates: detail.states ?? Array.from({ length: 12 }, (_, month) => displayMask[month] ? 'open' : 'future'),
    eligibleMonths: displayMask,
    closedMonths: closedMask,
  }
```

`StatsMonthlyModel`·행 타입에 새 필드를 추가한다. `stats-monthly-section.tsx`는 `model.eligibleMonths`를 계속 "표시 가능"으로 읽으므로 이 태스크에서 컴파일이 깨지지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/stats-monthly.test.ts tests/finance/series-chart.test.ts && NODE_OPTIONS= pnpm exec tsc --noEmit`
Expected: PASS, 0 errors. 기존 `expands folded category data…`·sparkline 테스트는 `states` 없는 fixture라 옛 규칙(`months.at(-1)`)으로 그대로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add src/features/analytics/stats-monthly.ts tests/finance/stats-monthly.test.ts
git commit -m "feat(stats): separate displayed months from closed months in the monthly model"
```

---

### Task 8: 통계 화면 · 잠정 스타일, 표, 태그, 칩

**추가 실행 보정 (2026-09-09, 소비자 연결):** Task 6의 `expenseComparisons`/`merchantComparisons`를 사용해 같은 항목의 잠정 비교 값을 찾는다(순위가 달라도 유지). `src/features/analytics/home-dashboard-charts.tsx`를 명시 허용/git add 경로에 추가한다. `SavingsProgressRing`은 기본값 false인 선택 `provisional` 표시 prop으로 SVG 숫자·선에 faint 토큰을 적용한다. 홈의 기본 표현과 링 계산식은 변경하지 않으며 `tests/finance/provisional-charts.test.tsx`에서 기본/잠정 렌더링을 검증한다. 원시 CSS 선택자로 부모에서 자식 SVG 색을 덮어쓰지 않는다.

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** tests/finance/provisional-charts.test.tsx, tests/finance/stats-report-page.test.tsx를 신규 허용/git add 경로로 추가해 실패 테스트부터 작성한다. 실제 컴포넌트를 렌더하고 외부 차트 renderer/조회만 경계 mock하여 dataset·표시값 검증. 잠정 막대 테두리와 본문은 palette.faint/text-finance-faint(아래 시리즈색·muted 예시 보정). 현재달은 italic 및 '진행 중'. 잠정 합계는 provisionalTotal이며 현재달은 연 집계/예측에서 제외한다. hasAnyData는 거래 존재와 명시 0원 마감으로 판단하여 환불/상쇄/수입만 있는 현재달을 숨기지 않는다. 연 칩 잠정 목록은 기록 있는 미마감/재확인 끝난 월만 센다. YoY fallback은 비교의 양쪽 모두 provisional 값을 사용하고 카테고리/가맹점은 이름 키로 대응시킨다. 비교 fallback에도 잠정 태그/사유와 회색 본문을 표시한다. 차트 전월 대비는 바로 전 달만 사용하며 두 월 모두 closed면 확정, 아니면 잠정임을 표시한다. 필요 시 series-chart-geometry.ts와 tests/finance/series-chart.test.ts를 명시 허용/git add 경로로 사용한다. 연 누적은 '마감 N개월 X%'와 '잠정 포함 Y%'를 함께 표시한다. 열 위 상태 라벨과 12개월 정렬을 유지하며 SSR fallback/패턴/대시/빈 점/현재·미래/셀 scope/revision을 검증한다.

**Files:**
- Modify: `src/features/analytics/chart-js.ts`, `src/features/analytics/series-chart.tsx:118-172`, `src/features/analytics/annual-flow-overview.tsx:22-100,131-145`, `src/features/analytics/stats-monthly-section.tsx:71-100,157,236-250,440-540`, `src/app/report/page.tsx`
- Test: `tests/finance/series-chart.test.ts` (추가 없음 — 스타일은 E2E 스크린샷), `tests/finance/closed-report.test.ts` (그대로)

**Interfaces:**
- `chart-js.ts`: `export const PROVISIONAL_DASH = [5, 4]`, `export function provisionalPattern(palette: FinanceChartPalette): CanvasPattern | string` (캔버스 없으면 `palette.faint` 반환)
- `SeriesChartSeries`에 `states?: StatsMonthState[]`는 넣지 않는다. 대신 `SeriesChart`가 `monthStates: StatsMonthState[]` prop을 받는다(`StatsMonthlySection`이 `model.monthStates`를 넘김).
- `AnnualFlowRow`에 `state: StatsMonthState` 추가(`stats.monthly`가 이미 갖고 있음).

- [ ] **Step 1: `chart-js.ts`에 잠정 스타일 상수 추가** (파일 끝)

```ts
export const PROVISIONAL_DASH = [5, 4]

/**
 * Diagonal hatch for months that have ended but are not closed. Built on a
 * throwaway canvas so bar charts can use it as a fill; falls back to the
 * faint grey when no canvas exists (SSR, tests).
 */
export function provisionalPattern(palette: FinanceChartPalette): CanvasPattern | string {
  if (typeof document === 'undefined') return palette.faint
  const tile = document.createElement('canvas')
  tile.width = 6
  tile.height = 6
  const context = tile.getContext('2d')
  if (!context) return palette.faint
  context.fillStyle = palette.background
  context.fillRect(0, 0, 6, 6)
  context.strokeStyle = palette.faint
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(-1, 7)
  context.lineTo(7, -1)
  context.stroke()
  return context.createPattern(tile, 'repeat') ?? palette.faint
}
```

- [ ] **Step 2: `series-chart.tsx` 월별 잠정 스타일**

props에 `monthStates: StatsMonthState[]` 추가(`import type { StatsMonthState } from './category-detail'`). `data` useMemo 안에서:

```ts
    const hatch = provisionalPattern(palette)
    const provisional = (month: number) => monthStates[month] === 'open' || monthStates[month] === 'needs_review' || monthStates[month] === 'current'
```

막대 dataset의 `backgroundColor`를:

```ts
          backgroundColor: values.map((_, month) => provisional(month)
            ? hatch
            : alpha(color, dimmed ? 0.16 : 1)),
          borderColor: values.map((_, month) => provisional(month) ? alpha(color, dimmed ? 0.3 : 0.9) : palette.background),
          borderWidth: 1,
```

선·영역 dataset에 세그먼트 대시를 추가:

```ts
        segment: {
          borderDash: (context: { p0DataIndex: number; p1DataIndex: number }) => (
            provisional(context.p0DataIndex) || provisional(context.p1DataIndex) ? PROVISIONAL_DASH : undefined
          ),
        },
        pointBackgroundColor: values.map((_, month) => provisional(month) ? palette.background : color),
        pointBorderColor: values.map((_, month) => provisional(month) ? color : palette.background),
```

`useMemo` 의존성 배열에 `monthStates`를 추가한다. `values` 계산의 `month >= activeMonths` 조건은 유지(미래 월은 `null`).

- [ ] **Step 3: `annual-flow-overview.tsx`**

`AnnualFlowRow`에 `state: StatsMonthState`. 막대 dataset 세 개의 `backgroundColor`를 배열로:

```ts
      const hatch = provisionalPattern(palette)
      const fill = (solid: string) => monthly.map((row) => row.state === 'closed' ? solid : hatch)
      // …
      { label: '수입', data: monthly.map((row) => row.active ? row.income : null), backgroundColor: fill(palette.blue), borderColor: monthly.map((row) => row.state === 'closed' ? palette.blue : palette.faint), borderWidth: 1, barPercentage: 0.78, categoryPercentage: 0.76 },
```

(지출·저축도 같은 꼴). 순저축률 선에 `segment.borderDash`와 빈 원 점을 위와 같은 규칙으로 넣는다. 범례에 두 항목 추가:

```tsx
          <span><i className="mr-1.5 inline-block h-[9px] w-[9px] border border-finance-faint bg-[repeating-linear-gradient(135deg,var(--finance-faint)_0_1px,transparent_1px_3px)]" />미마감 · 잠정</span>
```

x축 라벨 위 `잠정`/`진행 중` 표기는 Chart.js 플러그인 대신 `labels`로 처리한다: `labels = monthly.map((row, i) => row.state === 'closed' || row.state === 'future' ? \`${i + 1}월\` : row.state === 'current' ? \`${i + 1}월·진행\` : \`${i + 1}월·잠정\`)`.

`AnnualFlowOverview`가 `annualRate`(마감 기준)와 함께 `provisionalRate`를 받아 하단 우측에 `<span class="text-finance-faint">잠정 포함 33.9%</span>`를 덧붙인다. 호출 측(`report/page.tsx`)은 `stats.report.provisional.annual.savingsRate`를 넘긴다.

- [ ] **Step 4: `stats-monthly-section.tsx` 표**

(a) `closedOnly` 변수(line 157)와 그 사용처를 없앤다. 대신:

```ts
  const isProvisional = (month: number) => model.eligibleMonths[month] && !model.closedMonths[month]
```

(b) 헤더 셀(line 443-444):

```tsx
                  <div className={`text-right ${month === highlightedMonth ? 'font-bold text-finance-ink' : month === model.currentMonthIndex ? 'text-finance-blue' : !model.eligibleMonths[month] ? 'text-finance-faint' : isProvisional(month) ? 'text-finance-amber' : ''}`} key={month}>
                    {month + 1}월{month === model.currentMonthIndex ? '·진행' : isProvisional(month) ? '·잠정' : ''}
                  </div>
```

합계·월평균 헤더:

```tsx
                <div className="text-right">합계{model.divisor > 0 ? <span className="block font-normal text-finance-faint">마감 {model.divisor}개월</span> : <span className="block font-normal text-finance-faint">잠정</span>}</div>
                <div className="text-right">월평균{model.divisor > 0 ? <span className="block font-normal text-finance-faint">마감 {model.divisor}개월</span> : <span className="block font-normal text-finance-faint">잠정</span>}</div>
```

(c) 대분류 행 셀(line 471-485): `disabled={rawValue === null}` 유지, 클래스에 잠정 회색 추가:

```tsx
                            className={`min-w-0 px-0.5 py-1 text-right tabular-nums ${isExcluded ? 'text-finance-faint line-through' : rawValue === null ? 'cursor-default text-finance-faint' : isProvisional(month) ? 'text-finance-muted hover:bg-finance-blue-tint' : 'text-finance-ink hover:bg-finance-blue-tint'}`}
```

`aria-label`의 `미마감` 분기는 `rawValue === null`(미래 월)에만 남으므로 문구를 `${row.label} ${month + 1}월 예정`으로 바꾼다. 셀 텍스트 `rawValue === 0 ? closedOnly ? '0' : '–'` → `rawValue === 0 ? (model.closedMonths[month] ? '0' : '–')`.

합계·평균 셀:

```tsx
                      <div className="text-right font-bold tabular-nums text-finance-ink">{formatWon(model.divisor > 0 ? row.closedTotal : row.total)}</div>
                      <div className={`text-right tabular-nums ${row.average === null ? 'text-finance-faint' : 'text-finance-muted'}`}>{row.average !== null ? formatWon(row.average) : row.provisionalAverage !== null ? formatWon(row.provisionalAverage) : '—'}</div>
```

소분류 행(line 505-530)도 같은 규칙: `available = model.eligibleMonths[month]`, 잠정이면 `text-finance-muted`, `title`의 `'미마감 월은 통계에서 제외됩니다'` → `'아직 오지 않은 달입니다'`, 합계·평균 셀은 위와 같이.

(d) 미니 추이(`Sparkline`): `closedOnly` prop을 `preserveRecordedMonths={true}`로 고정하고, `values`는 `row.values.map((value, month) => model.eligibleMonths[month] ? value : null)` 그대로(끝난 월 전부 표시).

(e) 셀 거래 조회(line 236-250): 마감 월만 `scope=closed`:

```ts
      const params = new URLSearchParams({ flow, year: String(year), month: String(month), major, sub })
      if (model.closedMonths[month - 1]) {
        params.set('scope', 'closed')
        params.set('revision', String(details[flow].monthRevisions?.[month]))
      } else {
        params.set('scope', 'live')
      }
```

`cellCacheKey`도 `model.closedMonths[month - 1] ? \`closed:${revision}\` : 'live'`로.

(f) `SeriesChart`에 `monthStates={model.monthStates}` 전달. 차트 hover 가드 `if (month !== null && !model.eligibleMonths[month])`는 표시 마스크라 그대로 맞다.

- [ ] **Step 5: `report/page.tsx`**

(a) import: `YearStatusLabel`, `MONTH_STATE_LABELS`는 유지.

(b) 변수:

```ts
  const official = stats.report.official
  const provisional = stats.report.provisional
  const hasClosed = stats.closedMonths.length > 0
  const hasAnyData = stats.endedMonths.some((month) => stats.monthly[month - 1].income + stats.monthly[month - 1].expense + stats.monthly[month - 1].saving > 0)
    || (stats.monthStates.indexOf('current') >= 0 && stats.monthly[stats.monthStates.indexOf('current')].expense > 0)
  const provisionalMonths = stats.endedMonths.filter((month) => !stats.closedMonths.includes(month))
  const data = hasClosed ? official : provisional
  const dataIsProvisional = !hasClosed
```

(c) 헤더의 `<p className="mt-2 t-caption text-finance-muted">{data.year}년 · 마감 …</p>`를 삭제하고 h1을:

```tsx
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              연간 통계
              <YearStatusLabel closedMonths={stats.closedMonths} provisionalMonths={provisionalMonths} year={data.year} />
            </h1>
```

(d) 스트립 링크 클래스를 상태별로:

```tsx
            <Link className={`border px-2 py-2 text-center t-caption ${row.state === 'closed' ? 'border-finance-green text-finance-green' : stats.monthStates[index] === 'current' ? 'border-finance-ink text-finance-ink' : stats.monthStates[index] === 'future' ? 'border-finance-hairline text-finance-faint' : row.state === 'needs_review' ? 'border-dashed border-finance-red text-finance-red' : 'border-dashed border-finance-amber text-finance-amber'}`} …>
```

(e) `!hasAnnualData ? (마감한 월이 없습니다 …)` 분기를 `!hasAnyData ? (이 연도에는 거래가 없습니다 …)`로 바꾸고, 그 안의 문구를 `내역에서 거래를 기록하면 통계에 나타납니다.`로, 버튼은 `← {previousYear}년 보기`만 남긴다.

(f) 태그 컴포넌트를 파일 상단에 추가:

```tsx
function StatusTag({ provisional, reason }: { provisional: boolean; reason?: string }) {
  return provisional
    ? <span className="ml-1.5 inline-block border border-finance-faint px-1 align-[1px] t-label text-finance-faint">잠정{reason ? ` · ${reason}` : ''}</span>
    : <span className="ml-1.5 inline-block border border-finance-green px-1 align-[1px] t-label text-finance-green">확정</span>
}
```

(g) KPI 네 칸: 값은 `data`에서, 태그는 `<StatusTag provisional={dataIsProvisional} reason={dataIsProvisional ? '마감 0개월' : undefined} />`. 전년 대비 캡션은 확정 가능(`data.hasPrevious`)이면 검은 글씨, 아니면 `provisional.hasPrevious`일 때 `provisional.yoy`를 `text-finance-faint`로 보이고 `<StatusTag provisional reason={`${data.previousYear}년 미마감`} />`, 둘 다 없으면 `–`. 순저축률 링 카드의 `달성 {stats.targetHitMonths}/{completedMonths}개월`은 `hasClosed ? … : \`달성 ${stats.provisionalTargetHitMonths}/${stats.endedMonths.length}개월 (잠정)\``.

(h) 어디에 썼나·가맹점 TOP·전년 비교·6개월 예측 블록: `data`를 쓰되 각 블록 제목 옆에 `<StatusTag provisional={dataIsProvisional} />`. 전년 비교 표의 `data.hasPrevious ? … : '–'` 분기에 `provisional.hasPrevious` 폴백을 `text-finance-faint`로 추가. 예측은 `data.cashflow.forecast.length === 0 && provisional.cashflow.forecast.length > 0`이면 잠정 예측을 회색으로.

(i) `AnnualFlowOverview`에 `provisionalRate={provisional.annual.savingsRate}` 전달, `monthly={stats.monthly}` (state 포함).

- [ ] **Step 6: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm build`
Expected: 모두 통과. `git grep -n "마감한 월이 없습니다" -- src` 결과 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/features/analytics/chart-js.ts src/features/analytics/series-chart.tsx src/features/analytics/annual-flow-overview.tsx src/features/analytics/stats-monthly-section.tsx src/app/report/page.tsx
git commit -m "feat(stats): show unclosed months as provisional instead of hiding them"
```

---

### Task 9: E2E 갱신과 최종 검증

**실행 보정 (2026-09-09, 스펙/현재 코드 우선):** inline 수정 직후 8월 상태는 미마감이 아니라 재확인 필요다. 첫 진입 미마감과 변경 후 재확인을 각각 확인한다. 잠정 월수는 기록 있는 월 목록을 사용한다. 미분류 seed 1건을 그대로 두고 링크 실제 이동·홈 3개 섹션 제거·태그/빗금 범례를 검증한다. refresh 후 3월 250원은 hover도 가능하므로 남은 '팝업 없음' 기대까지 수정한다. 한쪽이 잠정인 전월 대비는 잠정으로 검증한다. 시계는 서버/브라우저 구분해 실행 시점 의존을 피한다. 최종에는 필터 없는 pnpm e2e 전체를 실행하고 closed-statistics.png 및 sparse-closed-months.png를 실제 이미지로 확인한다.

**Files:**
- Modify: `tests/e2e/month-close.spec.ts:60-105,107-160`
- Test: `pnpm e2e`

- [ ] **Step 1: 빈 화면 확인을 잠정 확인으로** — 첫 suite의 line 99를 교체

```ts
  await page.goto('/report?year=2026')
  await expect(page.getByRole('heading', { name: '마감한 월이 없습니다', exact: true })).toHaveCount(0)
  await expect(page.getByText('마감 0개월 · 잠정 1개월 (8월)')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '통계 월 마감 현황' }).getByRole('link', { name: '8월 미마감', exact: true })).toBeVisible()
  await expect(page.getByText('잠정 · 마감 0개월').first()).toBeVisible()
```

마감 뒤(line 103) 확인에 추가:

```ts
  await expect(page.getByText('마감 1개월 · 잠정 0개월')).toBeVisible()
  await expect(page.getByText('확정').first()).toBeVisible()
```

- [ ] **Step 2: 체크리스트와 홈 할 일 흐름** — 첫 suite 앞부분(`await seed(household)` 직후)에 추가

```ts
  await page.goto('/dashboard')
  const closeTodo = page.getByRole('link', { name: /8월 마무리하기/ })
  await expect(closeTodo).toBeVisible()
  await expect(closeTodo).toContainText('정리 완료 · 마감 전')
  await closeTodo.click()
  await expect(page).toHaveURL(/\/ledger\?month=2026-08/)
  await expect(page.getByRole('region', { name: '8월 마무리' })).toContainText('정리 완료 · 아래에서 마감')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2026년 8월 · 미마감 · 잠정')
```

그리고 마감이 끝난 뒤 (`await expect(draft).toHaveValue(…)` 다음):

```ts
  await expect(page.getByRole('region', { name: '8월 마무리' })).toHaveCount(0)
  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: /8월 마무리하기/ })).toHaveCount(0)
```

seed의 8월 거래 세 건은 카테고리가 있고(수입은 category null이지만 `unclassifiedCount`는 `categories.id is null` 기준이라 1건으로 잡힌다). 그러면 `정리 완료`가 아니라 `미분류 1건`이 된다. seed를 바꾸지 말고 기대값을 `미분류 1건 · 마감 전`으로 쓴다. 홈에서도 `미분류 1건 · 마감 전`.

- [ ] **Step 3: 희소 마감 suite** — line 113-114를 교체

```ts
  await expect(section.getByRole('button', { name: '식비 2월 999원, 합계에서 제외', exact: true })).toBeEnabled()
  await expect(section.getByRole('button', { name: '식비 4월 0원, 합계에서 제외', exact: true })).toHaveText('0')
```

2월 셀 호버 요청이 `scope=live`인지 확인을 추가:

```ts
  const liveResponse = page.waitForResponse(response => response.url().includes('/api/cell-tx?') && response.url().includes('scope=live'))
  await section.getByRole('button', { name: '식비 카페 2월 999원, 합계에서 제외', exact: true }).hover()
  await liveResponse
```

차트 hover 루프(`for (const kind of …) … expect(popup).not.toBeVisible()`)는 2월이 이제 표시 대상이라 팝업이 **보이는** 게 맞다 → `await expect(popup).toContainText('999')`로 바꾼다. 마지막 블록의 `'식비 3월 미마감'` 확인은 3월이 재확인 필요 상태로도 값이 보이므로 `'식비 3월 250원, 합계에서 제외'`가 `toBeEnabled()`인지로 바꾼다.

- [ ] **Step 4: 실행**

Run (Docker + 로컬 Supabase 필요): `NODE_OPTIONS= pnpm test:db && NODE_OPTIONS= pnpm e2e tests/e2e/month-close.spec.ts tests/e2e/auth.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS. 스크린샷 `closed-statistics.png`, `sparse-closed-months.png`에서 빗금 막대·점선 구간·회색 잠정 열 확인.

- [ ] **Step 5: 최종 검사**

Run: `NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm build`
Expected: 모두 통과.

- [ ] **Step 6: 커밋**

```bash
git add tests/e2e/month-close.spec.ts
git commit -m "test(e2e): cover provisional statistics, the wrap-up checklist and the home close todo"
```

---

## Self-Review

**Spec coverage**
- §3.1 체크리스트(쌓기, 접힘, 선택 항목, 문구 수정) → Task 1, 3. 초록 `월 마감` 버튼 색 변경은 `MonthCloseControl`의 `summary`가 dialog 안에서만 로드되므로 페이지 레벨 `monthClose.requiresAcknowledgment === false`를 prop으로 넘겨 버튼 클래스를 바꾼다 — Task 3 Step 4(f)에 `MonthCloseControl`에 `allClear?: boolean` prop 추가: `className={allClear ? 'border-finance-green bg-finance-green text-white …' : …}`.
- §3.2 홈 `close` 할 일, KPI 두 칸, 세 섹션 제거, 헤더 칩 → Task 4.
- §3.3 통계 표시 규칙·확정/잠정 정의 → Task 6(모델), 7(표 모델), 8(화면). 스트립 클릭 목적지는 이미 `/ledger?month=`라 변경 없음.
- §3.4 칩 변형·`title`·삭제 문장 → Task 2, 3, 4, 5, 8.
- §4 읽기 모델 → Task 6, 7. `/api/cell-tx` 무변경, 화면이 `scope=live` 선택 → Task 8 Step 4(e).
- §8 검증 → 각 태스크 테스트 + Task 9.

**Placeholder scan** — "TBD/TODO/적절히" 없음. 코드 블록이 없는 수정 지시는 대상 줄 번호와 old→new를 적었다.

**Type consistency**
- `StatsMonthState`는 `category-detail.ts`에서 export, `stats-report.ts`·`stats-monthly.ts`·`series-chart.tsx`·`annual-flow-overview.tsx`가 import.
- `getStatsReportData` 반환의 `closedMonths`/`endedMonths`/`monthStates`/`report.official|provisional`을 Task 6·8·9(테스트)가 같은 이름으로 쓴다.
- `wrapUpSteps(summary)` 단일 인자 — Task 1 시그니처와 Task 3 사용 일치. 스펙의 `(summary, month, currentMonthKey)`는 `summary.closable`이 이미 "끝난 월"을 담고 있어 축소했다.
- `MonthStatusLabel` props: `status`, `variant`, `currentMonthKey`, `elapsed` — Task 2 정의와 Task 3·4·5 사용 일치.
- `buildHomeTodos` 입력 `closeTargets: CloseTarget[]` — Task 4 테스트·구현 일치.

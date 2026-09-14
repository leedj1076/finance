# 예산 편집기 추이 열 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예산 편집기의 참고 열 오른쪽에 최근 3개월 실제 지출을 보여주는 추이 열을 붙이고, 칸에 호버하거나 누르면 그 달 그 대분류의 거래 목록이 뜨게 한다.

**Architecture:** 서버 질의를 새로 만들지 않는다. `readBudgetPlanRows`가 3개월 평균을 내려고 이미 조회하는 대분류×월 합계와 월 마감 상태를 `trend` 필드로 읽기 모델에 실어 보낸다. 거래 목록은 통계가 쓰는 `/api/cell-tx`를 재사용하되 중분류(`sub`)를 선택 항목으로 풀어 대분류 단위 조회를 허용한다. 통계에 인라인으로 박혀 있는 팝오버는 훅과 본문 컴포넌트로 빼서 두 화면이 같은 것을 쓴다.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM, Supabase(Postgres), Vitest 4, Playwright, 소자 CSS는 `src/app/globals.css`의 BEM 계열 클래스와 `t-*` 타입 클래스.

**Spec:** `docs/superpowers/specs/2026-09-14-budget-trend-column-design.md`

## Global Constraints

스펙 §7에서 그대로 가져온다. 모든 작업에 적용된다.

- DB 스키마, 마이그레이션, 저장 계약(`BudgetSaveRequest`), 저장 서비스(`save-service.ts`), AI 스냅샷(`budget-recommendations/snapshot.ts`), 워커(`budget-recommendations/worker.ts`)를 바꾸지 않는다.
- 모든 Drizzle 조회는 `householdId` 범위다. 마감 월 확정 값 보호(`StaleClosedMonthError`, `scope=closed` + revision 확인)와 409 처리를 약화하지 않는다.
- 추이는 읽기 전용이다. 예산 초안 금액, 선택된 참고 줄(`draft.source`), `draft.recommendationJobId`를 절대 바꾸지 않는다.
- 색·타입·간격은 `src/app/globals.css` 토큰(`--finance-ink`, `--finance-muted`, `--finance-faint`, `--finance-border`, `--finance-track`, `--finance-panel`)과 `t-*` 클래스만 쓴다. 원시 `text-[Npx]`, 임의 hex, 둥근 모서리, 이모지 아이콘 금지. 아이콘은 인라인 SVG.
- 거래 적요는 신뢰할 수 없는 데이터다. HTML 실행 없이 글자로만 그린다.
- 로그에 거래 본문을 남기지 않는다.
- `NODE_OPTIONS=` 접두어로 node/pnpm을 실행한다(이 Mac의 preload 설정 때문).
- 커밋은 작업 단위마다, 명시한 경로만 `git add`. `git add -A` 금지.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `eslint.config.mjs` | 중첩 워크트리를 lint 대상에서 뺀다 | 1 |
| `src/features/budgets/plan-calculations.ts` | `buildTrend` 순수 계산 | 2 |
| `src/features/budgets/plan-sources.ts` | `BudgetPlanRow.trend` | 2 |
| `src/features/analytics/category-detail.ts` | `sub` 선택 처리 | 3 |
| `src/features/analytics/cell-transactions.ts` (새) | 요청·캐시·취소·지연·409 훅 | 4 |
| `src/features/analytics/cell-transaction-tooltip.tsx` (새) | 팝오버 본문 | 4 |
| `src/features/analytics/stats-monthly-section.tsx` | 위 둘을 쓰도록 이관 | 4 |
| `src/features/budgets/plan-trend.tsx` (새) | 추이 칸과 팝오버 | 5 |
| `src/features/budgets/plan-item.tsx` | 추이를 붙인다 | 5 |
| `src/features/budgets/plan-list.tsx` | 열 머리 | 5 |
| `src/app/globals.css` | 추이 열 그리드와 칸 스타일 | 5 |
| `tests/e2e/budget-editor.spec.ts` | 호버·클릭·키보드·모바일 회귀 | 6 |
| `docs/design/budget-editor/result/verification.md` | 검증 기록 | 7 |

---

### Task 1: lint 게이트 되살리기

`pnpm lint`는 지금 `.worktrees/`의 중첩 git 워크트리를 훑어 약 5,957개 오류를 낸다. `.gitignore` 47번 줄에 `/.worktrees/`가 있지만 ESLint flat config는 `.gitignore`를 읽지 않는다. 이 계획의 모든 작업이 `pnpm lint`를 게이트로 쓰므로 먼저 고친다. 이 작업 전에는 `eslint src tests`로 좁혀 돌려야 했다.

**Files:**
- Modify: `eslint.config.mjs:15-21`

**Interfaces:**
- Consumes: 없음
- Produces: 이후 모든 작업이 `NODE_OPTIONS= pnpm lint`를 그대로 게이트로 쓴다

- [ ] **Step 1: 현재 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm lint 2>&1 | tail -3`

Expected: `✖ ... problems (... errors, ... warnings)`로 끝나고 종료 코드가 1이다. 오류 경로가 전부 `.worktrees/`로 시작한다. 확인:

```sh
NODE_OPTIONS= pnpm lint 2>&1 | grep -E "^/" | grep -cv "/.worktrees/"
```

Expected: `0` (워크트리 밖 오류 없음)

- [ ] **Step 2: ignores에 워크트리를 더한다**

`eslint.config.mjs`의 `ignores` 배열을 아래로 바꾼다.

```js
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      ".worktrees/**",
      "next-env.d.ts",
    ],
```

- [ ] **Step 3: 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm lint && echo "lint ok"`

Expected: `lint ok`. 종료 코드 0.

- [ ] **Step 4: 커밋**

```bash
git add eslint.config.mjs
git commit -m "chore: keep nested worktrees out of lint"
```

---

### Task 2: `buildTrend`와 읽기 모델의 `trend`

**Files:**
- Modify: `src/features/budgets/plan-calculations.ts` (`Average3Input` 아래에 `buildTrend` 추가)
- Modify: `src/features/budgets/plan-sources.ts:13-30` (`BudgetPlanRow`에 `trend`), `:86-118` (반환값)
- Test: `tests/finance/budget-plan-calculations.test.ts`, `tests/integration/budget-plan-sources.test.ts`

**Interfaces:**
- Consumes: 기존 `calculateAverage3(input: Average3Input)`, `readBudgetPlanRows`가 이미 가진 `monthlyRows`(대분류×월 합계), `monthStatuses`(`readMonthStatuses` 결과), `candidateMonths`, `transactionMonths`
- Produces:
  - `export type BudgetTrendMonth = { month: string; amount: number; closed: boolean; revision: number }`
  - `export function buildTrend(input: TrendInput): BudgetTrendMonth[]`
  - `BudgetPlanRow.trend: BudgetTrendMonth[]` — `average3.months`와 같은 달, **오래된 달부터**
  - `TrendInput = Average3Input & { monthRevisions: { month: string; revision: number }[] }`

- [ ] **Step 1: 실패하는 단위 테스트를 쓴다**

`tests/finance/budget-plan-calculations.test.ts` 맨 위 import에 `buildTrend`를 더한다.

```ts
import { buildTrend, calculateAverage3, differenceCaption, initialSource } from '@/features/budgets/plan-calculations'
```

파일 끝에 아래를 붙인다.

```ts
describe('buildTrend', () => {
  const input = {
    candidateMonths: ['2026-08', '2026-07', '2026-06'],
    transactionMonths: ['2026-08', '2026-07', '2026-06'],
    majorMonthlyAmounts: [
      { month: '2026-08', amount: 1_257_831 },
      { month: '2026-07', amount: 1_253_700 },
      { month: '2026-06', amount: 1_298_653 },
    ],
    monthStatuses: [
      { month: '2026-08', state: 'open' as const },
      { month: '2026-07', state: 'closed' as const },
      { month: '2026-06', state: 'closed' as const },
    ],
    monthRevisions: [
      { month: '2026-08', revision: 4 },
      { month: '2026-07', revision: 2 },
      { month: '2026-06', revision: 7 },
    ],
  }

  test('returns the average months oldest first with closed state and revision', () => {
    expect(buildTrend(input)).toEqual([
      { month: '2026-06', amount: 1_298_653, closed: true, revision: 7 },
      { month: '2026-07', amount: 1_253_700, closed: true, revision: 2 },
      { month: '2026-08', amount: 1_257_831, closed: false, revision: 4 },
    ])
  })

  test('matches calculateAverage3 months exactly when a month has no household records', () => {
    const narrowed = { ...input, transactionMonths: ['2026-08', '2026-06'] }
    expect(buildTrend(narrowed).map(month => month.month))
      .toEqual([...calculateAverage3(narrowed).months].sort())
  })

  test('keeps a month the major did not spend in as zero', () => {
    const missing = { ...input, majorMonthlyAmounts: [{ month: '2026-06', amount: 1_298_653 }] }
    expect(buildTrend(missing).map(month => month.amount)).toEqual([1_298_653, 0, 0])
  })

  test('returns an empty list when no candidate month has records', () => {
    expect(buildTrend({ ...input, transactionMonths: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/budget-plan-calculations.test.ts`

Expected: FAIL. `buildTrend`가 없어 import 오류 또는 `buildTrend is not a function`.

- [ ] **Step 3: `buildTrend`를 구현한다**

`src/features/budgets/plan-calculations.ts`에서 `Average3Input` 타입 아래, `calculateAverage3` 위에 넣는다.

```ts
export type TrendInput = Average3Input & {
  monthRevisions: { month: string; revision: number }[]
}

/** The trend columns are the breakdown of the 3-month average, so they share its months exactly. */
export function buildTrend(input: TrendInput): BudgetPlanRow['trend'] {
  const transactionMonths = new Set(input.transactionMonths)
  const months = input.candidateMonths.filter(month => transactionMonths.has(month))
  const amountByMonth = new Map<string, number>()
  for (const row of input.majorMonthlyAmounts) {
    if (!months.includes(row.month)) continue
    amountByMonth.set(row.month, (amountByMonth.get(row.month) ?? 0) + row.amount)
  }
  const stateByMonth = new Map(input.monthStatuses.map(status => [status.month, status.state]))
  const revisionByMonth = new Map(input.monthRevisions.map(row => [row.month, row.revision]))

  return [...months].sort().map(month => ({
    month,
    amount: amountByMonth.get(month) ?? 0,
    closed: stateByMonth.get(month) === 'closed',
    revision: revisionByMonth.get(month) ?? 0,
  }))
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/budget-plan-calculations.test.ts`

Expected: PASS. `buildTrend` 4건 포함.

- [ ] **Step 5: 읽기 모델에 `trend`를 더한다**

`src/features/budgets/plan-sources.ts`의 `BudgetPlanRow` 타입에서 `average3` 블록 **뒤에** 넣는다.

```ts
  trend: {
    month: string
    amount: number
    closed: boolean
    revision: number
  }[]
```

같은 파일 위쪽 import에 `buildTrend`를 더한다.

```ts
import { buildTrend, calculateAverage3 } from './plan-calculations'
```

`readBudgetPlanRows`의 `return input.budgetRows.map(...)` 안에서 `average3: calculateAverage3({...})` 뒤에 `trend`를 더한다. `majorMonthlyAmounts`를 두 번 만들지 않도록 `map` 콜백 맨 위에서 한 번만 뽑는다.

```ts
  return input.budgetRows.map(row => {
    const saved = baselineByMajor.get(row.major)
    if (!saved) throw new Error(`Missing budget baseline for ${row.major}`)
    if (row.group !== 'fixed' && row.group !== 'variable' && row.group !== 'irregular') {
      throw new Error(`Invalid budget group for ${row.major}`)
    }
    const majorMonthlyAmounts = monthlyRows
      .filter(month => month.major === row.major)
      .map(month => ({ month: month.month, amount: Number(month.amount) }))
    const shared = { candidateMonths, transactionMonths, majorMonthlyAmounts, monthStatuses }
    return {
      major: row.major,
      group: row.group,
      saved: {
        amount: saved.amount,
        recommendationJobId: saved.recommendationJobId,
        version: saved.version,
      },
      actual: row.actual,
      previousBudget: row.previousBudget,
      previousActual: {
        amount: previousActualByMajor.get(row.major) ?? 0,
        month: previousMonth,
        partial,
      },
      average3: calculateAverage3(shared),
      trend: buildTrend({
        ...shared,
        monthRevisions: monthStatuses.map(status => ({ month: status.month, revision: status.revision })),
      }),
    }
  })
```

- [ ] **Step 6: 실패하는 통합 테스트를 쓴다**

`tests/integration/budget-plan-sources.test.ts` 끝에 붙인다. 기존 시드(2026-09-11 기준, 대상 월 2026-10, 후보 달 2026-09·08·07)를 그대로 쓴다.

```ts
test('trend carries the average months oldest first with their close state', async () => {
  const data = await getBudgetPlanningData(own, '2026-10')
  const food = data.planRows.find(row => row.major === '식비')
  expect(food).toBeDefined()
  expect(food!.trend.map(month => month.month)).toEqual([...food!.average3.months].sort())
  expect(food!.trend.map(month => month.month)).toEqual([...food!.trend.map(month => month.month)].sort())
  for (const month of food!.trend) {
    expect(Number.isSafeInteger(month.amount)).toBe(true)
    expect(Number.isSafeInteger(month.revision)).toBe(true)
  }
})

test('trend never leaks another household', async () => {
  const data = await getBudgetPlanningData(own, '2026-10')
  const total = data.planRows.flatMap(row => row.trend).reduce((sum, month) => sum + month.amount, 0)
  expect(total).toBeLessThan(9_999_999)
})
```

`getBudgetPlanningData`는 `planRows`를 그대로 돌려준다(`src/features/budgets/planning-queries.ts:18-21`). 다른 이름을 찾을 필요가 없다.

- [ ] **Step 7: 통합 테스트를 돌린다**

Run: `NODE_OPTIONS= pnpm test:db tests/integration/budget-plan-sources.test.ts`

Expected: PASS. 로컬 Supabase가 필요하다. `NODE_OPTIONS= supabase status`가 실패하면 Docker Desktop을 켜고 다시 시도한다.

- [ ] **Step 8: 전체 게이트**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

Expected: 셋 다 exit 0.

- [ ] **Step 9: 커밋**

```bash
git add src/features/budgets/plan-calculations.ts src/features/budgets/plan-sources.ts tests/finance/budget-plan-calculations.test.ts tests/integration/budget-plan-sources.test.ts
git commit -m "feat(budgets): carry monthly trend in the plan read model"
```

---

### Task 3: `/api/cell-tx`의 중분류를 선택 항목으로

**Files:**
- Modify: `src/features/analytics/category-detail.ts:60-68` (`CellTransactionParams`), `:70-80` (`CellTransactionResult`), `:218-250` (`parseCellTransactionParams`), `:272-320` (`readCellTransactions`)
- Test: `tests/finance/closed-report.test.ts`, `tests/integration/category-detail.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `CellTransactionParams.sub: string | null`
  - `CellTransactionResult.sub: string | null`
  - `GET /api/cell-tx?flow=expense&year=2026&month=6&major=식비` (sub 없이) → 그 대분류의 모든 중분류 거래 합계

- [ ] **Step 1: 실패하는 파서 테스트를 쓴다**

`tests/finance/closed-report.test.ts`에서 `parseCellTransactionParams`를 쓰는 describe 블록을 찾아(`grep -n "parseCellTransactionParams" tests/finance/closed-report.test.ts`) 그 안에 붙인다.

```ts
test('accepts a major-only query and reports the missing sub as null', () => {
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', major: '식비',
  }))).toEqual({ flow: 'expense', year: 2026, month: 6, major: '식비', sub: null })
})

test('treats a blank sub as absent', () => {
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', major: '식비', sub: '   ',
  }))?.sub).toBeNull()
})

test('still rejects a missing major', () => {
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', sub: '장보기',
  }))).toBeNull()
})

test('still rejects an over-long sub', () => {
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', major: '식비', sub: 'x'.repeat(101),
  }))).toBeNull()
})

test('keeps the closed scope contract on a major-only query', () => {
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', major: '식비', scope: 'closed', revision: '3',
  }))).toEqual({ flow: 'expense', year: 2026, month: 6, major: '식비', sub: null, scope: 'closed', revision: 3 })
  expect(parseCellTransactionParams(new URLSearchParams({
    flow: 'expense', year: '2026', month: '6', major: '식비', scope: 'closed',
  }))).toBeNull()
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/closed-report.test.ts`

Expected: FAIL. 첫 테스트가 `null`을 받는다(지금은 `sub.length === 0`이면 거부).

- [ ] **Step 3: 타입과 파서를 고친다**

`CellTransactionParams`의 `sub`를 바꾼다.

```ts
export type CellTransactionParams = {
  flow: CategoryDetailFlow
  year: number
  month: number
  major: string
  /** Null asks for every sub under the major. The budget editor plans at major level. */
  sub: string | null
  scope?: 'live' | 'closed'
  revision?: number
}
```

`CellTransactionResult`의 `sub`도 `string | null`로 바꾼다.

`parseCellTransactionParams`에서 `sub` 처리를 바꾼다. `const sub = ...` 줄을 아래로 교체한다.

```ts
  const rawSub = searchParams.get('sub')?.trim() ?? ''
  const sub = rawSub.length === 0 ? null : rawSub
```

이어지는 거부 조건에서 `|| sub.length === 0`를 지우고 `|| sub.length > 100`을 `|| (sub !== null && sub.length > 100)`으로 바꾼다. `major`의 두 조건(`major.length === 0`, `major.length > 100`)은 그대로 둔다.

- [ ] **Step 4: 파서 테스트 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/closed-report.test.ts`

Expected: PASS.

- [ ] **Step 5: 실패하는 통합 테스트를 쓴다**

`tests/integration/category-detail.test.ts` 끝에 붙인다. 같은 파일 위쪽의 시드 상수(가구 id 변수, 카테고리 이름)를 그대로 쓴다. 구현자는 먼저 `sed -n '1,60p' tests/integration/category-detail.test.ts`로 시드 모양을 확인하고 변수명을 맞춘다.

```ts
test('a major-only query sums every sub under that major', async () => {
  const withSub = await getCellTransactions(own, {
    flow: 'expense', year: 2026, month: 6, major: '식비', sub: '장보기',
  })
  const majorOnly = await getCellTransactions(own, {
    flow: 'expense', year: 2026, month: 6, major: '식비', sub: null,
  })
  expect(majorOnly.sub).toBeNull()
  expect(majorOnly.items.length).toBeGreaterThanOrEqual(withSub.items.length)
  expect(majorOnly.total).toBeGreaterThanOrEqual(withSub.total)
  expect(majorOnly.items).toEqual([...majorOnly.items].sort((left, right) => right.amount - left.amount))
})

test('a major-only query stays inside the household', async () => {
  const mine = await getCellTransactions(own, {
    flow: 'expense', year: 2026, month: 6, major: '식비', sub: null,
  })
  const theirs = await getCellTransactions(foreign, {
    flow: 'expense', year: 2026, month: 6, major: '식비', sub: null,
  })
  expect(mine.items).not.toEqual(theirs.items)
  expect(mine.items.some(item => theirs.items.some(other => other.name === item.name && other.amount === item.amount))).toBe(false)
})
```

- [ ] **Step 6: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm test:db tests/integration/category-detail.test.ts`

Expected: FAIL. `sub: null`이 `eq(categories.sub, null)`로 내려가 0건이 나온다.

- [ ] **Step 7: 조회를 고친다**

`readCellTransactions`의 `.where(and(...))` 안에서 `eq(categories.sub, params.sub)` 줄을 조건부로 바꾼다.

```ts
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.flow, params.flow),
        eq(categories.major, params.major),
        ...(params.sub === null ? [] : [eq(categories.sub, params.sub)]),
        gte(transactions.date, start),
        lt(transactions.date, end),
      ),
    )
```

같은 함수의 반환에서 `sub: params.sub`는 그대로 둔다(이제 `string | null`이다).

- [ ] **Step 8: 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm test:db tests/integration/category-detail.test.ts`

Expected: PASS.

- [ ] **Step 9: 통계가 그대로인지 확인한다**

`sub`가 `string | null`이 되면 `stats-monthly-section.tsx`의 `cellTooltip.sub` 렌더가 타입 오류를 낼 수 있다. 통계는 항상 `sub`를 보내므로 동작은 같다. 타입만 맞춘다.

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

Expected: 셋 다 exit 0. 오류가 나면 `stats-monthly-section.tsx`에서 `{cellTooltip.sub}`를 쓰는 자리를 `{cellTooltip.sub ? `${cellTooltip.major} › ${cellTooltip.sub}` : cellTooltip.major}` 꼴로 좁힌다. Task 4에서 이 markup은 어차피 공용 컴포넌트로 옮긴다.

- [ ] **Step 10: 커밋**

```bash
git add src/features/analytics/category-detail.ts src/features/analytics/stats-monthly-section.tsx tests/finance/closed-report.test.ts tests/integration/category-detail.test.ts
git commit -m "feat(analytics): allow major-level cell transaction queries"
```

---

### Task 4: 팝오버를 공용으로 빼고 통계를 이관한다

지금 요청 로직(`requestCellTransactions`)과 팝오버 markup이 `stats-monthly-section.tsx` 한 파일(700줄 이상)에 박혀 있다. 예산 편집기가 같은 것을 쓰려면 빼야 한다.

**Files:**
- Create: `src/features/analytics/cell-transactions.ts`
- Create: `src/features/analytics/cell-transaction-tooltip.tsx`
- Modify: `src/features/analytics/stats-monthly-section.tsx`
- Test: `tests/finance/cell-transactions.test.ts` (새)

**Interfaces:**
- Consumes: Task 3의 `CellTransactionParams.sub: string | null`, `CellTransactionResult`
- Produces:
  - `export function cellCacheKey(major: string, sub: string | null, month: number): string`
  - `export type CellRequest = { major: string; sub: string | null; month: number; flow: CategoryDetailFlow; year: number; closed: boolean; revision: number }`
  - `export function useCellTransactions(): { data: CellTransactionResult | null; key: string | null; stale: boolean; open(request: CellRequest, delay: number): void; close(): void; reset(): void }`
  - `export function CellTransactionTooltip(props: { major: string; sub: string | null; month: number; data: CellTransactionResult; ledgerHref: string }): ReactNode`

- [ ] **Step 1: 실패하는 캐시 키 테스트를 쓴다**

`tests/finance/cell-transactions.test.ts`를 만든다.

```ts
import { describe, expect, test } from 'vitest'

import { cellCacheKey } from '@/features/analytics/cell-transactions'

describe('cellCacheKey', () => {
  test('separates a major-only key from a sub key', () => {
    expect(cellCacheKey('식비', null, 6)).not.toBe(cellCacheKey('식비', '', 6))
    expect(cellCacheKey('식비', null, 6)).not.toBe(cellCacheKey('식비', '장보기', 6))
  })

  test('does not collide when a name contains the separator characters', () => {
    expect(cellCacheKey('식비:6', null, 1)).not.toBe(cellCacheKey('식비', null, 6))
    expect(cellCacheKey('a', 'b:c', 1)).not.toBe(cellCacheKey('a:b', 'c', 1))
  })

  test('is stable for the same cell', () => {
    expect(cellCacheKey('식비', '장보기', 6)).toBe(cellCacheKey('식비', '장보기', 6))
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/cell-transactions.test.ts`

Expected: FAIL. 모듈이 없다.

- [ ] **Step 3: 훅 모듈을 만든다**

`src/features/analytics/cell-transactions.ts`를 만든다. 기존 `requestCellTransactions`의 캐시·취소·지연·409 동작을 그대로 옮긴다.

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { CategoryDetailFlow, CellTransactionResult } from './category-detail'

export type CellRequest = {
  flow: CategoryDetailFlow
  year: number
  month: number
  major: string
  sub: string | null
  closed: boolean
  revision: number
}

/** Null sub and empty sub must not share a cache entry;   cannot appear in a category name. */
export function cellCacheKey(major: string, sub: string | null, month: number) {
  return `${major} ${sub === null ? '' : sub} ${month}`
}

export function useCellTransactions() {
  const [data, setData] = useState<CellTransactionResult | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const cache = useRef(new Map<string, CellTransactionResult>())
  const active = useRef<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const abort = useCallback(() => {
    request.current?.abort()
    request.current = null
  }, [])

  const close = useCallback(() => {
    clearTimer()
    abort()
    active.current = null
    setKey(null)
    setData(null)
  }, [abort, clearTimer])

  const reset = useCallback(() => {
    cache.current.clear()
    setStale(false)
    close()
  }, [close])

  useEffect(() => () => { clearTimer(); abort() }, [abort, clearTimer])

  const open = useCallback((cell: CellRequest, delay: number) => {
    clearTimer()
    abort()
    const cellKey = cellCacheKey(cell.major, cell.sub, cell.month)
    active.current = cellKey
    const load = async () => {
      const cached = cache.current.get(cellKey)
      if (cached) {
        if (active.current === cellKey) { setKey(cellKey); setData(cached) }
        return
      }
      const controller = new AbortController()
      request.current = controller
      const params = new URLSearchParams({
        flow: cell.flow,
        year: String(cell.year),
        month: String(cell.month),
        major: cell.major,
      })
      if (cell.sub !== null) params.set('sub', cell.sub)
      if (cell.closed) {
        params.set('scope', 'closed')
        params.set('revision', String(cell.revision))
      } else {
        params.set('scope', 'live')
      }
      try {
        const response = await fetch(`/api/cell-tx?${params}`, { signal: controller.signal })
        if (response.status === 409) {
          cache.current.clear()
          setStale(true)
          close()
          return
        }
        if (!response.ok) return
        const next = await response.json() as CellTransactionResult
        cache.current.set(cellKey, next)
        if (active.current === cellKey) { setKey(cellKey); setData(next) }
      } catch {
        // An interrupted lookup must never break the table.
      } finally {
        if (request.current === controller) request.current = null
      }
    }
    if (delay === 0) { void load(); return }
    timer.current = setTimeout(() => { void load() }, delay)
  }, [abort, clearTimer, close])

  return { data, key, stale, open, close, reset }
}
```

- [ ] **Step 4: 캐시 키 테스트 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/cell-transactions.test.ts`

Expected: PASS 3건.

- [ ] **Step 5: 팝오버 본문 컴포넌트를 만든다**

`src/features/analytics/cell-transaction-tooltip.tsx`를 만든다. markup은 `stats-monthly-section.tsx`의 상세 분기(현재 `sed -n '721,741p'`)를 그대로 옮긴다.

```tsx
import Link from 'next/link'

import { formatWon } from '@/lib/finance'

import type { CellTransactionResult } from './category-detail'

const MAX_ITEMS = 15

export function CellTransactionTooltip({
  major,
  sub,
  month,
  data,
  ledgerHref,
}: {
  major: string
  sub: string | null
  month: number
  data: CellTransactionResult
  ledgerHref: string
}) {
  return (
    <>
      <div className="border-b border-finance-border pb-2">
        <p className="font-semibold text-white">{sub ? `${major} › ${sub}` : major} · {month}월</p>
        <p className="mt-0.5 t-caption text-finance-faint">{data.items.length}건 · {formatWon(data.total)}원</p>
      </div>
      <div className="divide-y divide-finance-border">
        {data.items.slice(0, MAX_ITEMS).map((item, index) => (
          <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 py-2 t-caption" key={`${item.date}-${item.name}-${item.amount}-${index}`}>
            <span className="text-finance-faint">{item.date.slice(5).replace('-', '/')}</span>
            <span className="min-w-0 truncate text-finance-faint">{item.name}{item.acct && <span className="ml-1">{item.acct}</span>}</span>
            <span className="font-medium tabular-nums text-white">{formatWon(item.amount)}</span>
          </div>
        ))}
        {data.items.length === 0 && <p className="py-4 text-center t-body text-finance-faint">내역 없음</p>}
      </div>
      <Link className="mt-3 block border-t border-finance-border pt-2 text-right t-caption font-semibold text-white hover:text-finance-blue" href={ledgerHref}>
        이 달 거래 보기 →
      </Link>
    </>
  )
}
```

- [ ] **Step 6: 통계를 공용 컴포넌트로 이관한다**

`stats-monthly-section.tsx`에서 상세 분기의 markup을 `<CellTransactionTooltip .../>` 한 줄로 바꾼다. 요약 분기(`cellTooltip.kind === 'summary'`)와 앵커·포커스 스크롤·합계 제외는 그대로 둔다.

```tsx
          ) : (
            <CellTransactionTooltip
              data={cellTooltip.data}
              ledgerHref={`/ledger?month=${year}-${String(cellTooltip.month).padStart(2, '0')}&tab=list&flow=${flow}&major=${encodeURIComponent(cellTooltip.major)}`}
              major={cellTooltip.major}
              month={cellTooltip.month}
              sub={cellTooltip.sub}
            />
          )}
```

import를 더한다.

```tsx
import { CellTransactionTooltip } from './cell-transaction-tooltip'
```

`stats-monthly-section.tsx`의 `requestCellTransactions`는 **이번에는 건드리지 않는다.** 앵커·포커스 스크롤 상태와 얽혀 있어 훅으로 옮기면 통계의 기존 회귀가 흔들린다. 요청 로직이 두 곳에 남는다는 사실을 커밋 메시지에 적는다(스펙 §6의 대안).

- [ ] **Step 7: 통계 회귀를 돌린다**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

Expected: 셋 다 exit 0.

- [ ] **Step 8: 커밋**

```bash
git add src/features/analytics/cell-transactions.ts src/features/analytics/cell-transaction-tooltip.tsx src/features/analytics/stats-monthly-section.tsx tests/finance/cell-transactions.test.ts
git commit -m "refactor(analytics): share the cell transaction popover

Keeps requestCellTransactions in the stats section: its anchor and focus
scroll state are entangled with the summary tooltip, so the request logic
stays duplicated until that is untangled separately."
```

---

### Task 5: 추이 열 UI

**Files:**
- Create: `src/features/budgets/plan-trend.tsx`
- Modify: `src/features/budgets/plan-item.tsx` (props와 렌더), `src/features/budgets/plan-list.tsx:100-105` (열 머리), `src/app/globals.css:931-936`(그리드), `:1079+`(모바일)
- Test: `tests/finance/budget-plan-trend.test.tsx` (새)

**Interfaces:**
- Consumes: Task 2의 `BudgetPlanRow.trend`, Task 4의 `useCellTransactions`·`CellTransactionTooltip`·`CellRequest`
- Produces: `export function PlanTrend(props: { major: string; month: string; trend: BudgetPlanRow['trend']; previousActualMonth: string }): ReactNode`

- [ ] **Step 1: 실패하는 렌더 테스트를 쓴다**

`tests/finance/budget-plan-trend.test.tsx`를 만든다. 이 폴더의 예산 테스트는 JSX 대신 `createElement`를 쓴다(`budget-plan-item.test.tsx:1`, `budget-plan-list.test.tsx`). 같은 방식을 따른다.

```tsx
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { PlanTrend } from '@/features/budgets/plan-trend'

const trend = [
  { month: '2026-06', amount: 1_298_653, closed: true, revision: 7 },
  { month: '2026-07', amount: 1_253_700, closed: true, revision: 2 },
  { month: '2026-08', amount: 1_257_831, closed: false, revision: 4 },
]

function render(overrides: Partial<Parameters<typeof PlanTrend>[0]> = {}) {
  return renderToStaticMarkup(createElement(PlanTrend, {
    major: '식비',
    month: '2026-10',
    previousActualMonth: '2026-09',
    trend,
    ...overrides,
  }))
}

describe('PlanTrend', () => {
  test('shows every trend month oldest first', () => {
    const html = render()
    expect(html.indexOf('6월')).toBeLessThan(html.indexOf('7월'))
    expect(html.indexOf('7월')).toBeLessThan(html.indexOf('8월'))
    expect(html).toContain('1,298,653')
    expect(html).toContain('1,257,831')
  })

  test('marks the month that is also the previous-actual row', () => {
    expect(render({ previousActualMonth: '2026-08' })).toContain('8월 · 지난달')
    expect(render()).not.toContain('· 지난달')
  })

  test('does not write a provisional tag in the header', () => {
    expect(render()).not.toContain('잠정')
  })

  test('writes zero for a closed month with no spend and a dash for an open one', () => {
    const html = render({ trend: [
      { month: '2026-06', amount: 0, closed: true, revision: 1 },
      { month: '2026-07', amount: 0, closed: false, revision: 1 },
    ] })
    expect(html).toContain('>0<')
    expect(html).toContain('>–<')
  })

  test('says so when there is nothing recorded', () => {
    expect(render({ trend: [] })).toContain('기록 없음')
  })

  test('labels each cell for screen readers without a pressed state', () => {
    const html = render()
    expect(html).toContain('식비 6월 1,298,653원, 거래 목록 보기')
    expect(html).not.toContain('aria-pressed')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/budget-plan-trend.test.tsx`

Expected: FAIL. 모듈이 없다.

- [ ] **Step 3: `PlanTrend`를 만든다**

`src/features/budgets/plan-trend.tsx`를 만든다. 팝오버는 `createPortal`로 `document.body`에 붙이고 위치는 포인터 기준으로 잡는다.

```tsx
'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CellTransactionTooltip } from '@/features/analytics/cell-transaction-tooltip'
import { useCellTransactions, cellCacheKey } from '@/features/analytics/cell-transactions'
import { formatWon } from '@/lib/finance'

import type { BudgetPlanRow } from './plan-sources'

const HOVER_DELAY = 180

function monthNumber(month: string) {
  return Number(month.slice(5, 7))
}

export function PlanTrend({
  major,
  trend,
  previousActualMonth,
}: {
  major: string
  month: string
  trend: BudgetPlanRow['trend']
  previousActualMonth: string
}) {
  const { data, key, stale, open, close } = useCellTransactions()
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  // A cell closed by click must not reopen while the pointer is still on it.
  const suppressed = useRef<string | null>(null)

  if (trend.length === 0) {
    return <div className="plan-trend"><span className="plan-trend__empty t-caption">기록 없음</span></div>
  }

  function request(entry: BudgetPlanRow['trend'][number], delay: number) {
    open({
      flow: 'expense',
      year: Number(entry.month.slice(0, 4)),
      month: monthNumber(entry.month),
      major,
      sub: null,
      closed: entry.closed,
      revision: entry.revision,
    }, delay)
  }

  return (
    <div className="plan-trend">
      {stale && <p className="plan-trend__stale t-caption">마감 내역이 바뀌었습니다. 새로고침해 주세요.</p>}
      {trend.map(entry => {
        const number = monthNumber(entry.month)
        const cellKey = cellCacheKey(major, null, number)
        const label = entry.month === previousActualMonth ? `${number}월 · 지난달` : `${number}월`
        const text = entry.amount === 0 ? (entry.closed ? '0' : '–') : formatWon(entry.amount)
        return (
          <button
            aria-label={`${major} ${number}월 ${formatWon(entry.amount)}원, 거래 목록 보기`}
            className={`plan-trend__cell ${entry.closed ? '' : 'plan-trend__cell--provisional'}`}
            key={entry.month}
            onBlur={close}
            onClick={event => {
              if (key === cellKey) { suppressed.current = cellKey; close(); return }
              suppressed.current = null
              setAnchor({ x: event.clientX, y: event.clientY })
              request(entry, 0)
            }}
            onFocus={event => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setAnchor({ x: bounds.left + bounds.width / 2, y: bounds.bottom })
              request(entry, 0)
            }}
            onKeyDown={event => { if (event.key === 'Escape') close() }}
            onMouseEnter={event => {
              if (suppressed.current === cellKey) return
              setAnchor({ x: event.clientX, y: event.clientY })
              request(entry, HOVER_DELAY)
            }}
            onMouseLeave={() => { suppressed.current = null; close() }}
            onMouseMove={event => { if (key === cellKey) setAnchor({ x: event.clientX, y: event.clientY }) }}
            type="button"
          >
            <span className="plan-trend__month t-label">{label}</span>
            <span className="plan-trend__amount t-body">{text}</span>
          </button>
        )
      })}
      {data && anchor && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-50 max-h-[min(420px,calc(100vh-16px))] w-[min(360px,calc(100vw-16px))] overflow-y-auto bg-finance-ink p-3 text-white shadow-xl"
          role="tooltip"
          style={{
            left: Math.min(anchor.x + 12, window.innerWidth - 368),
            top: Math.min(anchor.y + 12, window.innerHeight - 16),
          }}
        >
          <CellTransactionTooltip
            data={data}
            ledgerHref={`/ledger?month=${data.ym}&tab=list&flow=expense&major=${encodeURIComponent(major)}`}
            major={major}
            month={Number(data.ym.slice(5, 7))}
            sub={null}
          />
        </div>,
        document.body,
      )}
    </div>
  )
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm test tests/finance/budget-plan-trend.test.tsx`

Expected: PASS 6건.

- [ ] **Step 5: `PlanItem`에 붙인다**

`src/features/budgets/plan-item.tsx` 위쪽 import에 더한다.

```tsx
import { PlanTrend } from './plan-trend'
```

`return (...)` 안, `</div>` 로 닫히는 `plan-item__references` **바로 뒤에** 넣는다.

```tsx
      <PlanTrend
        major={row.major}
        month={month}
        previousActualMonth={row.previousActual.month}
        trend={row.trend}
      />
```

`month`는 이미 `PlanItemProps`에 있다.

- [ ] **Step 6: 열 머리를 더한다**

`src/features/budgets/plan-list.tsx`의 header에 네 번째 span을 더한다.

```tsx
        <span className="t-label">참고 <small>줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다</small></span>
        <span className="t-label">추이 <small>최근 3개월 실제 지출 · 칸에 올리면 거래 목록</small></span>
```

- [ ] **Step 7: CSS를 더한다**

`src/app/globals.css`의 `.plan-list__header, .plan-item` 그리드를 바꾼다(931-936행).

```css
.plan-list__header,
.plan-item {
  display: grid;
  grid-template-columns: 200px 200px minmax(0, 1fr) 360px;
  gap: 16px;
}
```

`.plan-item__references` 규칙 **뒤에** 추이 규칙을 더한다.

```css
.plan-trend { display: flex; min-width: 0; flex-direction: column; grid-column: 4; grid-row: 1 / span 2; }
.plan-trend__stale { margin-bottom: 4px; color: var(--finance-amber); }
.plan-trend__empty { color: var(--finance-faint); }
.plan-trend__cell {
  display: grid;
  height: 32px;
  cursor: pointer;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: 0 -10px;
  border: 0;
  background: transparent;
  padding: 0 10px;
  color: var(--finance-ink);
  text-align: left;
}
.plan-trend__cell:hover { background: var(--finance-panel); }
.plan-trend__month {
  overflow: hidden;
  color: var(--finance-muted);
  font-weight: 400;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-trend__amount { font-variant-numeric: tabular-nums; text-align: right; }
.plan-trend__cell--provisional .plan-trend__amount { color: var(--finance-faint); }
```

모바일 블록(`@media (max-width: 640px)`, 1079행 이후)에서 `.plan-item__references { grid-column: 1; grid-row: auto; }` 줄 옆에 추이를 더한다.

```css
  .plan-item__caption,
  .plan-item__references,
  .plan-trend { grid-column: 1; grid-row: auto; }
  .plan-trend { flex-direction: row; flex-wrap: wrap; gap: 0 12px; margin-top: 4px; }
  .plan-trend__cell { height: 36px; grid-template-columns: auto auto; gap: 6px; margin: 0 -8px; padding: 0 8px; }
```

- [ ] **Step 8: 화면을 확인한다**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

Expected: 셋 다 exit 0. 기존 `budget-plan-item.test.tsx`·`budget-plan-list.test.tsx`가 열이 늘어도 통과해야 한다. 깨지면 그 테스트가 추이 칸의 새 버튼까지 세고 있는지 확인하고, 선택자를 `plan-reference__option`로 좁힌다.

- [ ] **Step 9: 커밋**

```bash
git add src/features/budgets/plan-trend.tsx src/features/budgets/plan-item.tsx src/features/budgets/plan-list.tsx src/app/globals.css tests/finance/budget-plan-trend.test.tsx
git commit -m "feat(budgets): add the trend column with a transaction popover"
```

---

### Task 6: 브라우저 상호작용 회귀

**Files:**
- Modify: `tests/e2e/budget-editor.spec.ts`

**Interfaces:**
- Consumes: Task 5의 `PlanTrend`. 기존 `boot(page, options)` 헬퍼가 `http://localhost/**`를 가로채므로 같은 라우트에서 `/api/cell-tx`를 함께 흉내 낸다.
- Produces: 없음

- [ ] **Step 1: cell-tx 스텁과 헬퍼를 더한다**

`tests/e2e/budget-editor.spec.ts`의 `boot` 안, `if (url.pathname === '/api/budget-recommendations')` 블록 **앞에** 넣는다.

```ts
    if (url.pathname === '/api/cell-tx') {
      cellRequests.push(url.search)
      if (cellStatus === 409) return route.fulfill({ status: 409, json: { error: '마감 내역이 바뀌었습니다.', refresh: true } })
      return route.fulfill({ json: {
        major: url.searchParams.get('major'),
        sub: url.searchParams.get('sub'),
        ym: `${url.searchParams.get('year')}-${String(url.searchParams.get('month')).padStart(2, '0')}`,
        total: 811_161,
        items: [
          { date: '2026-06-21', name: '코스트코코리아', amount: 196_610, acct: 'DJ 현대' },
          { date: '2026-06-11', name: '쿠팡', amount: 133_140, acct: 'DJ 국민' },
        ],
      } })
    }
```

파일 위쪽 상태 변수 옆에 더한다.

```ts
let cellRequests: string[] = []
let cellStatus = 200
```

`boot` 안 `gets = 0; posts = []; ...` 줄에 초기화를 더한다.

```ts
  cellRequests = []; cellStatus = 200
```

`item()` 아래에 헬퍼를 더한다.

```ts
const trendCell = (page: Page, month: string, major = '식비') =>
  item(page, major).getByRole('button', { name: new RegExp(`^${major} ${month} `) })
const popover = (page: Page) => page.getByRole('tooltip')
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

같은 파일 끝에 붙인다.

```ts
test('hovering a trend cell opens its transactions and leaves the draft untouched', async ({ page }) => {
  await boot(page)
  const budget = page.getByLabel('식비 예산', { exact: true })
  await expect(budget).toHaveValue('300000')
  await trendCell(page, '6월').hover()
  await expect(popover(page)).toBeVisible()
  await expect(popover(page)).toContainText('2건 · 811,161원')
  await expect(popover(page)).toContainText('코스트코코리아')
  await expect(budget).toHaveValue('300000')
  await expect(page.getByRole('button', { name: /^AI 추천 / }).first()).toHaveAttribute('aria-pressed', 'true')
})

test('the month that is also the previous-actual row is marked', async ({ page }) => {
  await boot(page)
  await expect(trendCell(page, '8월')).toContainText('8월 · 지난달')
  await expect(trendCell(page, '6월')).not.toContainText('지난달')
})

test('the trend request asks for the major without a sub', async ({ page }) => {
  await boot(page)
  await trendCell(page, '6월').hover()
  await expect(popover(page)).toBeVisible()
  expect(cellRequests.some(search => search.includes('major=') && !search.includes('sub='))).toBe(true)
})

test('clicking a trend cell opens it and clicking again closes it', async ({ page }) => {
  await boot(page)
  await trendCell(page, '6월').click()
  await expect(popover(page)).toBeVisible()
  await trendCell(page, '6월').click()
  await expect(popover(page)).toBeHidden()
})

test('keyboard focus opens the popover and Escape closes it', async ({ page }) => {
  await boot(page)
  await trendCell(page, '6월').focus()
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover(page)).toBeHidden()
})

test('a stale closed month reports itself instead of showing old rows', async ({ page }) => {
  await boot(page)
  cellStatus = 409
  await trendCell(page, '6월').click()
  await expect(page.getByText('마감 내역이 바뀌었습니다. 새로고침해 주세요.')).toBeVisible()
  await expect(popover(page)).toBeHidden()
})

test('a trend cell is tappable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await boot(page)
  await trendCell(page, '6월').tap()
  await expect(popover(page)).toBeVisible()
})
```

편집기 모드가 쓰는 시드는 `tests/e2e/fixtures/budget-save-lifecycle.tsx:59-63`이고 `average3.months`가 이미 `['2026-06', '2026-07', '2026-08']`, `previousActual.month`가 `'2026-08'`이다. 그래서 `6월` 칸이 존재하고 `8월`은 `· 지난달`이 붙는 칸이 된다. Step 4에서 그 파일에 `trend`를 더한 뒤 이 테스트들이 통과한다.

- [ ] **Step 3: 실패를 확인한다**

Run: `NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts`

Expected: 새 7건이 FAIL, 기존 31건은 PASS.

- [ ] **Step 4: fixture에 trend 시드를 더한다**

`tests/e2e/fixtures/budget-save-lifecycle.tsx`에 `average3: { ... }`가 다섯 곳 있다(63, 82, 85, 101, 107행). **각 자리마다** 바로 뒤에 그 행의 `average3.months`와 같은 달로 `trend`를 더한다. 63행 자리는 아래와 같다.

```ts
    average3: { amount: 300_000, months: ['2026-06', '2026-07', '2026-08'], monthsWithSpend: 3, provisional: false },
    trend: [
      { month: '2026-06', amount: 1_298_653, closed: true, revision: 7 },
      { month: '2026-07', amount: 1_253_700, closed: true, revision: 2 },
      { month: '2026-08', amount: 1_257_831, closed: false, revision: 4 },
    ] }],
```

나머지 네 자리는 `months`가 `['2026-07', '2026-08', '2026-09']`이므로 그 세 달로 같은 모양을 쓴다. 금액은 그 행의 `average3.amount` 부근 값이면 되고, `2026-09`는 진행 중인 달이므로 `closed: false`로 둔다.

Task 2에서 `trend`가 필수 필드가 되었으므로 이 다섯 자리는 Step 3 전에 이미 TypeScript 오류로 드러나 있다. `NODE_OPTIONS= pnpm exec tsc --noEmit`으로 위치를 확인할 수 있다.

- [ ] **Step 5: 통과를 확인한다**

Run: `NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts`

Expected: 38/38 PASS.

- [ ] **Step 6: 커밋**

```bash
git add tests/e2e/budget-editor.spec.ts tests/e2e/fixtures/budget-editor-browser.ts
git commit -m "test(budgets): cover trend cell hover, click, keyboard and stale month"
```

---

### Task 7: 전체 검증과 기록

**Files:**
- Modify: `docs/design/budget-editor/result/verification.md`

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: 없음

- [ ] **Step 1: 로컬 Supabase를 확인한다**

Run: `NODE_OPTIONS= supabase status`

Expected: exit 0이고 DB `127.0.0.1:54322`, API `127.0.0.1:54321`. `Docker Desktop is manually paused`가 나오면 Docker Desktop을 켜고 다시 확인한다. 자격 증명은 출력하거나 기록하지 않는다.

- [ ] **Step 2: 전체 게이트를 돌린다**

Run:

```sh
NODE_OPTIONS= pnpm exec tsc --noEmit \
  && NODE_OPTIONS= pnpm lint \
  && NODE_OPTIONS= pnpm test \
  && NODE_OPTIONS= pnpm test:db \
  && NODE_OPTIONS= pnpm build
```

Expected: 전부 exit 0. 실패하면 그 자리에서 고치고 다시 돌린다. 숫자(파일 수, 테스트 수, 시간)를 그대로 적어 둔다.

- [ ] **Step 3: E2E를 돌린다**

Run: `NODE_OPTIONS= pnpm e2e`

Expected: 예산 편집기 관련 케이스가 전부 통과한다. `month-close.spec.ts`의 모바일 마감 해제와 `parity.spec.ts`의 인박스 제목 편집은 2026-09-13 기록에서 간헐적 실패로 남아 있다. 그 둘이 실패하면 두 건만 다시 돌려 확인하고, 통과하더라도 **전체 단일 통과가 아님을 그대로 기록한다.** 다른 기능을 임의로 고치지 않는다.

- [ ] **Step 4: 검증 기록을 더한다**

`docs/design/budget-editor/result/verification.md` 끝에 절을 더한다. 아래 형식으로 쓰되 **실제 실행 결과**를 넣는다. 추정값을 쓰지 않는다.

```markdown
## 2026-09-14 추이 열 검증

`docs/superpowers/specs/2026-09-14-budget-trend-column-design.md` 구현 뒤 실행한 결과다.

| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS= pnpm exec tsc --noEmit` | (실제 결과) |
| `NODE_OPTIONS= pnpm lint` | (실제 결과) |
| `NODE_OPTIONS= pnpm test` | (실제 파일 수 / 테스트 수 / 시간) |
| `NODE_OPTIONS= pnpm test:db` | (실제 파일 수 / 테스트 수 / 시간) |
| `NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts` | (실제 통과 수) |
| `NODE_OPTIONS= pnpm e2e` | (실제 통과/실패 수) |
| `NODE_OPTIONS= pnpm build` | (실제 결과) |

`pnpm lint`는 이번 작업의 Task 1에서 `.worktrees/**`를 ESLint `ignores`에 더해 되살렸다. 그 전에는 중첩 워크트리 때문에 항상 실패했고 예산 코드와는 무관했다.

보호된 경계는 그대로다: DB 스키마·마이그레이션 없음, `save-contract.ts`·`save-service.ts`·AI 스냅샷·워커 무변경. `/api/cell-tx`는 `sub`를 선택 항목으로 넓혔을 뿐 마감 월 보호와 409는 그대로다.

통계의 `requestCellTransactions`는 이번에 훅으로 옮기지 않았다. 앵커·포커스 스크롤 상태와 얽혀 있어서다. 팝오버 본문만 공용으로 뺐고 요청 로직은 두 곳에 남아 있다.
```

- [ ] **Step 5: 커밋**

```bash
git add docs/design/budget-editor/result/verification.md
git commit -m "docs(budgets): record the trend column verification"
```

---

## Self-Review

**1. 스펙 coverage**

| 스펙 절 | 담당 작업 |
|---|---|
| §3.1 데스크톱 열·칸 머리·칸 색·빈 값·`기록 없음`·버튼과 aria | Task 5 (Step 1 테스트, Step 3 구현, Step 7 CSS) |
| §3.2 모바일 한 줄·36px 탭 목표 | Task 5 Step 7, Task 6 Step 2 마지막 테스트 |
| §3.3 팝오버 머리·건수·15건·내역 없음·이 달 거래 보기 | Task 4 Step 5 |
| §4 호버 180ms·mousemove·mouseleave·클릭 토글·포커스·Escape | Task 5 Step 3, Task 6 Step 2 |
| §4 캐시·취소·마감 scope·409·조용한 실패 | Task 4 Step 3, Task 6 Step 2 stale 테스트 |
| §4 추이가 초안을 바꾸지 않음 | Task 6 Step 2 첫 테스트 |
| §5.1 `trend` 필드·`average3.months`와 같은 달·오래된 순·새 질의 없음·`buildTrend` | Task 2 |
| §5.2 `sub` 선택화·타입·조회·마감 보호 유지 | Task 3 |
| §5.3 15건 제한 유지 | Task 4 Step 5 `MAX_ITEMS` |
| §6 공용 훅·공용 본문·통계 이관·대안 | Task 4 (대안을 채택하고 Step 8 커밋 메시지에 남김) |
| §7 보호 경계 | Global Constraints |
| §8 단위·통합·E2E·회귀·실행 | Task 2·3·4·5·6·7 |
| §8 lint 주의 | Task 1 |

빠진 절 없음.

**2. Placeholder 점검**

"TBD", "TODO", "적절히", "나중에"가 없다. 코드가 필요한 모든 단계에 실제 코드 블록이 있다. 계획을 쓴 뒤 세 가지 어림짐작을 실제 코드로 확인해 확정값으로 바꿨다. `getBudgetPlanningData`의 반환 필드는 `planRows`가 맞고, 예산 테스트는 JSX 대신 `createElement`를 쓰며, E2E 시드는 `budget-editor-browser.ts`가 아니라 `budget-save-lifecycle.tsx`의 다섯 자리에 있다.

**3. 타입 일관성**

- `BudgetPlanRow['trend']`의 요소는 Task 2에서 `{ month, amount, closed, revision }`로 정의되고 Task 5 테스트·구현·Task 6 fixture가 같은 네 필드를 쓴다.
- `buildTrend(input: TrendInput)`의 `TrendInput = Average3Input & { monthRevisions }`는 Task 2 Step 3에서 정의되고 Step 5에서 같은 이름으로 호출한다.
- `cellCacheKey(major, sub, month)`의 `sub: string | null`은 Task 3의 `CellTransactionParams.sub` 변경과 맞다. Task 4 테스트·구현·Task 5 사용처가 모두 `null`을 넘긴다.
- `CellTransactionTooltip`의 props `{ major, sub, month, data, ledgerHref }`는 Task 4 Step 5 정의와 Step 6(통계), Task 5 Step 3(예산) 호출이 같다.
- `useCellTransactions()`의 반환 `{ data, key, stale, open, close, reset }` 중 Task 5는 `data`·`key`·`stale`·`open`·`close`를 쓴다. `reset`은 쓰지 않지만 월 변경 시 캐시를 비우는 용도로 훅에 남긴다.
- `PlanTrend`의 props `{ major, month, trend, previousActualMonth }`는 Task 5 Step 1 테스트, Step 3 정의, Step 5 호출이 같다.

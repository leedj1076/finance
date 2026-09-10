# Unified Budgets, Local AI Recommendations and Shared AI Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예산·월말 리뷰를 하나로 합쳐 근거 있는 AI 추천을 선택·조정·저장하고, 설정에서 내역·예산의 분석 지침을 함께 관리한다.

**Architecture:** `ai-settings`는 가구별 지침과 불변 프롬프트 조합을 소유하고, 내역·예산은 각자의 금융 자료와 출력 검증을 소유한다. 요청 시점의 자료와 지침을 큐에 함께 고정하고 Mac 프로세스 하나가 두 큐를 공정하게 처리한다. 기존 수식과 수동 기능을 유지하면서 추천·편집안·저장을 분리하고 가구 범위의 충돌 검사와 출처 검증을 적용한다.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle/PostgreSQL/Supabase, Vitest, Playwright, 기존 Mac Codex CLI 워커. 새 런타임 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-10-ai-budget-planning-design.md` + `docs/superpowers/specs/2026-09-10-ai-diagnosis-settings-design.md` — 두 문서 모두 2026-09-10 사용자 승인. 예산 수식/저장 계약은 전자, 프롬프트 설정/legacy claim 호환은 후자가 정본이다.

**Status:** 승인된 두 명세를 통합한 13-task 실행 계획. 이 문서는 구현 결과가 아니며 체크박스는 실행 중 실제 검증 후에만 표시한다.

## Global Constraints

- `/budgets`와 `/budgets/review`를 `/budgets` 하나로 통합한다.
- 기존 `/budgets`의 기준 수입·상한·반올림을 정본으로 사용한다.
- 다음 기능은 유지한다: 직접 입력, 지난달 예산/월평균 채우기, 고정비·변동비·비정기 구분, 지난달 예산과 실적 비교, 6개월 중앙값 참고 및 채우기, 변동비 감축 도구, 예산 대비 실제·페이스 경고, 수동 저축 목표 변경.
- AI 신규 추천은 1차 버전에서 이번 달과 다음 달을 지원한다. 수동 편집 월 범위는 유지한다.
- 특이사항 4,000자, 추가 예정 지출 30건 이하, 항목 설명 200자 이하. 근거 2,000건, 직렬화한 스냅샷 1MiB.
- AI가 거래·분류·월 마감·저축 목표를 변경하지 않는다. 추천 가져오기는 선택한 편집 행만 바꾸며 DB 저장은 별도다.
- 설정은 가구 공유다. 공통 최대 4,000자, 내역/예산 각각 최대 6,000자. null은 기본값 사용, 빈 문자열은 추가 분석 지침 없음이다.
- 설정/미리보기 요청과 직렬화한 prompt_input은 각각 128KiB 이하. claim 응답은 2MiB 이하. 모델·실행 제한은 조회만 제공한다.
- 설정 변경은 새 요청에만 적용한다. 지침 변경과 금융 자료 변경을 구분하고, 대기/실행 작업의 지침을 교체하지 않는다.
- 미리보기는 설정 저장·큐 생성·lease 정리·AI 실행을 하지 않는다. 기존 결과의 미기록 프롬프트를 현재 문구로 위조하지 않는다.
- 모든 조회와 저장에 인증된 `householdId` 조건을 적용한다. 새 테이블은 RLS를 켜고 가구 구성원의 자기 가구 결과 조회만 허용한다.
- 기존 월 마감 서비스·트리거, 거래 import 지문, 분류 규칙, 저축률/자산/페이스 계산은 바꾸지 않는다.
- 원 단위 안전한 정수와 합계 범위를 검사한다. 환불의 부호를 보존하고 저축 납입을 지출에 더하지 않는다.
- Swiss Ledger 토큰·타이포·다크모드를 유지한다. 페이지 전체 가로 스크롤을 만들지 않는다.
- 로그에 거래 본문·사용자 특이사항·프롬프트·토큰을 기록하지 않는다. 작업 ID·상태·안전한 오류 코드만 남긴다.
- 마지막 게이트는 `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm e2e`. DB/E2E는 로컬 Supabase에서 수행한다.
- 이 플랜 실행은 로컬 구현·검증·태스크별 커밋까지다. push·운영 DB·상주 워커 재시작·배포는 별도 승인 후 수행한다.
- 다른 세션의 `.tmp-*`, `docs/superpowers/plans/2026-09-07-*`, `docs/design/swiss-ledger/ai-diagnosis-*`, `outputs/`는 수정·추가·삭제하지 않는다. `git add -A` 금지.

---

## Execution context and file ownership

확인 기준은 `main`의 설계 커밋 `4ffc1dd`다. 코드 기준은 `275442c`이며 문서 작성 중 애플리케이션 코드는 수정하지 않았다. 앞선 점검에서 로컬 Supabase API `http://127.0.0.1:54321`와 로컬 DB가 실행 중이었다. 실행 시작 때 다시 확인한다.

실행자는 `superpowers:using-git-worktrees`로 현재 다른 세션 작업과 격리된 `feat/ai-budget-planning` 작업공간을 확보한다. 기존 worktree를 삭제하거나 재사용하기 위해 강제 checkout하지 않는다. `.env.local`의 비밀을 출력하거나 커밋하지 말고, DB hostname이 loopback인지 확인한 뒤에만 마이그레이션·테스트한다. `scripts/run-migrate.ts`는 SQLite 이관 도구이므로 이 작업에서 실행하지 않는다.

태스크 시작 시 파일 이름·export·migration journal을 재확인한다. 코드가 달라졌으면 이 플랜의 정확한 경로/계약부터 수정하고 문서 변경을 그 태스크 커밋에 포함한다. 존재하지 않는 파일을 있다고 가정하거나 기존 테스트를 지워 통과시키지 않는다.

### File map

| Boundary | Files | Responsibility |
| --- | --- | --- |
| 기존 예산 읽기 | `src/features/budgets/{queries,review-queries,planning-queries,review-redirect}.ts` | 기존 계산을 유지한 transaction-aware reader, 단일 화면 모델, 대상 월 보존 redirect |
| 예산 편집 | `src/features/budgets/{budget-form,budget-reference,budget-row}.tsx`, `draft.ts` | 한 편집표, 기존 채우기 도구, 선택 적용/되돌리기/출처 상태 |
| 저장 | `src/features/budgets/{save-contract,save-service,actions,review-actions}.ts` | 변경 행만 CAS 저장, AI 출처/상한 초과 확인, 명시적 목표 변경 |
| 공통 AI 설정 | `src/features/ai-settings/{types,defaults,input,prompt,service,preview,client}.ts`, `settings-form.tsx`, `prompt-viewer.tsx`, `src/app/api/ai-settings/route.ts` | 가구 지침/CAS, 프롬프트 보존, 읽기 전용 미리보기/워커 정보 |
| AI 분석 계약 | `src/features/budget-recommendations/{types,input,calculations,snapshot,report,prompt}.ts` | 분석 자료, 엄격한 입력/출력 검증, 서버 계산, 근거 |
| AI 서비스 | `src/features/budget-recommendations/{service,client,worker,panel}.ts[x]`, `src/app/api/budget-recommendations/route.ts` | 큐 요청/복구, stale 검사, polling, 예산 worker adapter, 진행 UI |
| 공용 실행부 | `src/features/diagnosis/{structured-runner,codex-runner,worker-rpc,worker}.ts`, `src/features/budget-recommendations/codex-runner.ts`, `scripts/diagnosis-worker.ts` | 기존 보안 제한을 보존한 작은 실행부, 단일 워커의 두 큐 처리 |
| DB | `src/db/schema/{ai-settings,budget-recommendations,budget,diagnosis,index}.ts`, `drizzle/0008_ai_diagnosis_settings.sql`, `drizzle/0009_budget_recommendations.sql`, 해당 두 snapshot/journal | 지침/CAS, 별도 큐, legacy claim 격리, worker capability, 예산 출처 |
| 회귀/운영 문서 | 아래 태스크의 정확한 test 경로, `docs/ai-budget-planning-runbook.md` | 결정적 fixture, 로컬 격리, 브라우저 검증, 승인 후 배포 순서 |

`BudgetReviewForm`의 기능을 `BudgetForm`으로 옮긴 뒤 해당 중복 컴포넌트만 삭제한다. 기존 `review-calculations.ts`, `simulator-calculations.ts`의 수식을 수정하지 않는다. 범용 AI 플랫폼, repository 계층 전면 교체, branded ID는 추가하지 않는다.

## Shared budget contracts (introduced by Tasks 3 and 6)

새 기능의 타입은 `src/features/budget-recommendations/types.ts`에 둔다. 다음 이름과 필드를 후속 태스크에서 그대로 사용한다. `DiagnosisErrorCode`는 기존 `src/features/diagnosis/types.ts`, `AiPromptInput`은 Task 2의 `ai-settings/types.ts`에서 import한다.

```ts
export type BudgetInput = {
  month: string
  notes: string
  plannedExpenses: { id: string; major: string; amount: number; note: string }[]
  draftAmounts: { major: string; amount: number }[]
}
export type BudgetRequest = BudgetInput & { requestId: string }
export type BudgetSourceRow = {
  major: string
  group: 'fixed' | 'variable' | 'irregular'
  savedAmount: number
  savedRecommendationJobId: string | null
  actual: number
  unpostedRecurring: number
  planned: number
  floor: number
  previousBudget: number
  previousActual: number
  average: number
  median: number
  subcategories: { sub: string; month: string; amount: number }[]
}
export type BudgetEvidence = {
  id: number; date: string; flow: 'expense' | 'income' | 'saving'
  amount: number; major: string | null; sub: string | null; merchant: string
}
export type BudgetRecommendationSnapshot = {
  version: 1
  month: string
  asOfDate: string // KST YYYY-MM-DD; not a volatile timestamp
  sourceHash: string // analytical source data, excludes budgets/draft
  budgetHash: string // effective stored budgets including fallback/provenance
  fingerprint: string // sourceHash + budgetHash + normalized BudgetInput
  input: BudgetInput
  basis: {
    averageIncome: number; savingsTarget: number; spendCeiling: number
    incomeStart: string; incomeEnd: string; incomeMonthCount: number
  }
  current: {
    income: number; expense: number; saving: number
    unallocatedActual: number; unallocatedRecurring: number
  }
  rows: BudgetSourceRow[]
  history: {
    month: string; state: 'open' | 'closed' | 'needs_review'
    hasRecords: boolean; partial: boolean
    income: number; expense: number; saving: number
    majors: { major: string; amount: number }[]
  }[]
  recurring: {
    id: number; major: string | null; amount: number
    date: string; posted: boolean; memo: string
  }[] // due expense rules only; posting identity uses the target month
  evidence: BudgetEvidence[]
  evidenceCount: { total: number; provided: number }
  pendingCount: number
  unclassifiedCount: number
}
export type BudgetReference =
  | { kind: 'transaction'; id: number }
  | { kind: 'recurring'; id: number }
  | { kind: 'planned'; id: string }
  | { kind: 'notes'; quote: string }
  | { kind: 'instructions'; scope: 'common' | 'task'; quote: string }
export type BudgetFinding = {
  text: string; certainty: 'recorded' | 'user_provided' | 'hypothesis'
  references: BudgetReference[]
}
export type BudgetRecommendationReport = {
  version: 1
  summary: string
  limitations: string[]
  overCeilingReason: string // empty only when server-computed total <= ceiling
  adjustments: BudgetFinding[]
  rows: {
    major: string; amount: number; reason: string
    references: BudgetReference[]
    exceptional: BudgetFinding[]; reducible: BudgetFinding[]
  }[]
}
export type BudgetEvaluation = {
  allocated: number
  unallocatedReserve: number
  total: number
  overage: number
  savingsRate: number
  rows: { major: string; amount: number; remainingAllocation: number }[]
}
export type BudgetJobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ClaimedBudgetJob = {
  id: string; claimToken: string; snapshot: BudgetRecommendationSnapshot
  promptInput: AiPromptInput
}
export type CompletedBudgetRecommendation = {
  id: string; completedAt: string
  snapshot: BudgetRecommendationSnapshot
  promptInput: AiPromptInput | null
  report: BudgetRecommendationReport
  evaluation: BudgetEvaluation
}
export type BudgetRecommendationData = {
  month: string
  latestJob: { id: string; status: BudgetJobStatus; errorCode: DiagnosisErrorCode | null } | null
  completed: CompletedBudgetRecommendation | null // keep prior success while rerunning
  worker: 'ready' | 'offline' | 'upgrade_required' | 'not_registered'
  availability: 'available' | 'past_or_distant_month' | 'missing_income' | 'setup_required'
  freshness: 'current' | 'source_changed' | 'budgets_changed' | 'applied'
  instructionsChanged: boolean // not part of financial freshness
}
```

Report row order is canonical snapshot order, not model order. No model-generated totals/percentages are authoritative. API responses contain no worker token, household identifier supplied by the browser, or SQL error text. Prompt text is household-private data; display it deliberately and never log it.

---

### Task 1: One manual budget screen and stable review redirects

**Files:**
- Modify: `src/features/budgets/queries.ts`, `src/features/budgets/review-queries.ts`, `src/features/budgets/budget-form.tsx`, `src/app/budgets/page.tsx`, `src/app/budgets/review/page.tsx`
- Create: `src/features/budgets/planning-queries.ts`, `src/features/budgets/review-redirect.ts`, `src/features/budgets/budget-reference.tsx`
- Delete after migration: `src/features/budgets/budget-review-form.tsx`
- Modify: `src/features/analytics/home-todos.ts`, `src/features/month-close/month-wrap-up.tsx`, `src/lib/revalidate.ts`
- Tests: `tests/finance/budget-planning.test.ts`, `tests/finance/month-status-pages.test.tsx`, `tests/finance/revalidate.test.ts`, `tests/finance/diagnosis-ledger-page.test.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/period-sorting-charts.spec.ts`

**Interfaces:**
- Existing inputs: `getBudgetData(householdId, requestedMonth?)`, `getBudgetReviewData(householdId, requestedTargetMonth?)`, `suggestedBudget`, `projectedSavingsRate`, existing simulator functions.
- Export `BudgetReader = Pick<typeof db, 'select'>` from `queries.ts`.
- Export transaction-aware `readExpenseMajorNames(reader: BudgetReader, householdId: string): Promise<string[]>`, `readBudgetData(reader: BudgetReader, householdId: string, requestedMonth?: string, now?: Date)` and `readBudgetReviewData(reader: BudgetReader, householdId: string, requestedTargetMonth?: string, now?: Date)`; preserve existing wrappers/return types and calculations. Internal date reads use the optional `now`; public wrappers keep the existing signature/default clock.
- `getBudgetPlanningData(householdId: string, requestedMonth?: string)` returns `{ ...budgetData, review: reviewData }`, resolving the target month from budgetData first.
- `budgetReviewDestination(month: unknown): string`; `BudgetReference({ review }: { review: Awaited<ReturnType<typeof getBudgetReviewData>> })` is a read-only collapsible reference, no second form.

- [ ] **1. Write failing redirect and single-ceiling tests.** In `budget-planning.test.ts`, mock the existing loaders for the combined reader and assert its ceiling is the budget loader's, even if review differs. Add these deterministic redirect checks:

```ts
import { afterEach, expect, test, vi } from 'vitest'
import { budgetReviewDestination } from '@/features/budgets/review-redirect'

afterEach(() => vi.useRealTimers())
test('review month is already the target month', () => {
  expect(budgetReviewDestination('2026-10')).toBe('/budgets?month=2026-10')
})
test('missing or invalid review month uses current KST, not latest transaction', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-30T15:01:00Z'))
  expect(budgetReviewDestination(undefined)).toBe('/budgets?month=2026-10')
  expect(budgetReviewDestination(['2026-08'])).toBe('/budgets?month=2026-10')
})
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-planning.test.ts` — new module/export missing.
- [ ] **3. Implement the reader and redirect.** Mechanically replace module `db` reads with `reader` in the two loaders, including nested major-name reads. Public wrappers still call with `db`. Do not change the year-based income denominator, review completed-month selection, median or fallback rules.

```ts
// review-redirect.ts
import { currentMonthInKorea, isMonthKey } from '@/lib/finance'
export function budgetReviewDestination(month: unknown): string {
  const target = typeof month === 'string' && isMonthKey(month)
    ? month : currentMonthInKorea()
  return `/budgets?month=${target}`
}

// planning-queries.ts
import { getBudgetData } from './queries'
import { getBudgetReviewData } from './review-queries'
export async function getBudgetPlanningData(householdId: string, requestedMonth?: string) {
  const budget = await getBudgetData(householdId, requestedMonth)
  const review = await getBudgetReviewData(householdId, budget.month)
  return { ...budget, review }
}
```

The review route still checks `requireHousehold()`, redirects unauthenticated users to `/login`, then calls `permanentRedirect(budgetReviewDestination(params.month))`. It performs no review query. Preserve `reviewSaved=1` success handling on `/budgets`. Internal links use `/budgets?month=<existing target>` without an extra month shift.

- [ ] **4. Merge UI with concrete controls.** Render one `BudgetForm key={'budget-editor:' + data.month}`. Move previous-month income/expense/savings/budget difference into `<details><summary>지난달 돌아보기</summary>…</details>` via `BudgetReference`. Add `기존 리뷰 규칙으로 채우기` using each review row's existing suggestion and retain variable reduction. All fill actions first show a preview listing the affected major, current draft and proposed amount, then require `초안에 가져오기`. Preview does not save. Use canonical `data.averageIncome`, `data.spendCeiling`, `data.savingsTarget` everywhere; never `data.review.spendCeiling`. Suppress pace warnings for future months. Reuse existing CSS tokens and exact-won `step="1"` inputs. Remove only the now-unreferenced `BudgetReviewForm`.
- [ ] **5. Update intentional route assertions and run green.** Preserve month-status heading assertions on the unified page; replace review heading test with redirect assertion. Remove `/budgets/review` from live cache-reader lists/tests but keep the route. Run `pnpm test tests/finance/budget-planning.test.ts tests/finance/month-status-pages.test.tsx tests/finance/revalidate.test.ts tests/finance/diagnosis-ledger-page.test.ts`, `pnpm exec tsc --noEmit`, and `pnpm e2e tests/e2e/period-sorting-charts.spec.ts tests/e2e/auth.spec.ts`. Assert the existing next-month link lands on the same target, numeric amount `723693` remains valid, only one editable table exists.
- [ ] **6. Commit exact scope.**

```bash
git add src/features/budgets/queries.ts src/features/budgets/review-queries.ts src/features/budgets/budget-form.tsx src/features/budgets/budget-review-form.tsx src/features/budgets/planning-queries.ts src/features/budgets/review-redirect.ts src/features/budgets/budget-reference.tsx src/app/budgets/page.tsx src/app/budgets/review/page.tsx src/features/analytics/home-todos.ts src/features/month-close/month-wrap-up.tsx src/lib/revalidate.ts tests/finance/budget-planning.test.ts tests/finance/month-status-pages.test.tsx tests/finance/revalidate.test.ts tests/finance/diagnosis-ledger-page.test.ts tests/e2e/auth.spec.ts tests/e2e/period-sorting-charts.spec.ts
git commit -m "refactor: unify budget editing and monthly review"
```

### Task 2: Versioned household AI settings and immutable prompt composition

**Files:**
- Create: `src/features/ai-settings/types.ts`, `defaults.ts`, `input.ts`, `prompt.ts`, `service.ts` under the same directory
- Create: `src/db/schema/ai-settings.ts`, `drizzle/0008_ai_diagnosis_settings.sql`, `drizzle/meta/0008_snapshot.json`
- Modify: `src/db/schema/index.ts`, `drizzle/meta/_journal.json`
- Tests: `tests/finance/ai-settings.test.ts`, `tests/finance/ai-prompt.test.ts`, `tests/integration/ai-settings.test.ts`

**Interfaces:**

```ts
// ai-settings/types.ts
export type AiKind = 'ledger' | 'budget'
export type AiSettingsValues = {
  commonInstructions: string | null
  ledgerInstructions: string | null
  budgetInstructions: string | null
}
export type AiSettingsState = AiSettingsValues & {
  revision: number; updatedAt: string | null
}
export type AiSettingsSave = AiSettingsValues & { expectedRevision: number }
export type ResolvedAiInstructions = {
  kind: AiKind; settingsRevision: number; defaultsVersion: string
  common: string; task: string
  commonSource: 'default' | 'custom'; taskSource: 'default' | 'custom'
}
export type AiPromptPolicy = {
  version: string; before: string; after: string; dataTag: string
} // application-owned, never accepted as a browser input
export type AiPromptInput = {
  version: 1; kind: AiKind; instructions: ResolvedAiInstructions
  policyVersion: string; instructionsHash: string
  prefix: string; suffix: string; promptHash: string
}
export type AiWorkerView = {
  id: string; label: string; lastSeenAt: string | null
  state: 'ready' | 'offline' | 'upgrade_required'
  promptProtocolVersion: number; budgetProtocolVersion: number
  configuredModel: string | null; timeoutMs: number | null
}
```

- `AI_DEFAULTS` / `AI_DEFAULTS_VERSION` from defaults.ts.
- `parseAiSettingsSave(value: unknown): AiSettingsSave`, `parseAiSettingsValues(value: unknown): AiSettingsValues` from input.ts; exact keys and type/size validation, throw safe `invalid_ai_settings`.
- `canonicalAiJson(value: unknown): string` accepts JSON-only values, sorts object keys recursively, preserves array order, rejects nonfinite/undefined values.
- `resolveAiInstructions(settings: AiSettingsState, kind: AiKind): ResolvedAiInstructions`.
- `aiInstructionsHash(instructions: ResolvedAiInstructions, policyVersion: string): string` hashes kind/common/task/defaultsVersion/policyVersion, not revision/source-mode/other-kind text.
- `freezeAiPromptInput(instructions: ResolvedAiInstructions, policy: AiPromptPolicy, snapshot: unknown): AiPromptInput`, `renderAiPrompt(input: AiPromptInput, snapshot: unknown): string`, `parseAiPromptInput(value: unknown, kind: AiKind, snapshot: unknown): AiPromptInput` from prompt.ts. Rendering verifies protocol/shape/limits/hash, never consults current settings or regenerates frozen prefix/suffix.
- `AiSettingsReader = Pick<typeof db, 'select'>`, `readAiSettings(reader: AiSettingsReader, householdId: string): Promise<AiSettingsState>`, `getAiSettings(householdId: string): Promise<AiSettingsState>`, `saveAiSettings(householdId: string, userId: string, input: AiSettingsSave): Promise<AiSettingsState>` from service.ts.

- [ ] **1. Write failing unit and DB tests.**

```ts
import { expect, test } from 'vitest'
import { resolveAiInstructions, aiInstructionsHash, freezeAiPromptInput, renderAiPrompt } from '@/features/ai-settings/prompt'
import type { AiSettingsState } from '@/features/ai-settings/types'

const empty: AiSettingsState = { revision: 0, updatedAt: null,
  commonInstructions: null, ledgerInstructions: null, budgetInstructions: null }
test('blank custom instructions are not the same as restored defaults', () => {
  expect(resolveAiInstructions({ ...empty, commonInstructions: '' }, 'ledger').common).toBe('')
  expect(resolveAiInstructions(empty, 'ledger').common.length).toBeGreaterThan(0)
})
test('a budget-only edit does not change ledger instructions', () => {
  const a = resolveAiInstructions(empty, 'ledger')
  const b = resolveAiInstructions({ ...empty, revision: 1, budgetInstructions: '여행 없음' }, 'ledger')
  expect(aiInstructionsHash(a, 'ledger-1')).toBe(aiInstructionsHash(b, 'ledger-1'))
})
test('frozen text survives settings edits and JSONB key reordering', () => {
  const input = freezeAiPromptInput(resolveAiInstructions(empty, 'ledger'), {
    version: 'ledger-1', before: '도구를 사용하지 마세요.',
    after: '정해진 JSON 형식으로만 답하세요.', dataTag: 'diagnosis_snapshot_json',
  }, { b: 2, a: 1 })
  expect(renderAiPrompt(input, { a: 1, b: 2 })).toBe(renderAiPrompt(input, { b: 2, a: 1 }))
  expect(() => renderAiPrompt({ ...input, prefix: 'altered' }, { a: 1, b: 2 })).toThrow()
})
```

Integration fixture creates two test households/users using `tests/integration/diagnosis-queue.test.ts`'s local-only auth/member setup; clean up only those generated IDs. Assert first changed save revision1, stale expectedRevision0 with different values rejected, identical submitted values no-op, empty/null distinction persisted, foreign SELECT invisible and authenticated/anon table writes denied. An all-null save against the absent logical all-null revision0 state is unchanged and remains revision0 without inserting; this follows the approved no-op rule. Exercise overlapping first inserts, not only sequential stale writes.

- [ ] **2. Red gate:** `pnpm test tests/finance/ai-settings.test.ts tests/finance/ai-prompt.test.ts`, then `pnpm test:db tests/integration/ai-settings.test.ts` — modules/table missing.
- [ ] **3. Implement defaults and strict composition.** Use these initial editable defaults; leave the legacy diagnosis prompt function unchanged until its versioned adapter is added in Task 8.

```ts
export const AI_DEFAULTS_VERSION = '2026-09-10-v1'
export const AI_DEFAULTS = {
  commonInstructions: '한국어로 간결하고 구체적으로 설명하세요. 우리집 기록과 확인 가능한 근거를 중심으로 중요한 변화와 실행할 행동을 우선하고, 같은 설명이나 형식적인 칭찬을 반복하지 마세요.',
  ledgerInstructions: '이번 달 지출이 달라진 이유와 수입 구성을 함께 분석하세요. 증가와 감소가 상쇄됐다면 설명하고, 직전 3개월 추이와 비교 한계를 구분하세요. 확인이 필요한 사항과 다음 달 준비에 도움이 되는 행동을 우선하세요.',
  budgetInstructions: '지난달 예외 지출이 사라지는 효과와 실제 절약을 구분하세요. 유지할 고정비와 비정기 적립을 고려하고, 줄일 수 있는 항목과 월 전체 추천 금액의 이유를 구체적으로 설명하세요.',
} as const
```

`freezeAiPromptInput` serializes the two instruction strings in a clearly labeled JSON block between policy.before and policy.after; never interpolates them as code or applies user-defined templates. Generate suffix from the validated application-owned dataTag. Prompt hash is SHA256 of `prefix + canonicalAiJson(snapshot) + suffix`. Store resolved instructions alongside frozen prefix/suffix, limited to 128KiB serialized; total claim remains ≤2MiB. Empty strings remain empty. Parser validates exact fields, matching kind/instructions.kind, legal sources, revision, policy identifiers, hash format, and recomputed full hash. The hash ensures consistency, not authorization; only server-created jobs are trusted and runner permissions remain independently locked.

- [ ] **4. Add the settings table/CAS service and apply locally.** Journal currently ends at0007. Generate `pnpm db:generate --name=ai_diagnosis_settings`, review only expected schema additions, and include SQL RLS grants with `apply_patch`.

```sql
CREATE TABLE public.ai_diagnosis_settings (
  household_id uuid PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  common_instructions text CHECK (length(common_instructions) <= 4000),
  ledger_instructions text CHECK (length(ledger_instructions) <= 6000),
  budget_instructions text CHECK (length(budget_instructions) <= 6000),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL
);
ALTER TABLE public.ai_diagnosis_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_diagnosis_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ai_diagnosis_settings TO authenticated;
CREATE POLICY ai_settings_member_select ON public.ai_diagnosis_settings
  FOR SELECT TO authenticated USING (public.is_member(household_id));
```

Read missing row as revision0/null values without inserting. Save all three fields atomically, compare expectedRevision with current; existing rows UPDATE with householdId+revision predicate and increment revision. Absent row INSERT revision1 only when expectedRevision0; a concurrent unique conflict is `ai_settings_conflict`, not an upsert overwrite. Same current values return current state without bumping revision, including safe duplicate submission. Actor/time are server assigned. Reject unknown keys, files, numeric text, over-limit character/body size and negative/noninteger revisions. Only own AI settings cache is invalidated; don't edit financial settings or enqueue jobs.

- [ ] **5. Green gate:** verify both unit files, local `pnpm db:migrate`, integration settings tests, `pnpm exec tsc --noEmit`. Add multibyte/escape-heavy128KiB boundary, hostile tag text, hash tampering, defaults restoration, no-op concurrent retry and RLS cases.
- [ ] **6. Commit exact scope.**

```bash
git add src/features/ai-settings/types.ts src/features/ai-settings/defaults.ts src/features/ai-settings/input.ts src/features/ai-settings/prompt.ts src/features/ai-settings/service.ts src/db/schema/ai-settings.ts src/db/schema/index.ts drizzle/0008_ai_diagnosis_settings.sql drizzle/meta/0008_snapshot.json drizzle/meta/_journal.json tests/finance/ai-settings.test.ts tests/finance/ai-prompt.test.ts tests/integration/ai-settings.test.ts
git commit -m "feat: add versioned household AI instruction settings"
```

### Task 3: Strict inputs and server-owned budget arithmetic

**Files:**
- Create: `src/features/budget-recommendations/types.ts`, `src/features/budget-recommendations/input.ts`, `src/features/budget-recommendations/calculations.ts`
- Tests/create fixture: `tests/finance/budget-recommendation-calculations.test.ts`, `tests/fixtures/budget-recommendation.ts`

**Interfaces:**
- Produce all Shared contracts above.
- `parseBudgetRequest(value: unknown): BudgetRequest` throws `BudgetInputError` (safe message, no original payload).
- `assertBudgetMajors(input: BudgetInput, allowedMajors: string[]): void` rejects unknown or duplicate draft majors/planned IDs.
- `safeBudgetSum(values: number[]): number`, `recommendationFloor(actual: number, recurring: number, planned: number): number`, `evaluateBudget(snapshot: BudgetRecommendationSnapshot, amounts: { major: string; amount: number }[]): BudgetEvaluation`.
- Fixture exports `makeBudgetSnapshot(): BudgetRecommendationSnapshot` and `makeBudgetReport(): BudgetRecommendationReport` for later tasks.

- [ ] **1. Write failing signed-amount and floor tests.**

```ts
import { expect, test } from 'vitest'
import { recommendationFloor, safeBudgetSum, evaluateBudget } from '@/features/budget-recommendations/calculations'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

test('refunds remain negative; future commitments determine the floor', () => {
  expect(recommendationFloor(-20_000, 50_000, 10_000)).toBe(40_000)
  expect(recommendationFloor(-20_000, 0, 0)).toBe(0)
  expect(() => safeBudgetSum([Number.MAX_SAFE_INTEGER, 1])).toThrow()
})
test('total includes unallocated actual, not saving deposits', () => {
  const snapshot = makeBudgetSnapshot()
  const result = evaluateBudget(snapshot, [{ major: '식비', amount: 300_000 }])
  expect(result.total).toBe(320_000)
  expect(result.rows[0].remainingAllocation).toBe(200_000)
  expect(result.savingsRate).toBe(68)
})
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-calculations.test.ts` — missing exports.
- [ ] **3. Add contracts, fixture, and arithmetic.** Import `savingsRate` from existing `@/lib/finance`; do not copy or redefine its rounding. `evaluateBudget` requires exactly the snapshot's active majors once, sums proposed amounts, adds `safeBudgetSum([current.unallocatedActual, current.unallocatedRecurring])` as signed unallocated reserve, computes overage `max(0,total-spendCeiling)` and calls the existing rate function. Remaining per row is proposal minus signed actual, not bank balance. Preserve negative unallocated refunds; proposed row allocations themselves are nonnegative.

```ts
export function safeBudgetSum(values: number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      throw new Error('invalid_amount')
    }
    return total + value
  }, 0)
}
export function recommendationFloor(actual: number, recurring: number, planned: number): number {
  return Math.max(0, safeBudgetSum([actual, recurring, planned]))
}
```

Fixture implementation (imports the two types from `types.ts`):

```ts
export function makeBudgetSnapshot(): BudgetRecommendationSnapshot {
  return {
    version: 1, month: '2026-09', asOfDate: '2026-09-10',
    sourceHash: 'a'.repeat(64), budgetHash: 'b'.repeat(64), fingerprint: 'c'.repeat(64),
    input: { month: '2026-09', notes: '', plannedExpenses: [], draftAmounts: [] },
    basis: { averageIncome: 1_000_000, savingsTarget: 30, spendCeiling: 700_000,
      incomeStart: '2026-01-01', incomeEnd: '2026-09-01', incomeMonthCount: 8 },
    current: { income: 1_000_000, expense: 120_000, saving: 80_000,
      unallocatedActual: 20_000, unallocatedRecurring: 0 },
    rows: [{ major: '식비', group: 'variable', savedAmount: 350_000, savedRecommendationJobId: null, actual: 100_000,
      unpostedRecurring: 0, planned: 0, floor: 100_000, previousBudget: 350_000,
      previousActual: 320_000, average: 300_000, median: 300_000, subcategories: [] }],
    history: ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'].map(month => ({
      month, state: 'closed', hasRecords: true, partial: false, income: 1_000_000,
      expense: 320_000, saving: 80_000, majors: [{ major: '식비', amount: 320_000 }],
    })),
    recurring: [],
    evidence: [{ id: 11, date: '2026-09-01', flow: 'expense', amount: 100_000,
      major: '식비', sub: '장보기', merchant: '동네마트' }],
    evidenceCount: { total: 1, provided: 1 }, pendingCount: 0, unclassifiedCount: 1,
  }
}
export function makeBudgetReport(): BudgetRecommendationReport {
  return {
    version: 1, summary: '최근 기록을 참고한 월 전체 예산입니다.', limitations: [],
    overCeilingReason: '', adjustments: [],
    rows: [{ major: '식비', amount: 300_000, reason: '기록된 장보기 비용을 포함해 배정했습니다.',
      references: [{ kind: 'transaction', id: 11 }], exceptional: [], reducible: [] }],
  }
}
```

- [ ] **4. Implement strict request parsing with boundary tests.** Require an exact object with `requestId,month,notes,plannedExpenses,draftAmounts`. UUID requestId; month validated with `isMonthKey`; no household/model/path/prompt fields; notes length ≤4000; planned length ≤30, UUID ids, nonempty category, note ≤200, safe nonnegative integer amount. Draft list ≤500, unique majors, safe nonnegative integer. Reject arrays/null/numeric strings/nonfinite values, duplicate IDs and unknown keys at every nested level. Parse amounts as numbers, not the legacy missing-FormData-as-zero rule. Normalize list order by id/major for hashing, preserve note text for exact evidence quotations. Add boundary assertions for 4001 chars, 31 costs, fractional amounts, duplicate IDs, and sums exceeding MAX_SAFE_INTEGER.
- [ ] **5. Green gate:** `pnpm test tests/finance/budget-recommendation-calculations.test.ts` and `pnpm exec tsc --noEmit`.
- [ ] **6. Commit.**

```bash
git add src/features/budget-recommendations/types.ts src/features/budget-recommendations/input.ts src/features/budget-recommendations/calculations.ts tests/finance/budget-recommendation-calculations.test.ts tests/fixtures/budget-recommendation.ts
git commit -m "feat: define budget recommendation inputs and arithmetic"
```

### Task 4: Consistent, bounded, household-scoped analysis snapshots

**Files:**
- Create: `src/features/budget-recommendations/snapshot.ts`
- Modify: `src/features/budgets/queries.ts` (expose existing income basis, no formula change)
- Tests: `tests/integration/budget-recommendation-snapshot.test.ts`, `tests/finance/budget-recommendation-snapshot.test.ts`

**Interfaces:**
- Consume `BudgetReader`/`readBudgetData` from `budgets/queries.ts`, `readBudgetReviewData` from `budgets/review-queries.ts`, `readMonthStatuses` from `src/features/month-close/queries.ts`, and existing recurring functions listed below.
- `readBudgetSnapshot(reader: BudgetReader, householdId: string, input: BudgetInput, now?: Date): Promise<BudgetRecommendationSnapshot>`; caller owns a repeatable-read or serializable transaction.
- `boundBudgetEvidence(snapshot: BudgetRecommendationSnapshot): BudgetRecommendationSnapshot` performs deterministic evidence truncation without changing aggregates.
- `hashBudgetPayload(value: unknown): string` is SHA256 of canonical JSON (sorted object keys; domain lists explicitly sorted by stable IDs before calling). Never hashes a wall-clock request timestamp.

- [ ] **1. Write failing consistency/limit tests.** Add the following pure test; integration tests insert two fixture households, their active/hidden categories, signed expense/income/saving rows, recurring rules and monthly statuses. Delete only those fixture IDs in teardown.

```ts
import { expect, test } from 'vitest'
import { boundBudgetEvidence } from '@/features/budget-recommendations/snapshot'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

test('limiting evidence never limits the financial aggregate', () => {
  const s = makeBudgetSnapshot()
  s.evidence = Array.from({ length: 2100 }, (_, i) => ({
    ...s.evidence[0], id: i + 1, amount: i + 1,
  }))
  s.evidenceCount.total = 2100
  const bounded = boundBudgetEvidence(s)
  expect(bounded.evidence.length).toBeLessThanOrEqual(2000)
  expect(bounded.evidenceCount).toEqual({ total: 2100, provided: bounded.evidence.length })
  expect(bounded.current).toEqual(s.current)
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(1024 * 1024)
})
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-snapshot.test.ts` and `pnpm test:db tests/integration/budget-recommendation-snapshot.test.ts` — missing snapshot module.
- [ ] **3. Read canonical inputs under the supplied reader.** Add `incomeBasis: { start, end, monthCount }` to the existing budget loader using the variables it already uses for `averageIncome`. No alternate next-month income estimate; next January may have no income basis and must disable AI rather than silently change calculations. All joins filter the joined table's household as well as the base table.

Use `[target-6 months, target+1 month)` for history/current reads. Aggregate every transaction first, separately by month/flow, major/sub and hidden-or-null category. Record six calendar history entries; distinguish `hasRecords=false,state=open` from a genuinely closed zero month. Determine `partial` using `currentMonthInKorea(now)`. Include month revision/state in sourceHash; don't modify month-close services.

For due expense rules use `recurringIsDue`, `recurringPostingDate`, `recurringMemo` from `src/features/recurring/calculations.ts`, `previousKoreanBusinessDay` from `business-days.ts`, and `recurringPostingInMonth` from `posting-identity.ts`. Read posting IDs with the target month identity even if the transaction date was edited. Active due rules only; posted amount is not reserved again. Include overdue-but-unposted expense obligations with their due date, rather than dropping them after that day. Income/saving rules do not inflate the expense floor. Null/hidden-major rules add to unallocatedRecurring.

```ts
const dueDate = recurringPostingDate(input.month, rule.day)
const date = rule.adjustToBusinessDay
  ? await previousKoreanBusinessDay(dueDate) : dueDate
const unposted = postedIds.has(rule.id) ? 0 : rule.amount
// The row major must be in activeMajorNames, otherwise reserve under unallocatedRecurring.
```

Map explicit user planned costs to active majors after `assertBudgetMajors` and compute each row's `floor` with `recommendationFloor(actual, unpostedRecurring, planned)`. The `planned` sum does not include amounts inferred from notes. Initialize `savedRecommendationJobId` to null until Task 6 adds its DB column; that task then reads real provenance. Mark ambiguous manual matches as a limitation in the prompt/report; don't invent posting matches. Pass the same `now` to both canonical readers so a KST month boundary cannot mix income periods inside one snapshot. Complete Task 1's injected-clock contract in `readBudgetData` by passing existing `todayInKorea(now)` to `calculateBudgetPace`; its currently omitted third argument reads the wall clock independently. Cover the supplied-clock behavior in this task's integration tests without changing the pace formula.

- [ ] **4. Bound evidence and compute separate hashes.** Select up to 1000 largest absolute amounts plus 1000 most recent transaction IDs, household/date scoped, stable ties by ID; de-duplicate and interleave the two ranked lists to preserve both objectives. Aggregate total/provided counts separately. If serialized bytes exceed 1MiB, remove evidence from the end until within the limit; fail `input_too_large` if the aggregate-only snapshot still exceeds it. Never truncate titles/notes then claim an exact quote from the untruncated original.

Hash all in-range transaction content (including omitted evidence) in SQL or a bounded paged digest. A SQL digest can be selected through `reader.select` without loading a household's lifetime rows:

```sql
encode(sha256(convert_to(
  coalesce(jsonb_agg(jsonb_build_array(
    t.id, t.date, t.flow, t.amount, t.category_id,
    t.account_id, t.fixed, t.memo, t.raw_merchant, t.recurring_id, t.import_uid
  ) order by t.id), '[]'::jsonb)::text, 'UTF8'
)), 'hex')
```

Apply this only to `transactions t` with `t.household_id = authenticatedHouseholdId` and the analysis date range. Combine it with canonical income basis/target, full category metadata, due-rule definition/posting identity, statuses, pending/unclassified counts and KST date for sourceHash. Income-basis transactions outside the seven-month range must also contribute a digest because they affect the canonical average. BudgetHash includes effective month/default budget amount and provenance. Fingerprint includes sourceHash, budgetHash, notes, planned costs and explicitly labeled unsaved draft. Request ID is not part of the data fingerprint.

- [ ] **5. Add and run green integration cases.** Verify identical canonical ceiling; foreign household excluded; refund reduces actual; saving never increases expense; hidden/null categories retained; posted recurring not duplicated even after date move; final occurrence/end month respected; previous-business-day date; additional cost floor; sparse/open/closed-zero months; omitted evidence edit changes sourceHash; time within one KST day does not, day rollover does; budget edit changes budgetHash, not sourceHash. Run both Task 4 test files and the unchanged existing recurring/budget test suites.
- [ ] **6. Commit.**

```bash
git add src/features/budget-recommendations/snapshot.ts src/features/budgets/queries.ts tests/integration/budget-recommendation-snapshot.test.ts tests/finance/budget-recommendation-snapshot.test.ts
git commit -m "feat: build consistent budget recommendation snapshots"
```

### Task 5: Validate recommendations and their evidence before display

Prompt ownership clarification: the sections below describe the complete resolved prompt, not a requirement to duplicate editable analysis prose inside the immutable policy. Source language/tone and exceptional-spend/true-savings/irregular-fund/reduction emphasis only from the resolved common/task instructions (defaults or explicit replacement, including empty strings). Keep fixed money, evidence, missing/provisional-data interpretation, non-invention, disclosure and output-schema rules in application policy. Changing analysis preferences must not weaken any numeric/evidence validation.

**Files:**
- Create: `src/features/budget-recommendations/report.ts`, `src/features/budget-recommendations/prompt.ts`
- Test: `tests/finance/budget-recommendation-report.test.ts`

**Interfaces:**
- `budgetRecommendationReportSchema` is an exact JSON schema for `BudgetRecommendationReport`.
- `parseBudgetRecommendationReport(value: unknown, snapshot: BudgetRecommendationSnapshot, promptInput?: AiPromptInput | null): BudgetRecommendationReport` throws safe `invalid_output` on any contract failure; instruction references require a valid matching promptInput.
- `budgetPromptPolicy: AiPromptPolicy` and `buildBudgetPromptInput(snapshot: BudgetRecommendationSnapshot, settings: AiSettingsState): AiPromptInput` use Task 2's resolver/freeze function. The policy owns fixed money/evidence/schema restrictions; editable default analysis prose comes from AI_DEFAULTS.
- Consume `evaluateBudget`, `safeBudgetSum`; produce a canonical-order report, not a clamped report.

- [ ] **1. Write failing validation tests.**

```ts
import { expect, test } from 'vitest'
import { parseBudgetRecommendationReport } from '@/features/budget-recommendations/report'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 99_999])('rejects invalid or below-floor amount %s', amount => {
  const report = makeBudgetReport()
  report.rows[0].amount = amount
  expect(() => parseBudgetRecommendationReport(report, makeBudgetSnapshot())).toThrow('invalid_output')
})
test('unknown evidence cannot become a financial justification', () => {
  const report = makeBudgetReport()
  report.rows[0].references = [{ kind: 'transaction', id: 999 }]
  expect(() => parseBudgetRecommendationReport(report, makeBudgetSnapshot())).toThrow('invalid_output')
})
test('over-ceiling totals require an explanation and adjustment candidates', () => {
  const report = makeBudgetReport()
  report.rows[0].amount = 800_000
  expect(() => parseBudgetRecommendationReport(report, makeBudgetSnapshot())).toThrow('invalid_output')
})
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-report.test.ts` — missing parser.
- [ ] **3. Define schema and parser.** All objects use `additionalProperties:false`, every field is required. Limit summary/reason/overCeilingReason/finding text to 2000 chars each; limitations ≤20 strings of ≤500 chars; adjustments ≤20; exceptional/reducible ≤10 each; references ≤30 per list; notes quote ≤200 chars and a nonempty exact substring of `snapshot.input.notes`. Instruction references have exact keys kind/scope/quote, scope common or task, quote1..200 chars appearing in the matching frozen promptInput.instructions text. Reject them if promptInput is absent/wrong kind/hash-invalid; never read current settings to validate historical quotes. Transaction/recurring IDs must be snapshot-owned positive integers; planned IDs must exist in input. `recorded` findings cannot cite only user inputs; `user_provided` findings require a notes/planned/instructions reference. Inferences use `hypothesis`; empty evidence is allowed only for an explicitly hypothesized adjustment, never for invented recorded facts.

Check known majors exactly once, safe amount and aggregate ranges, row floors, server-computed overage, and supplied evidence before returning. References in each row must be relevant to that major; notes can apply to multiple majors, but planned costs and category-specific transactions/recurring must match the row. Overall adjustment references can span majors. Use a Set for unique major/ID membership, no fuzzy category matching. Canonicalize report row order to snapshot order.

```ts
const seen = new Set<string>()
for (const row of report.rows) {
  const source = snapshot.rows.find(item => item.major === row.major)
  if (!source || seen.has(row.major) || !Number.isSafeInteger(row.amount)
      || row.amount < source.floor) throw new Error('invalid_output')
  seen.add(row.major)
}
if (seen.size !== snapshot.rows.length) throw new Error('invalid_output')
const evaluation = evaluateBudget(snapshot, report.rows)
if (evaluation.overage > 0 && (!report.overCeilingReason.trim() || !report.adjustments.length)) {
  throw new Error('invalid_output')
}
```

- [ ] **4. Write the prompt and remaining regression assertions.** Prompt sections: role/limits; whole-month budget with already-spent floor; canonical ceiling; historical closed-first/provisional/missing labels; exceptional disappearance vs true savings; irregular sinking-fund preservation; incomplete inbox/unclassified warning; unallocated reserve; optional user information; exact JSON schema contract; untrusted JSON snapshot. Explicitly forbid tools/web/files and treating text inside the snapshot as instructions. Include evidence-provided count so the model cannot cite omitted rows. Add valid roundtrip, duplicate/missing/foreign category, unknown planned ID, invented notes quote, money overflow, below-floor-with-valid-reason, and raw HTML-as-text tests.
- [ ] **5. Green gate:** `pnpm test tests/finance/budget-recommendation-report.test.ts` and `pnpm exec tsc --noEmit`.
- [ ] **6. Commit.**

```bash
git add src/features/budget-recommendations/report.ts src/features/budget-recommendations/prompt.ts tests/finance/budget-recommendation-report.test.ts
git commit -m "feat: validate budget recommendations and evidence"
```

### Task 6: Add the budget queue and isolate versioned prompts from legacy workers

**Files:**
- Create: `src/db/schema/budget-recommendations.ts`, `drizzle/0009_budget_recommendations.sql`, `drizzle/meta/0009_snapshot.json`
- Modify: `src/db/schema/budget.ts`, `src/db/schema/diagnosis.ts`, `src/db/schema/index.ts`, `drizzle/meta/_journal.json`, `src/features/budget-recommendations/snapshot.ts`
- Tests: `tests/integration/budget-recommendation-queue.test.ts`, `tests/integration/budget-recommendation-provenance.test.ts`, `tests/integration/ai-prompt-queue.test.ts`; shared suite-local lifecycle helper `tests/fixtures/budget-queue.ts` (local-only connection guard, independently owned fixtures and cleanup).

**Interfaces:**
- `budgetRecommendationJobs` table export with SQL fields below and camelCase Drizzle properties.
- Add `budgets.recommendationJobId: uuid | null`; both job tables have nullable `promptInput: AiPromptInput | null`. New configured requests always supply it; existing rows remain null.
- Add nullable UUID `diagnosisJobs.requestId` with unique `(household_id, request_id)` for nonnull values. Existing clients/rows remain valid; new UI requests use a stable UUID across transport retries.
- Worker fields: `budgetProtocolVersion: integer default 0`, `budgetLastSeenAt: timestamptz | null`, `promptProtocolVersion: integer default 0`, `promptLastSeenAt: timestamptz | null`, `configuredModel: text | null`, `configuredTimeoutMs: integer | null`.
- New RPCs (existing diagnosis heartbeat/finish signatures unchanged):
  - `heartbeat_ai_worker(p_token text, p_model text, p_timeout_ms integer) returns boolean`: validates token, model identifier/null and timeout1..300000; records prompt protocol1/liveness and nonsecret configured values. Unknown fields are not accepted.
  - `claim_configured_diagnosis_job(p_token text) returns jsonb`: returns `{ id, claimToken, snapshot, promptInput }`, claiming compatible configured or legacy ledger jobs under the same lease rules.
  - `heartbeat_budget_worker(p_token text) returns boolean` sets protocol 1 and budget liveness.
  - `claim_budget_recommendation_job(p_token text) returns jsonb` (`ClaimedBudgetJob | null`).
  - `heartbeat_budget_recommendation_job(p_token text, p_job_id uuid, p_claim_token uuid) returns boolean`.
  - `finish_budget_recommendation_job(p_token text, p_job_id uuid, p_claim_token uuid, p_report jsonb, p_error_code text) returns boolean`.

- [ ] **1. Write failing database boundary tests.** Use local-only test clients and worker fixtures from `tests/integration/diagnosis-queue.test.ts` as the concrete fixture pattern: create auth users/membership and two households, hash a test-only token, invoke RPC with anon credentials, then delete only fixture households/users. Add raw SQL checks that currently fail because the new table/RPC do not exist:

```ts
// Within the fixture transaction, values are bound parameters, never string interpolation.
const rows = await db.execute(sql`
  select to_regclass('public.budget_recommendation_jobs')::text as name
`)
expect(rows[0].name).toBe('budget_recommendation_jobs')
```

Test that authenticated A cannot SELECT B's job, and neither anon nor authenticated can INSERT/UPDATE/DELETE jobs or workers. Test queued→running→completed, revoked/wrong household token, wrong claim token, expired lease, heartbeats, and stale worker capability.

- [ ] **2. Red gate:** `pnpm test:db tests/integration/budget-recommendation-queue.test.ts tests/integration/budget-recommendation-provenance.test.ts tests/integration/ai-prompt-queue.test.ts` — missing relation/RPC, not production connection errors.
- [ ] **3. Generate the additive schema migration.** Task 2 must already have generated/applied0008; this migration is0009. Recheck journal before `pnpm db:generate --name=budget_recommendations`; inspect the generated files, update this plan if the next index changed, and stop if unrelated schema deletions appear. Add RPC/trigger SQL with `apply_patch` to the generated migration, not a historical migration. Drizzle definitions include checks/indexes/RLS, not only handwritten SQL.

Required SQL table shape:

```sql
CREATE TABLE public.budget_recommendation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  snapshot jsonb NOT NULL,
  prompt_input jsonb,
  fingerprint text NOT NULL,
  report jsonb,
  error_code text,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  claim_token uuid,
  worker_id uuid REFERENCES public.diagnosis_workers(id),
  UNIQUE (household_id, request_id)
);
CREATE UNIQUE INDEX budget_recommendation_one_active
  ON public.budget_recommendation_jobs(household_id, month)
  WHERE status IN ('queued','running');
CREATE INDEX budget_recommendation_queue
  ON public.budget_recommendation_jobs(household_id, status, created_at, id);
ALTER TABLE public.budget_recommendation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.budget_recommendation_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.budget_recommendation_jobs TO authenticated;
CREATE POLICY budget_recommendation_member_select ON public.budget_recommendation_jobs
  FOR SELECT TO authenticated USING (public.is_member(household_id));
```

Add status-shape checks: completed implies nonnull report/completed_at and no error; failed implies allowed error_code and completed_at but no report; queued/running have no report/error; running alone has lease/claim/worker. Snapshot version/month and fingerprint length/hex are checked. Allow errors from existing `DiagnosisErrorCode` only. Use bound result types with `$type<BudgetRecommendationSnapshot>()` / `$type<BudgetRecommendationReport>()` in Drizzle; still validate at runtime.

- [ ] **4. Implement separately named RPCs and immutability.** Use `0005_diagnosis_queue.sql`'s already-hardened token hash lookup, worker row lock, revoked check, household restriction, `FOR UPDATE SKIP LOCKED`, 180-second lease, claim token rotation, and boolean ownership result. The budget claim expires only budget leases and cannot claim a diagnosis job. New functions are `SECURITY DEFINER SET search_path = ''`; fully qualify tables, cryptographic functions and `auth.uid` references. Revoke default function grants then grant EXECUTE to anon/authenticated, exactly as existing token RPCs. `heartbeat_budget_worker` validates the same token, updates budget protocol/liveness even with no queued job, and does not claim work.

`finish_budget_recommendation_job` checks the active owner/lease, requires version 1 JSON object with a rows array for successful completion, and rejects unexpected error codes. The worker's strict parser runs before this call and the application runs it again before display/apply; SQL success is not sufficient to trust model output. Add a trigger preventing changes to household/month/requestId/snapshot/fingerprint/requestedBy on every update, and report changes after terminal completion. Status transitions are only queued→running/failed, running→completed/failed; a terminal job is not reused for rerun.

Capability freshness uses 90 seconds, matching Task 8's ready-state contract. This is separate from the 180-second job lease; an existing compatible worker refreshes presence before claiming after a longer idle gap. Unsupported positive prompt envelope versions remain stored but unclaimed until supported, never stripped or executed as legacy.

Include prompt_input in immutable columns on both job tables, including preventing null→configured changes after insertion. Add SQL envelope version/kind/128KiB checks; JS must also validate render hash before executing/displaying. In this **new** migration redefine legacy `claim_diagnosis_job(p_token)` with its original signature/return and only add `AND prompt_input IS NULL` to the queued-job selection. Its heartbeat/expiry/token handling stays unchanged. `claim_configured_diagnosis_job` selects legacy null or supported prompt version1 with kind ledger, requires a current authenticated prompt-capable worker for configured jobs, and returns promptInput explicitly. Do not overload the old function signature or rewrite0005. Budget claim similarly requires budget capability plus prompt capability for nonnull promptInput and returns the frozen input. Unsupported-version jobs stay unclaimed with upgrade guidance; never strip their input or execute with defaults.

In `ai-prompt-queue.test.ts` enqueue one legacy and one configured ledger job. Old claim must return only the legacy job, then null; after valid `heartbeat_ai_worker`, new claim returns the configured job with the exact stored input. Assert wrong/expired token and mismatched claims cannot finish; attempt to mutate snapshot/prompt_input fails; presence model text cannot contain paths/control characters; heartbeat does not claim work. Preserve household deletion behavior and old report JSON contracts.

Add a FK from `budgets.recommendation_job_id` to jobs with `ON DELETE NO ACTION` (not SET NULL), plus a before INSERT/UPDATE trigger. Its validation body uses this scoped lookup:

```sql
IF NEW.recommendation_job_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.budget_recommendation_jobs j
  WHERE j.id = NEW.recommendation_job_id
    AND j.household_id = NEW.household_id
    AND j.month = NEW.month AND j.status = 'completed'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(j.report->'rows') r
      WHERE r->>'major' = NEW.major
    )
) THEN
  RAISE EXCEPTION 'invalid_budget_recommendation_reference' USING ERRCODE = '23514';
END IF;
RETURN NEW;
```

The trigger function is not executable by anon/authenticated directly. Test forged cross-household/month/category and unfinished references through direct table writes as well as the app. A user-adjusted amount is valid, so do not require stored amount to equal recommendation amount. Deleting a referenced job must fail; deleting an entire fixture household must still cascade cleanly (use NO ACTION, not immediate RESTRICT). Read savedRecommendationJobId into Task 4 snapshots now; before this migration Task 4 initializes it to null because the column did not exist. Extend budgetHash to include provenance.

- [ ] **5. Apply only locally and run green.** Confirm DATABASE_URL host without printing credentials; run `pnpm db:migrate`. Run new queue/provenance integration tests and unchanged `tests/integration/diagnosis-queue.test.ts`. Assert repeated migrations do not rewrite existing data, existing worker/diagnosis RPC signatures still work, active per-month uniqueness holds and same request ID cannot create a second job.
- [ ] **6. Commit.**

```bash
git add src/db/schema/budget-recommendations.ts src/db/schema/budget.ts src/db/schema/diagnosis.ts src/db/schema/index.ts drizzle/0009_budget_recommendations.sql drizzle/meta/0009_snapshot.json drizzle/meta/_journal.json src/features/budget-recommendations/snapshot.ts tests/integration/budget-recommendation-queue.test.ts tests/integration/budget-recommendation-provenance.test.ts tests/integration/ai-prompt-queue.test.ts tests/fixtures/budget-queue.ts
git commit -m "feat: add isolated budget recommendation queue and provenance"
```

### Task 7: One hardened Mac worker, two fair job queues

**Files:**
- Create: `src/features/diagnosis/structured-runner.ts`, `src/features/diagnosis/worker-rpc.ts`, `src/features/diagnosis/lease-job.ts`, `src/features/budget-recommendations/codex-runner.ts`, `src/features/budget-recommendations/worker.ts`
- Modify: `src/features/diagnosis/codex-runner.ts`, `src/features/diagnosis/worker.ts`, `src/features/diagnosis/types.ts`, `scripts/diagnosis-worker.ts`
- Tests: `tests/finance/budget-recommendation-worker.test.ts`, `tests/finance/budget-recommendation-runner.test.ts`, `tests/finance/ai-prompt-worker.test.ts`; keep all existing diagnosis runner/worker tests
- Modify fixture only: `tests/finance/diagnosis-worker.test.ts` foreground-script local RPC server must recognize `claim_configured_diagnosis_job`; retain its legacy adapter coverage and all outcome/security assertions. Unknown-RPC boolean responses are not valid configured claims and must not trigger a production fallback.

**Interfaces:**
- Extract `StructuredRunnerOptions = { codexPath: string; model?: string; signal?: AbortSignal; timeoutMs?: number }`; `runStructuredCodex<T>(input: { prompt: string; schema: object; parse: (value: unknown) => T }, options: StructuredRunnerOptions): Promise<T>`.
- Existing `runCodexDiagnosis(snapshot,options)`, `DiagnosisRunnerError`, `getDiagnosisErrorCode`, `processDiagnosisJob`, `runDiagnosisWorker` remain compatible exports. Move error definition to structured-runner and re-export if necessary; do not create circular imports.
- `createWorkerRpcCaller(config: DiagnosisWorkerConfig, fetcher?: typeof fetch): (name: string, params: Record<string, unknown>) => Promise<unknown>` extracts the current bounded, redacted transport without changing authentication.
- Extend `ClaimedDiagnosisJob` with optional `promptInput?: AiPromptInput | null`, and `CodexDiagnosisOptions` with optional promptInput. `processDiagnosisJob` passes the job's input explicitly; ordinary operator config does not contain it. `runCodexDiagnosis` renders supplied frozen input or, only when null/absent, uses the unchanged legacy builder.
- `ConfiguredDiagnosisRpcClient = DiagnosisRpcClient & { presence(): Promise<boolean> }`; `createConfiguredDiagnosisRpcClient(config: DiagnosisWorkerConfig, fetcher?: typeof fetch): ConfiguredDiagnosisRpcClient` uses configured claim and existing diagnosis heartbeat/finish RPCs.
- `runCodexBudgetRecommendation(snapshot: BudgetRecommendationSnapshot, options: StructuredRunnerOptions & { promptInput: AiPromptInput }): Promise<BudgetRecommendationReport>`.
- `BudgetRpcClient = { presence(): Promise<boolean>; claim(): Promise<ClaimedBudgetJob | null>; heartbeat(job: ClaimedBudgetJob): Promise<boolean>; finish(job: ClaimedBudgetJob, report: BudgetRecommendationReport | null, code: DiagnosisErrorCode | null): Promise<boolean> }`.
- `createBudgetRpcClient(config: DiagnosisWorkerConfig, fetcher?: typeof fetch): BudgetRpcClient` and `processBudgetJob(job: ClaimedBudgetJob, rpc: BudgetRpcClient, options: StructuredRunnerOptions & { heartbeatMs?: number; run?: typeof runCodexBudgetRecommendation }): Promise<'completed' | 'failed' | 'lease_lost'>`.
- `runFinanceWorker(config: DiagnosisWorkerConfig, options?: { once?: boolean; signal?: AbortSignal; pollMs?: number; log?: (event: string, jobId?: string) => void; diagnosisRpc?: ConfiguredDiagnosisRpcClient; budgetRpc?: BudgetRpcClient; diagnosisRun?: DiagnosisJobOptions['run']; budgetRun?: typeof runCodexBudgetRecommendation }): Promise<void>` from diagnosis/worker.ts. Script invokes this new loop; old `runDiagnosisWorker` remains for legacy compatibility/tests.
- `queueOrder(preferred: 'diagnosis' | 'budget'): readonly ('diagnosis' | 'budget')[]` is exported pure scheduler ordering.

- [ ] **1. Write failing fairness and parser tests.**

```ts
import { expect, test } from 'vitest'
import { queueOrder } from '@/features/diagnosis/worker'
test('the preferred queue alternates, with the other queue as fallback', () => {
  expect(queueOrder('budget')).toEqual(['budget', 'diagnosis'])
  expect(queueOrder('diagnosis')).toEqual(['diagnosis', 'budget'])
})
```

Use fake injected RPCs/runners to enqueue D1,D2 and B1,B2, abort after four completions and assert order D1,B1,D2,B2 and maximum one concurrent runner. Add invalid-output fixture from Task 5: finish called with `(job,null,'invalid_output')`, never a completed report. Heartbeat rejection aborts runner and prevents a success write.

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-worker.test.ts tests/finance/budget-recommendation-runner.test.ts tests/finance/ai-prompt-worker.test.ts` — missing runner/scheduler exports.
- [ ] **3. Extract only the execution shell.** Move process spawn/temp files/output schema/bounded event parsing/abort/cleanup from codex-runner to structured-runner. The old adapter supplies existing diagnosis prompt/schema/parser; budget adapter supplies Task 5 equivalents:

```ts
export function runCodexBudgetRecommendation(
  snapshot: BudgetRecommendationSnapshot,
  options: StructuredRunnerOptions & { promptInput: AiPromptInput },
): Promise<BudgetRecommendationReport> {
  const promptInput = parseAiPromptInput(options.promptInput, 'budget', snapshot)
  return runStructuredCodex({
    prompt: renderAiPrompt(promptInput, snapshot),
    schema: budgetRecommendationReportSchema,
    parse: value => parseBudgetRecommendationReport(value, snapshot, promptInput),
  }, options)
}
```

Preserve current `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--strict-config`, read-only sandbox, disabled tools/MCP/search/plugins/memories, environment allowlist, output files' protections, event-type allowlist, no-follow output read, maximum output 1MiB, timeout 180 seconds (hard maximum 300 seconds), process-group termination, and secret-safe errors. Do not reinstall/update Codex or alter operator config. The tests must assert these controls for both adapters rather than merely checking generated text.

- [ ] **4. Implement scheduler, transport and capability heartbeat.**

```ts
export function queueOrder(preferred: 'diagnosis' | 'budget') {
  return preferred === 'diagnosis'
    ? ['diagnosis', 'budget'] as const : ['budget', 'diagnosis'] as const
}
```

Start with diagnosis preferred; try each queue in order, stop claiming as soon as one job is obtained, process it to completion before any new claim, then prefer the other job kind. An empty preferred queue does not delay the other; idle polling is 10 seconds, success processing can immediately check the next queue. A budget RPC unavailable before additive migration disables only the budget branch and logs safe `budget_setup_required`, not a fatal error for diagnosis. Validate claimed snapshot shape and ≤1MiB bound before invoking the runner. Maintain budget worker presence every 30 seconds even while a long diagnosis job runs; clear timer on exit and prevent overlapping presence requests. Job heartbeat remains every 30 seconds, independent of presence. Do not call both claim RPCs concurrently. `once` processes at most one total job, not one per type.

Maintain prompt presence through `heartbeat_ai_worker` on startup and every30s during both job kinds; report only validated configured model/null and actual clamped timeout. Two capability heartbeats have separate meanings but may share one non-overlapping timer. Before claim, register required capabilities. A missing configured-claim RPC can fall back to old claim **only for legacy jobs**, which the DB filter enforces. Never fall back on malformed/unsupported promptInput, generic network errors or bad hashes; fail safely as invalid_output once owned. Hash-validated frozen input is passed through processBudgetJob/diagnosis options, not regenerated from current defaults. Test setting A→B/code-default change between enqueue and execution still runs A; test explicit missing budget input never silently uses default settings.

- [ ] **5. Run green and backward compatibility tests.** Run new tests plus all files found with `rg --files tests | rg 'diagnosis.*(runner|worker)'`. Cover missing budget RPC, old diagnosis payload, empty queues, revoked token, lease loss, timeout, tool event rejection, no secret output, shutdown, and presence remaining fresh during diagnosis. `pnpm exec tsc --noEmit`. Do not restart the user's launchd production worker in this task.
- [ ] **6. Commit.**

```bash
git add src/features/diagnosis/structured-runner.ts src/features/diagnosis/worker-rpc.ts src/features/diagnosis/lease-job.ts src/features/diagnosis/codex-runner.ts src/features/diagnosis/worker.ts src/features/diagnosis/types.ts src/features/budget-recommendations/codex-runner.ts src/features/budget-recommendations/worker.ts scripts/diagnosis-worker.ts tests/finance/budget-recommendation-worker.test.ts tests/finance/budget-recommendation-runner.test.ts tests/finance/ai-prompt-worker.test.ts tests/finance/diagnosis-worker.test.ts docs/superpowers/plans/2026-09-10-ai-budget-planning.md
git commit -m "feat: process budget and ledger AI jobs with one worker"
```

### Task 8: Bind both diagnosis APIs to frozen settings and recoverable requests

Preflight clarification: an expired running budget lease is projected as `failed/lease_expired` on GET using the read transaction's database clock, with no mutation. POST first resolves exact `(householdId,requestId)` and compares normalized input before any expiration or rebuild. Same-ID expired jobs may be terminalized and returned, never requeued. For a new UUID, expire scoped old running jobs transactionally before checking active uniqueness. Changed input/month rejects409 without writes. An intentional retry after terminal failure creates a new UUID.

Preserve the effective budget payload already hashed by Task4 as immutable `snapshot.budgetState: {month:string,current:EffectiveBudgetState[],previous:EffectiveBudgetState[]}`, where each tuple is `{major,amount,sourceMonth,recommendationJobId}`. Keep `hashBudgetPayload(budgetState)` identical to the prior hash payload and include baseline amounts in scalar checks/byte bounds. This additive JSON contract closes the otherwise opaque own-save freshness test; no new table/column or calculation change. Historical snapshots without it can display validated reports, but differing hashes cannot receive an optimistic `applied` exemption. Never retrofit immutable jobs.

Explicit requestId POST responses identify the addressed job even after a newer month job exists: latestJob is the matched/created job; completed is that exact valid completion, or a valid completion preceding that request. Normal GET remains newest job plus most recent valid completion. Unique-race recovery follows the same addressed-job rule; transport retries never rebuild frozen inputs.

**Files:**
- Create: `src/features/budget-recommendations/service.ts`, `src/app/api/budget-recommendations/route.ts`
- Supporting snapshot contract: `src/features/budget-recommendations/types.ts`, `src/features/budget-recommendations/snapshot.ts`, `tests/fixtures/budget-recommendation.ts`, `tests/finance/budget-recommendation-snapshot.test.ts`, `tests/integration/budget-recommendation-snapshot.test.ts`
- Modify: `src/features/diagnosis/queries.ts`, `src/features/diagnosis/prompt.ts`, `src/features/diagnosis/types.ts`, `src/features/diagnosis/client.ts`, `src/app/api/diagnosis/route.ts`
- Tests: `tests/finance/budget-recommendation-route.test.ts`, `tests/integration/budget-recommendation-service.test.ts`, `tests/finance/diagnosis-route.test.ts`, `tests/finance/diagnosis-client.test.ts`, `tests/integration/diagnosis-service.test.ts`, `tests/finance/diagnosis-panel.test.ts`, `tests/finance/diagnosis-ledger-page.test.ts` (last two keep existing behavior assertions and update additive response fixtures)

**Interfaces:**
- `BudgetRecommendationError` with safe `code: string`, `status: 400 | 401 | 403 | 409 | 413 | 503`.
- `requestBudgetRecommendation(householdId: string, userId: string, request: BudgetRequest): Promise<BudgetRecommendationData>`.
- `getBudgetRecommendationData(householdId: string, month: string): Promise<BudgetRecommendationData>`.
- `readApplicableBudgetRecommendation(reader: BudgetReader, householdId: string, month: string, jobId: string, now?: Date): Promise<CompletedBudgetRecommendation>` validates ownership/status/report and current source/budget freshness, returning only verified data or throwing `source_changed`/`budgets_changed`/`invalid_result`.
- API `GET ?month=YYYY-MM`; `POST BudgetRequest`. Both return `BudgetRecommendationData` or `{ error: safeCode }`, private/no-store, Node runtime. No request accepts a household or user ID.
- `readDiagnosisSnapshot(reader: AiSettingsReader, householdId: string, month: string): Promise<DiagnosisSnapshot>` is a mechanical reader extraction in diagnosis/queries.ts; existing `getDiagnosisSnapshot` wrapper retains behavior/calculations. `diagnosisPromptPolicy: AiPromptPolicy` and `buildDiagnosisPromptInput(snapshot: DiagnosisSnapshot, settings: AiSettingsState): AiPromptInput` in diagnosis/prompt.ts leave legacy `buildDiagnosisPrompt` unchanged.
- Existing `requestDiagnosis(householdId: string, userId: string, month: string, requestId?: string): Promise<DiagnosisPageData>` gains optional requestId; the existing route accepts exactly `{month}` or `{month,requestId}`. Existing client helper becomes `requestDiagnosisPageData(month: string, method: 'GET' | 'POST', signal: AbortSignal, requestId?: string): Promise<DiagnosisPageData>`; POST includes the optional UUID, GET remains unchanged, three-argument callers remain valid. The panel wiring in Task 9 owns one UUID per explicit start/rerun intent, including transport retries.
- Extend DiagnosisPageData.completed with optional/null promptInput and add `instructionsChanged: boolean`, `promptSetupRequired: boolean`; keep `isStale` data-only. Legacy completed jobs display no recorded prompt. New fields are additive to public response shape and must be included in updated mocks/fixtures.

- [ ] **1. Write failing API and idempotency tests.** Route tests mock `requireHousehold` and service exports, preserving the actual parser. Add these request boundaries using the same-origin fixture URL `http://localhost:3101`:

```ts
const response = await POST(new Request('http://localhost:3101/api/budget-recommendations', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://outside.invalid' },
  body: JSON.stringify({ requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    month: '2026-10', notes: '', plannedExpenses: [], draftAmounts: [] }),
}))
expect(response.status).toBe(403)
```

Integration fixture inserts current-year income and one expense major so creation is eligible. Same requestId + same normalized input returns the same job after completion; different input with same ID returns 409; a new requestId while active returns 409; new ID after completion creates a new job. Add transaction rollback assertion when snapshot parsing fails.

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-route.test.ts` and `pnpm test:db tests/integration/budget-recommendation-service.test.ts` — missing API/service.
- [ ] **3. Implement transactional creation and recovery.** Use authenticated context's actual user ID from `requireHousehold`. Within a repeatable-read transaction: check existing `(householdId,requestId)` first; compare normalized browser input (not current settings or a newly changed snapshot) for idempotent retries; reject another active job; validate current/next KST month and canonical income >0; call `readAiSettings(transaction,householdId)` and `readBudgetSnapshot(transaction,...)`; call `buildBudgetPromptInput`; insert snapshot/promptInput/requestedBy together. Store the job fingerprint as hash of snapshot.fingerprint plus promptInput.promptHash, while snapshot sourceHash/budgetHash remain financial-only. Unique conflicts are resolved by rereading the exact requestId or returning `active_job_exists`, not silently returning a different-note job. No automatic rerun on failed GET/poll.

GET supports valid past months for saved results, performs no queue creation, and fetches newest job plus most recent valid completed result. Reparse stored report against its stored snapshot. Invalid completed JSON projects that job as failed with existing `invalid_output` errorCode, without DB mutation or applicable suggestions; a specific/applicable-result read rejects with safe `invalid_result`. Do not widen the shared DiagnosisErrorCode union. Newest queued/running/failed job does not erase previous success. Recompute current analytical sourceHash in a consistent read transaction using the saved input; compare sourceHash separately from budgetHash. No wall-clock milliseconds are included.

Pass the stored promptInput to report parsing for every read/save path. Compare only the effective budget instructions hash to current saved settings for `instructionsChanged`; this is an advisory flag, never an AI-apply refusal by itself. Financial-data changes still block apply independently. A report with null promptInput cannot cite instruction references but can retain valid historical facts/amounts.

For ledger creation, extract scoped readDiagnosisSnapshot without changing its math. Read settings/snapshot and freeze prompt inside the same transaction, preserving the existing diagnosisFingerprint(snapshot) for financial staleness. Explicit requestId retries return the original job even after settings change/completion; same ID with a different month rejects409. A different explicit ID while active rejects409 rather than falsely accepting new instructions. Legacy month-only POST keeps its active-job behavior for old callers. Add tests that A is frozen at request, B is saved before execution, and retrieved input remains A; ledger-only/budget-only/common changes affect just the correct instructionsChanged flags. Never backfill null historical input with today's prompt.

New requests require prompt capability; previously capable offline workers may queue with connection-wait copy, never-capable workers require an update. A new web server must not silently enqueue a legacy job when customized execution is unavailable. Old already-queued jobs remain processable. The ledger POST1KiB cap still accommodates month+UUID and remains unchanged; arbitrary prompt/model/household keys are still rejected.

Freshness ordering: source changed → `source_changed`; else the full current AND previous effective budget tuples equal snapshot baseline → `current`; else previous tuples are unchanged, every changed current tuple explicitly comes from the target month and points to this completed job (possibly user-adjusted), unchanged tuples match exactly, and at least one such row exists → `applied`; otherwise `budgets_changed`. Own saves mixed with previous-budget/fallback/provenance/manual drift are not exempt. The applicable reader accepts current/applied only. Source changes disable AI apply/save, but do not disable ordinary manual editing. Applying an already-applied row does not happen implicitly. Existing budget mismatch is presented as a conflict/reload choice, not a demand to alter the savings goal.

- [ ] **4. Capability gate and API security.** Budget worker `ready` means one unrevoked worker supports both budget and prompt protocols≥1 and both last-seen values are within90 seconds; do not combine capabilities from two different workers. Old worker is `upgrade_required`, previously capable stale worker is `offline`, no valid registration is `not_registered`. Offline capable workers may queue with explicit connection-wait copy; old/unregistered workers expose setup guidance and disable new generation. Missing relation/column/RPC during rollout maps to setup_required only for known new schema identifiers, preserving manual budgets and legacy diagnosis access. Other DB errors are not misreported as setup missing.

POST checks exact Origin against request URL, JSON content type, streaming body cap 128KiB independent of Content-Length, exact request keys, and session scope. Missing authentication returns 401; malformed body/month 400; oversized body 413; conflict 409; safe unexpected server error 500. GET has no side effects. Use existing diagnosis route's response/redaction pattern but do not change its current-month-only contract to allow future budget months.

- [ ] **5. Green gate.** Test missing income (including future January), this/next eligibility across December rollover, arbitrary past GET, extra `householdId`/model fields, wrong origin, body bytes cap, revoked worker, setup missing vs unexpected failure, source/draft/budget hash distinctions and own-save applied detection. Run both new test files plus existing diagnosis-route and diagnosis-service tests and `pnpm exec tsc --noEmit`.
- [ ] **6. Commit.**

```bash
git add src/features/budget-recommendations/service.ts src/app/api/budget-recommendations/route.ts src/features/diagnosis/queries.ts src/features/diagnosis/prompt.ts src/features/diagnosis/types.ts src/features/diagnosis/client.ts src/app/api/diagnosis/route.ts tests/finance/budget-recommendation-route.test.ts tests/integration/budget-recommendation-service.test.ts tests/finance/diagnosis-route.test.ts tests/finance/diagnosis-client.test.ts tests/integration/diagnosis-service.test.ts tests/finance/diagnosis-panel.test.ts tests/finance/diagnosis-ledger-page.test.ts src/features/budget-recommendations/types.ts src/features/budget-recommendations/snapshot.ts tests/fixtures/budget-recommendation.ts tests/finance/budget-recommendation-snapshot.test.ts tests/integration/budget-recommendation-snapshot.test.ts
git commit -m "feat: expose recoverable budget recommendation requests"
```

### Task 9: Settings editor, read-only execution details and exact prompt previews

**Files:**
- Create: `src/features/ai-settings/preview.ts`, `client.ts`, `settings-form.tsx`, `prompt-viewer.tsx` under the same directory; `src/app/api/ai-settings/route.ts`
- Modify: `src/features/ai-settings/types.ts`, `service.ts` under the same directory; `src/app/settings/page.tsx`, `src/components/settings-nav.tsx`, `src/features/diagnosis/diagnosis-panel.tsx`
- Tests: `tests/finance/ai-settings-route.test.ts`, `tests/finance/ai-settings-form.test.tsx`, `tests/integration/ai-settings-preview.test.ts`, `tests/e2e/ai-settings.spec.ts`

**Interfaces:**
- `AiSettingsPageData = { settings: AiSettingsState; defaults: Record<keyof AiSettingsValues,string>; workers: AiWorkerView[]; budgetPreviewAvailable: boolean }`.
- `AiPromptPreview = { kind: AiKind; month: string; prefix: string; dataJson: string; suffix: string; promptHash: string; instructions: ResolvedAiInstructions; generatedAt: string; unsaved: boolean }`.
- `AiJobPromptView = { state: 'recorded'; preview: AiPromptPreview } | { state: 'unrecorded'; kind: AiKind; month: string }`.
- `getAiSettingsPageData(householdId: string): Promise<AiSettingsPageData>` / `getAiWorkerViews(householdId: string): Promise<AiWorkerView[]>` in service.ts; SELECT only explicitly allowed worker columns, never tokenHash.
- `previewAiPrompt(householdId: string, input: { kind: AiKind; month: string; values: AiSettingsValues }): Promise<AiPromptPreview>` and `getAiJobPrompt(householdId: string, kind: AiKind, jobId: string): Promise<AiJobPromptView>` in preview.ts.
- `GET /api/ai-settings` returns AiSettingsPageData. `POST` exact discriminated bodies: `{action:'save',settings:AiSettingsSave}`, `{action:'preview',kind,month,values:AiSettingsValues}`, `{action:'job-prompt',kind,jobId}`; returns saved AiSettingsState / AiPromptPreview / AiJobPromptView respectively. Bound128KiB streamed body, authenticate household, verify Origin/content type, private/no-store, safe errors. No queue/model/file parameters accepted.
- Client exports `loadAiSettings(signal?:AbortSignal)`, `submitAiSettings(input:AiSettingsSave,signal?:AbortSignal)`, `requestAiPromptPreview(input:{kind:AiKind;month:string;values:AiSettingsValues},signal?:AbortSignal)`, `loadAiJobPrompt(kind:AiKind,jobId:string,signal?:AbortSignal)` with matching promised result types above.
- `AiSettingsForm({initial}:{initial:AiSettingsPageData})`, `AiPromptViewer({view}:{view:AiJobPromptView | {state:'preview';preview:AiPromptPreview}})`.

- [ ] **1. Write failing route/UI/side-effect tests.** Static tests assert three labeled instruction inputs, no editable model/timeout field, default/custom labels and restore buttons. Route tests prove hostile origin403, extra model/prefix/household fields400, actual oversized stream413, foreign job invisible. Integration test records fixture settings revision and both queue row counts before/after preview; all remain identical.

```ts
// Playwright, using an authenticated local fixture household:
await page.goto('/settings?section=ai')
await page.getByLabel('공통 분석 지침', { exact: true }).fill('설명은 짧게, 육아 지출을 중점적으로 봐 주세요.')
await page.getByRole('button', { name: '프롬프트 미리보기', exact: true }).click()
await expect(page.getByText('미저장 편집안 기준', { exact: false })).toBeVisible()
await page.getByRole('button', { name: 'AI 설정 저장', exact: true }).click()
await expect(page.getByText('AI 설정을 저장했습니다.', { exact: true })).toBeVisible()
await page.reload()
await expect(page.getByLabel('공통 분석 지침', { exact: true }))
  .toHaveValue('설명은 짧게, 육아 지출을 중점적으로 봐 주세요.')
```

- [ ] **2. Red gate:** run `pnpm test tests/finance/ai-settings-route.test.ts tests/finance/ai-settings-form.test.tsx`, `pnpm test:db tests/integration/ai-settings-preview.test.ts`, `pnpm e2e tests/e2e/ai-settings.spec.ts` — route/controls missing.
- [ ] **3. Implement read-only previews using the same builders.** Inside a repeatable-read transaction, parse submitted values and resolve them as an unsaved settings candidate; call readDiagnosisSnapshot or readBudgetSnapshot directly, not getDiagnosisPageData (which expires leases). Empty month-specific notes/planned/draft for settings budget preview are explicit in the UI. Validate month/positive income/data existence as corresponding generation permits; lack of worker connectivity does not prevent inspecting valid data, since preview never invokes it. Build frozen input with buildDiagnosisPromptInput/buildBudgetPromptInput, split the exact rendered result into prefix/dataJson/suffix, and return the hash. Display generatedAt and note that later changes can alter a later request.

`getAiJobPrompt` SELECTs exact kind/table/id/household; null input yields unrecorded, nonnull input is parsed and rendered using stored snapshot only. Wrong household is not_found without disclosing existence. Do not turn old null records into a reconstructed current prompt. Large/invalid frozen input returns safe unavailable copy. Render prefix/suffix read-only and dataJson in collapsed `<details>`, plain text with wrapping; no raw HTML, arbitrary Markdown links or evaluated templates.

- [ ] **4. Build shared settings UI and diagnostic notices.** Add `ai` to SettingsSection and menu `/settings?section=ai`; settings page loads only the active section's data. In AiSettingsForm keep raw nullable values distinct from displayed effective default text: editing changes to a custom string; restore sets null in draft, doesn't save other fields; empty custom remains empty. Saved revision is adopted only for the submitted draft, not later edits. Show cross-window conflict with current vs my values and keep local input. No router refresh/remount per save. Read-only worker rows show label/status/capabilities/configured model or CLI 기본값, actual reported timeout, and last-seen timestamp. Never infer a concrete model from null or expose config paths/tokens. Refreshing worker info must not overwrite dirty inputs.

Add ledger panel's settings link and used-prompt viewer for active/completed jobs. `instructionsChanged` copy is separate from isStale, and never hides the prior report or its persistent rerun button. Set promptSetupRequired guidance without claiming that unsupported custom instructions ran successfully. In-flight preview/viewer requests use AbortController and month/kind/job generation guards; late responses cannot replace the currently selected preview. Save/preview state uses aria-live; preview button cannot trigger settings form submission accidentally. All controls labeled; keyboard details accessible; mobile390px and dark tokens preserved.

Ledger start/rerun generates crypto.randomUUID once and passes it as the fourth requestDiagnosisPageData argument. Keep it through a POST timeout/network retry; clear only after a definitive response/terminal state or an explicit new rerun intent. A month switch abandons only local polling/intent, not the server job. Test timeout→settings edit→retry returns the original job, while completed→explicit rerun creates a new ID and uses current settings.

- [ ] **5. Green gate and evidence.** Run all four task test files and tsc. E2E: restore is draft-only; empty vs default; stale revision conflict; preview changes neither queue nor settings; common edits affect both kinds; budget-only edit leaves ledger notice unchanged; queued A remains A after saving B; unsupported worker guidance, old job unrecorded; new/legacy prompt viewer; mobile no page overflow, no duplicated panels. Screenshot settings at desktop/mobile/dark via testInfo.outputPath, not outputs/.
- [ ] **6. Commit.**

```bash
git add src/features/ai-settings/preview.ts src/features/ai-settings/client.ts src/features/ai-settings/settings-form.tsx src/features/ai-settings/prompt-viewer.tsx src/features/ai-settings/types.ts src/features/ai-settings/service.ts src/app/api/ai-settings/route.ts src/app/settings/page.tsx src/components/settings-nav.tsx src/features/diagnosis/diagnosis-panel.tsx tests/finance/ai-settings-route.test.ts tests/finance/ai-settings-form.test.tsx tests/integration/ai-settings-preview.test.ts tests/e2e/ai-settings.spec.ts
git commit -m "feat: edit AI instructions and preview frozen diagnosis prompts"
```

### Task 10: One safe save path with optimistic concurrency and AI provenance

Call-site preflight: `app/budgets/page.tsx` explicitly lists BudgetForm props, so it must pass the new baseline/targetVersion props as part of this task (not wait for Task12). Existing planning-query and page-render unit fixtures must add/mock these new reader values while preserving their canonical ceiling/month-status assertions. This is necessary wiring for the approved single-save path, not extra UI scope.

Parallel execution refinement: implement/review the pure `save-contract.ts` and its unit tests ahead of server work in a separate `feat/ai-budget-draft` worktree, commit `feat: define budget save patch contract`, then let Task11 consume that real contract. This does not complete Task10: its transaction/CAS/actions/UI/integration work remains gated on Task8. No temporary stubs or concurrent owners for the contract file.

**Files:**
- Create: `src/features/budgets/save-contract.ts`, `src/features/budgets/save-service.ts`
- Modify: `src/features/budgets/actions.ts`, `src/features/budgets/review-actions.ts`, `src/features/budgets/planning-queries.ts`, `src/features/budgets/budget-form.tsx`, `src/app/budgets/page.tsx`
- Tests: `tests/finance/budget-save-contract.test.ts`, `tests/integration/budget-actions.test.ts`, `tests/integration/budget-recommendation-save.test.ts`, `tests/finance/budget-planning.test.ts`, `tests/finance/month-status-pages.test.tsx`

**Interfaces:**
- `BudgetBaseline = { major: string; amount: number; recommendationJobId: string | null; version: string }`.
- `BudgetSaveRequest = { month: string; changes: { major: string; amount: number; recommendationJobId: string | null; expectedVersion: string }[]; targetChange: { value: number; expectedVersion: string } | null; acknowledgeOverage: boolean }`.
- `BudgetSaveResult = { rows: BudgetBaseline[]; savingsTarget: number; targetVersion: string; total: number; overage: number }`.
- `parseBudgetSaveRequest(value: unknown): BudgetSaveRequest`, `readBudgetBaselines(reader: BudgetReader, householdId: string, month: string): Promise<{ rows: BudgetBaseline[]; savingsTarget: number; targetVersion: string }>` and `saveBudgetChanges(householdId: string, request: BudgetSaveRequest): Promise<BudgetSaveResult>`.
- `readBudgetSaveEvaluation(reader: BudgetReader, householdId: string, month: string, amounts: { major: string; amount: number }[], target?: number): Promise<BudgetEvaluation>` in save-service.ts performs lightweight money aggregation without building model evidence or requiring AI availability.
- `BudgetActionState = { error?: string; code?: string; saved?: BudgetSaveResult }`; preserve `saveBudgetPlan(previousState, FormData)` signature, reading a single JSON `payload` field. `saveBudgetReview` delegates to the same action or returns a refresh-required error for obsolete payloads; no legacy unguarded writer remains.

- [ ] **1. Write failing partial-write tests.** Extend existing budget action fixture with 식비/교통 and foreign household budgets. Initial authoritative baselines come from `readBudgetBaselines`, never a client-chosen version. First save only 식비; assert 교통 and foreign records unchanged and no `settings` write when targetChange=null. A second save with the stale pre-first-save version and different amount must fail without changing any row. Assert exact won `723693`, reject fractions/negative amounts, all-or-nothing errors, duplicate identical submission succeeds without duplicate rows.

```ts
const before = await readBudgetBaselines(db, context.householdId, '2026-09')
const food = before.rows.find(row => row.major === '식비')!
const request: BudgetSaveRequest = {
  month: '2026-09', changes: [{ major: food.major, amount: 723_693,
    recommendationJobId: null, expectedVersion: food.version }],
  targetChange: null, acknowledgeOverage: true,
}
const saved = await saveBudgetChanges(context.householdId, request)
expect(saved.rows.find(row => row.major === '식비')?.amount).toBe(723_693)
await expect(saveBudgetChanges(context.householdId, {
  ...request, changes: [{ ...request.changes[0], amount: 700_000 }],
})).rejects.toThrow('budget_conflict')
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-save-contract.test.ts` and `pnpm test:db tests/integration/budget-recommendation-save.test.ts` — missing save service.
- [ ] **3. Implement strict patch/CAS contract.** Exact JSON keys, valid month, ≤500 unique active majors, safe integer amounts, nullable valid UUID provenance, nonempty version hashes, target integer 0..80 or null, boolean acknowledgment. Version hashes include actual stored month row presence/id/amount/provenance and the fallback `'*'` row when used; an absent explicit budget is not equal to explicit zero. targetVersion hashes the settings row's presence and raw value; default 30 does not falsely equal an explicit stored 30 for concurrency purposes. Return opaque SHA256 hashes, not a capability token.

Use a serializable DB transaction. Read current relevant budget rows/settings and effective amounts, locking stored rows before comparison; serialize app saves per `(householdId,month)` with a transaction advisory lock and acquire a household settings lock for explicit target changes in a consistent order. Re-read baselines in this transaction. If all requested amounts/provenance and target already equal current state, return a no-op result for duplicate submission. Otherwise require expectedVersion for every changed row and any explicit target change; ignore untouched rows in CAS but use their current amounts in aggregate evaluation. An insert that loses the unique-key race becomes `budget_conflict`, not unconditional overwrite. Map SQL serialization failure to a conflict/refetch response rather than replaying stale user intent automatically.

- [ ] **4. Validate AI references and overage atomically.** Group changed rows by recommendationJobId. Call `readApplicableBudgetRecommendation` with this same transaction for each nonnull ID; confirm same household/month, row present, report valid and current sources. Ignore any client reason strings (parser rejects them). User-adjusted AI amounts remain allowed; they are displayed as user adjustment, not the original recommendation, and all finite/nonnegative integer checks still apply. Recommendation generation floors constrain AI's proposal, not a manually adjusted user's ability to save an explicitly acknowledged tighter plan.

Compute the final mixed draft total with `readBudgetSaveEvaluation` using current untouched rows, changed amounts and unallocated reserve from scoped aggregate queries. Its source reads are canonical budget data plus signed null/hidden-category expense and due/unposted expense-rule amounts using existing posting identity. It does not require a model snapshot, evidence-size limit, worker, positive income, or holiday calendar lookup; historical/manual budget saving must remain independent of AI eligibility. Reuse `safeBudgetSum` and existing savings-rate math. Use `spendingCeilingForTarget` for an explicit manual target change; otherwise canonical ceiling is unchanged. Require acknowledgment when final total exceeds ceiling. A save containing AI-derived rows and targetChange is rejected `save_target_first`; saving the target is an explicit manual action that makes prior AI reports stale. On success upsert changed rows only, writing amount/provenance together; update settings only for targetChange. Revalidate `budgets` after commit, not before.

```ts
for (const change of request.changes) {
  await transaction.insert(budgets).values({
    householdId, month: request.month, major: change.major,
    amount: change.amount, recommendationJobId: change.recommendationJobId,
  }).onConflictDoUpdate({
    target: [budgets.householdId, budgets.major, budgets.month],
    set: { amount: change.amount, recommendationJobId: change.recommendationJobId },
  })
}
// This loop runs only after transaction-scoped CAS and reference checks.
```

A manual saved-row edit retains existing AI origin unless user explicitly chooses manual draft/copy-average/copy-previous. That distinction is a nullable provenance field in the changed-row payload, validated on the server. If stale AI origin blocks saving, offer an explicit `수동 초안으로 전환` action instead of silently dropping evidence.

- [ ] **5. Wire current manual form and close old save entrypoint.** `getBudgetPlanningData` includes baselines/targetVersion. Read displayed budget/review values and CAS baselines/targetVersion in one repeatable-read, read-only transaction using `readBudgetData`, `readBudgetReviewData`, and `readBudgetBaselines`, sharing the same clock and resolved month. Do not pair older displayed values with a newer version token from an independently timed read. Preserve existing reader wrappers and canonical calculations. The form submits only dirty rows and explicit targetChange; on success adopt returned baselines without remounting/resetting scroll/details. Existing `saveBudgetReview` accepts the new payload via the same service; an old form's missing payload returns `예산 화면을 새로 열어 변경사항을 확인해 주세요.` and writes nothing. Update prior `budget-actions.test.ts` expectations to the new result contract while retaining exact-won, household, invalid-input, and target-save assertions. Search `rg -n 'insert\(budgets\)|update\(budgets\)' src` and remove any bypass among production action writers.
- [ ] **6. Green gate.** Run the three task test files, Task 6 provenance integration tests and `pnpm exec tsc --noEmit`. Test two concurrent saves, missing/fallback baseline, partial preservation, same-amount duplicate submit, source changed since recommendation, target changed, wrong/unfinished/foreign job, user adjustment origin, explicit manual conversion, partial failure rollback, overage confirmation with untouched rows changed in another window.
- [ ] **7. Commit.**

```bash
git add src/features/budgets/save-contract.ts src/features/budgets/save-service.ts src/features/budgets/actions.ts src/features/budgets/review-actions.ts src/features/budgets/planning-queries.ts src/features/budgets/budget-form.tsx src/app/budgets/page.tsx tests/finance/budget-save-contract.test.ts tests/integration/budget-actions.test.ts tests/integration/budget-recommendation-save.test.ts tests/finance/budget-planning.test.ts tests/finance/month-status-pages.test.tsx
git commit -m "feat: save budget changes with conflict and provenance checks"
```

### Task 11: Draft-only selection and abortable recommendation recovery

May run in parallel with Tasks6–8 in an isolated worktree after the Task10 pure patch contract above. API transport is exercised with deterministic mocks against the fixed response interface; combined server/UI integration remains a later gate. Its four paths do not overlap the SQL, worker, or API implementation paths.

**Files:**
- Create: `src/features/budgets/draft.ts`, `src/features/budget-recommendations/client.ts`
- Tests: `tests/finance/budget-draft.test.ts`, `tests/finance/budget-recommendation-client.test.ts`

**Interfaces:**
- `BudgetDraftRow = { major: string; amount: string; recommendationJobId: string | null }`.
- `BudgetDraft = { rows: BudgetDraftRow[]; baseline: BudgetBaseline[]; selected: string[]; undoRows: BudgetDraftRow[] | null }`.
- `createBudgetDraft(baseline: BudgetBaseline[]): BudgetDraft`.
- `budgetDraftReducer(state: BudgetDraft, action: BudgetDraftAction): BudgetDraft` with exact actions below.
- `draftBudgetAmounts(state: BudgetDraft): { major: string; amount: number }[]` rejects invalid in-progress strings instead of coercing them to zero.
- `draftBudgetChanges(state: BudgetDraft): BudgetSaveRequest['changes']` returns only amount/provenance changes with baseline versions.
- `getBudgetRecommendations(month: string, signal?: AbortSignal): Promise<BudgetRecommendationData>` and `startBudgetRecommendation(request: BudgetRequest, signal?: AbortSignal): Promise<BudgetRecommendationData>` call the Task 8 endpoint.
- `pollBudgetRecommendations(month: string, options: { signal: AbortSignal; onData: (value: BudgetRecommendationData) => void; onError: (code: string) => void; fetchData?: typeof getBudgetRecommendations; intervalMs?: number }): Promise<void>`.
- `checkRecommendationForApply(month: string, jobId: string, signal?: AbortSignal): Promise<CompletedBudgetRecommendation>` re-fetches current data and rejects if completed ID changed, sources/budgets changed, or result invalid.

Reducer action contract:

```ts
export type BudgetDraftAction =
  | { type: 'edit'; major: string; amount: string }
  | { type: 'select'; majors: string[] }
  | { type: 'apply'; completed: CompletedBudgetRecommendation }
  | { type: 'fill'; amounts: { major: string; amount: number }[] }
  | { type: 'manual'; majors: string[] }
  | { type: 'undo' }
  | { type: 'saved'; rows: BudgetBaseline[] }
```

- [ ] **1. Write failing selection/provenance tests.**

```ts
import { expect, test } from 'vitest'
import { createBudgetDraft, budgetDraftReducer, draftBudgetChanges } from '@/features/budgets/draft'
import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import { makeBudgetReport, makeBudgetSnapshot } from '../fixtures/budget-recommendation'

test('nothing is selected; applying one category preserves all other manual values', () => {
  let state = createBudgetDraft([
    { major: '식비', amount: 350_000, recommendationJobId: null, version: 'food-v1' },
    { major: '교통', amount: 90_000, recommendationJobId: null, version: 'travel-v1' },
  ])
  expect(state.selected).toEqual([])
  state = budgetDraftReducer(state, { type: 'edit', major: '교통', amount: '80000' })
  state = budgetDraftReducer(state, { type: 'select', majors: ['식비'] })
  const snapshot = makeBudgetSnapshot()
  const report = makeBudgetReport()
  state = budgetDraftReducer(state, { type: 'apply', completed: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', completedAt: '2026-09-10T01:00:00Z',
    snapshot, promptInput: null, report, evaluation: evaluateBudget(snapshot, report.rows),
  } })
  expect(state.rows.map(row => row.amount)).toEqual(['300000', '80000'])
  state = budgetDraftReducer(state, { type: 'edit', major: '식비', amount: '310000' })
  expect(draftBudgetChanges(state).find(row => row.major === '식비')?.recommendationJobId)
    .toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  state = budgetDraftReducer(state, { type: 'manual', majors: ['식비'] })
  expect(state.rows[0].recommendationJobId).toBeNull()
})
```

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-draft.test.ts tests/finance/budget-recommendation-client.test.ts` — missing reducer/client.
- [ ] **3. Implement immutable draft actions.** Selection doesn't affect amount or DB. Apply is permitted only after `checkRecommendationForApply` succeeds in the UI, but save still verifies on server. Preserve selection-independent UI expansion/scroll outside the reducer. Apply stores an immutable undo snapshot and clears selection. Edit retains provenance. Fill/copy/manual explicitly clear provenance only for affected rows. Undo restores the preceding rows and their origins. Saved adopts authoritative baselines and clears undo/selection without a route remount; never apply a server acknowledgment to edits made after the submitted draft (disable save and editing during its short transaction, or compare the submitted draft revision before adoption).

Core apply branch:

```ts
case 'apply': {
  const selected = new Set(state.selected)
  const recommendations = new Map(action.completed.report.rows.map(row => [row.major, row.amount]))
  return {
    ...state, undoRows: state.rows.map(row => ({ ...row })), selected: [],
    rows: state.rows.map(row => selected.has(row.major) && recommendations.has(row.major)
      ? { ...row, amount: String(recommendations.get(row.major)), recommendationJobId: action.completed.id }
      : row),
  }
}
```

No reducer action for a newly completed report: result arrival changes displayed recommendations only. Draft changes must not mark analytical sourceHash stale. Mixed totals use `draftBudgetAmounts`, not the whole AI report's total.

- [ ] **4. Implement client cancellation and recovery.** Use fetch no-store, a combined caller abort + 15-second timeout, safe typed response checking including exact requested month, and no sensitive error text. A POST timeout retains its UUID for explicit retry; only an intentional rerun after a terminal job creates a new UUID. Poll at 5 seconds with capped 30-second retry backoff. On queued/running keep polling, on completed/failed return after delivering data, on abort clear every timeout and ignore late responses. A poll HTTP/network error preserves prior successful data and sends a non-destructive inline error. Check response month after every awaited fetch, not just before request. `checkRecommendationForApply` requires current/applied freshness and matching ID; applied rows aren't automatically selected again.
- [ ] **5. Green tests.** Fake fetch/fake timers: abort before response, old month response ignored, one active polling loop, timeout retry same requestId, rerun new requestId, previous completed data retained while queued, failed response doesn't erase draft, invalid integer edit blocked before submit, per-row selection/all/none, partial mixed total, copied row clears origin, undo origin and amounts, save result doesn't overwrite newer edits. Run both new tests and `pnpm exec tsc --noEmit`.
- [ ] **6. Commit.**

```bash
git add src/features/budgets/draft.ts src/features/budget-recommendations/client.ts tests/finance/budget-draft.test.ts tests/finance/budget-recommendation-client.test.ts
git commit -m "feat: keep AI budget selection separate from saved budgets"
```

### Task 12: Integrate recommendations, reasons and safe apply into the single editor

**Files:**
- Create: `src/features/budget-recommendations/panel.tsx`, `src/features/budgets/budget-row.tsx`
- Modify: `src/features/budgets/budget-form.tsx`, `src/features/budgets/planning-queries.ts`, `src/features/budget-recommendations/service.ts`, `src/app/budgets/page.tsx`
- Tests: `tests/finance/budget-recommendation-panel.test.tsx`, `tests/e2e/budget-recommendations.spec.ts`

**Interfaces:**
- `getSavedBudgetRecommendations(householdId: string, month: string): Promise<CompletedBudgetRecommendation[]>` loads all distinct referenced jobs for this month's saved rows with one scoped join/query, validates reports, and returns reasons even if a newer result exists. It does not require a past saved result to be freshly applicable. Skip invalid reports in this returned list; the form identifies a missing saved job ID and displays unavailable-evidence copy without dropping the budget or breaking manual editing.
- `BudgetRecommendationPanel({ month, majors, basis, targetDirty, getDraftAmounts, onData }: { month: string; majors: string[]; basis: BudgetRecommendationSnapshot['basis']; targetDirty: boolean; getDraftAmounts: () => BudgetInput['draftAmounts']; onData: (data: BudgetRecommendationData) => void })` owns optional notes/cost inputs and request/recovery state. The parent owns editable rows/selection. Supply stable active-major names from canonical parent rows; do not derive selector options from `getDraftAmounts`, which must still reject invalid in-progress monetary input. Call that serializer only while preparing a request/evaluation.
- `BudgetRow({ row, baseline, source, recommendation, origin, selected, onSelect, onEdit, onManual }: { row: BudgetDraftRow; baseline: BudgetBaseline; source: BudgetSourceRow | null; recommendation: BudgetRecommendationReport['rows'][number] | null; origin: { jobId: string; recommendedAmount: number; reason: string; references: BudgetReference[] } | null; selected: boolean; onSelect: (selected: boolean) => void; onEdit: (amount: string) => void; onManual: () => void })` renders amount/origin/reason accessibly. Resolve origin using the draft row's recommendationJobId in the validated saved/current report map; the latest recommendation may differ from that origin. Never accept browser-provided reason text for persistence.

- [ ] **1. Write failing static and browser tests.** `budget-recommendation-panel.test.tsx` uses `renderToStaticMarkup` for row headings, explicit `원`/whole-month/remaining labels, safe text rendering and accessible buttons. E2E fixture logs into a local test household and intercepts only `/api/budget-recommendations` with deterministic Task 3 snapshot/report data. Its core behavior assertion is:

```ts
await page.goto('/budgets?month=2026-09')
await page.getByRole('button', { name: 'AI 예산 추천', exact: true }).click()
await expect(page.getByText('추천 완료', { exact: true })).toBeVisible()
await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('350000')
await expect(page.getByRole('checkbox', { name: '식비 추천 선택', exact: true })).not.toBeChecked()
await page.getByRole('checkbox', { name: '식비 추천 선택', exact: true }).check()
await page.getByRole('button', { name: '선택한 추천 가져오기', exact: true }).click()
await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('300000')
await expect(page.getByText('아직 저장하지 않은 편집안입니다.', { exact: true })).toBeVisible()
```

Use a mocked KST date for deterministic availability (Playwright clock installed before navigation) or choose fixture month dynamically from current KST; server-side availability fixtures in the full-stack test use dynamic current month too. Do not make the suite expire after September 2026.

- [ ] **2. Red gate:** `pnpm test tests/finance/budget-recommendation-panel.test.tsx` and `pnpm e2e tests/e2e/budget-recommendations.spec.ts` — UI controls missing.
- [ ] **3. Wire state without a second editor.** `BudgetForm` uses Task 11 reducer. Panel is nested with `key={'budget-recommendation:' + month}`; keep keys distinct from month-close/editor siblings. On month change abort all previous requests/polling and reset local unsaved state for the new month. No `router.refresh()` on every row select/edit. Recovery runs once per month, not every input change. A completed result updates read-only recommendation data and clears stale selection for an older job; it never dispatches apply/edit. Stable callbacks/ref-based request ownership prevent effect loops.

Inputs show saved basis/goal/ceiling, optional notes textarea maxlength4000, planned cost add/remove rows ≤30 with active-major selector, exact-won money input and note maxlength200. Explain that planned amounts are additional, not already recorded or included in recurring. If targetDirty, show `저축 목표를 먼저 저장해 주세요.` and disable AI start. Unsaved valid draft amounts are sent as context; invalid in-progress amounts get inline validation, not zero coercion.

Show actual queue states: connection wait, queued, analysis running, validated completion, failed/retry. No fabricated percentage or separate “검증 중” phase that the protocol does not expose. Offline/upgrade/setup explanations do not block manual editor. Keep `다시 추천하기` visible after completion and the previous report visible during rerun. When sources change, show `기록이 변경되어 재추천이 필요합니다.` and disable AI apply; offer explicit manual conversion for edited AI-origin rows. Budget conflicts show current vs draft values with reload/compare, not a full-page error.

Add `AI 진단 설정` link to `/settings?section=ai` and use Task 9's loadAiJobPrompt/AiPromptViewer for active/completed job input. Display instructionsChanged separately: `이전 지침으로 만든 추천입니다.` with optional rerun, not a financial-data stale error or apply block. Render instruction references as `설정에서 제공한 정보` using frozen promptInput, not current settings. Changing global settings must not reset this month's draft/selection or mutate a pending job.

- [ ] **4. Render selection, reasons, totals and saved provenance.** Above the existing table show AI summary/limitations and full-proposal total clearly distinct from editable-draft total. Checkboxes default none; allow all/none and chosen-row apply via `checkRecommendationForApply`, then reducer. Button disabled during freshness check and for invalid results. Show pending/unclassified warnings, evidence limits, unallocated actual, overage/projected rate and adjustment candidates. Current month rows show signed actual and `앞으로 배정한 금액`; future month rows show whole budget without fake elapsed pace. Display original AI amount and user-adjusted amount separately.

Reasons use click/keyboard `<details>` with one-time candidates labeled `추정`/`확인 필요`, reductions, recurring/date evidence, notes explicitly `사용자 제공`, and links to existing ledger filters/transaction evidence UI (inspect existing diagnosis evidence links for exact current route params). Do not invent query parameter names or execute HTML from a report. Popups, if used, are viewport-clamped and Escape-dismissable; ordinary details do not require pointer hover. Use saved job report lookup to show historical reason after reload even if latest recommendation differs. If a stored result cannot be validated, show `이 추천의 근거를 확인할 수 없습니다.` and disable reuse without deleting the stored budget.

Save presents confirmation when the actual mixed draft exceeds ceiling; acknowledgment is explicit and resets whenever draft/target changes. On success adopt returned baseline and render `저장됨`/`적용됨`, preserving scroll and opened reasons. `aria-live="polite"` for progress/save outcomes. Manual goal save is an explicit existing save action, not part of recommendation start/apply.

- [ ] **5. Mobile/dark/preview verification.** Reuse finance spacing/type/color tokens. Rows are CSS grid cards on narrow screens, one semantic DOM per row (avoid duplicate accessible controls in hidden mobile tables); comparison values collapse in details. At width390, `document.documentElement.scrollWidth <= innerWidth`; keyboard focus visible, all inputs labeled, reasons accessible without hover. Retain Task 1 previews for previous/average/review/simulator fills, explicit confirmation before replacing affected dirty rows, and one-step undo. Capture local artifacts under Playwright's test output directory, not the other session's `outputs/`.
- [ ] **6. Green gate.** Run Task 12 unit/E2E, existing period/amount/month-status tests, `pnpm lint`, `pnpm exec tsc --noEmit`. Inspect actual browser at desktop and mobile in light/dark. Test result arriving while typing, selected subset, undo, user-adjustment provenance, save/reload old reason, rerun while retaining prior result, absent income, offline worker, month switches and no duplicated panels.
- [ ] **7. Commit.**

```bash
git add src/features/budget-recommendations/panel.tsx src/features/budgets/budget-row.tsx src/features/budgets/budget-form.tsx src/features/budgets/planning-queries.ts src/features/budget-recommendations/service.ts src/app/budgets/page.tsx tests/finance/budget-recommendation-panel.test.tsx tests/e2e/budget-recommendations.spec.ts
git commit -m "feat: review and apply AI recommendations in the budget editor"
```

### Task 13: End-to-end persistence, compatibility checks and deployment handoff

**Files:**
- Create: `tests/e2e/budget-recommendation-persistence.spec.ts`, `tests/smoke/budget-recommendation.ts`, `docs/ai-budget-planning-runbook.md`
- Modify only as needed for new regression coverage: `tests/e2e/budget-recommendations.spec.ts`, `tests/integration/budget-recommendation-service.test.ts`, `tests/integration/budget-recommendation-save.test.ts`

**Interfaces:**
- Exercise production API/action/RPC contracts as written. The model runner alone is deterministic test input; no test-only production endpoint or RLS bypass is introduced.
- Screenshot artifacts: `budget-planning-desktop.png`, `budget-planning-mobile.png`, `budget-planning-dark.png` using `testInfo.outputPath(...)`.
- Runbook documents local/production separation, capability gate, migration/worker/web order, verification and rollback.

- [ ] **1. Write the failing full-stack workflow test.** Reuse local auth/member fixture pattern in `tests/e2e/month-close.spec.ts`; all SQL is household-scoped to generated fixture IDs and teardown deletes only those IDs. Generate current/next month from KST at runtime. Create baseline income/expenses/budgets, use real API POST to enqueue, claim using a fixture worker token, inject `makeBudgetReport()` adjusted only to actual snapshot IDs/majors/floors, finish via the actual new RPC, and let browser poll the real GET. No production Mac token or actual model needed.

Test old review redirect target → optional inputs → queued → completed (no automatic save) → select one → adjust amount → save → reload → same user-adjusted amount/origin/reasons → regenerate while retaining old report. Add a second browser context that changes a budget before first context saves; assert conflict and no silent overwrite. Add a new fixture transaction after recommendation; AI apply/save must show stale while manual conversion/save works.

```ts
await page.getByLabel('식비 예산', { exact: true }).fill('310000')
await page.getByRole('button', { name: '변경사항 저장', exact: true }).click()
await expect(page.getByText('저장됨', { exact: true })).toBeVisible()
await page.reload()
await expect(page.getByLabel('식비 예산', { exact: true })).toHaveValue('310000')
await page.getByRole('button', { name: '식비 추천 이유', exact: true }).click()
await expect(page.getByText('사용자 조정', { exact: true })).toBeVisible()
await page.screenshot({ path: testInfo.outputPath('budget-planning-desktop.png'), fullPage: true })
```

If using `<summary>` instead of a button, give it an explicit accessible role/button name consistently in Task 12 and the test. Do not change tests to broad text matches that also match hidden duplicates.

- [ ] **2. Red gate:** `pnpm e2e tests/e2e/budget-recommendation-persistence.spec.ts` — assert the intended missing persistence/concurrency behavior before any corrections, not an unrelated login timeout. If all prior task implementations already satisfy it, record that it is an additional integration acceptance test that passed first run; do not manufacture a failure.
- [ ] **3. Add edge acceptance tests and exact runbook.** Cover manual-only when no worker, old worker capability, failed job/new-ID retry, completed-ID retry remains idempotent, previous report while rerunning, next month partial previous-month history, past read-only recommendations, December→January no-income basis, missing and closed-zero months, delayed response after navigation, single editor/panel identity, narrow viewport/dark mode. Capture mobile/dark screenshots and inspect them. Confirm existing ledger diagnosis can still enqueue/complete independently and scheduler never holds two simultaneous leases.

Runbook commands for local checks:

```bash
supabase status
pnpm db:migrate
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm test:db
pnpm build
pnpm e2e
```

Before `supabase status`, sanitize what is reported to the user (do not paste service keys). Before migration/test/E2E, inspect only DB/API URL hostname for loopback; abort if remote. Run a separate real CLI adapter smoke with synthetic data, not a production queue. Add `tests/smoke/budget-recommendation.ts` using the following imports/body and execute `pnpm exec tsx tests/smoke/budget-recommendation.ts`. It reads only the configured executable/model from the existing protected config; it never sends worker credentials or connects to a queue/DB. RPC/queue completion is covered by the preceding local full-stack test. If CLI configuration/authentication isn't available, report this smoke check separately as not run; deterministic coverage does not prove live model generation.

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadDiagnosisWorkerConfig } from '../../src/features/diagnosis/worker'
import { runCodexBudgetRecommendation } from '../../src/features/budget-recommendations/codex-runner'
import { parseBudgetRecommendationReport } from '../../src/features/budget-recommendations/report'
import { buildBudgetPromptInput } from '../../src/features/budget-recommendations/prompt'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

async function main() {
  const config = await loadDiagnosisWorkerConfig(join(homedir(), '.config', 'finance-web', 'diagnosis-worker.json'))
  const snapshot = makeBudgetSnapshot()
  const promptInput = buildBudgetPromptInput(snapshot, { revision: 0, updatedAt: null,
    commonInstructions: null, ledgerInstructions: null, budgetInstructions: null })
  const report = await runCodexBudgetRecommendation(snapshot, { codexPath: config.codexPath, model: config.model, promptInput })
  parseBudgetRecommendationReport(report, snapshot, promptInput)
  process.stdout.write('budget_recommendation_smoke_passed\n')
}
main().catch(() => {
  process.stderr.write('budget_recommendation_smoke_failed\n')
  process.exitCode = 1
})
```

Approval-only production runbook (do not execute in this task): capture recoverable DB backup → apply additive0008(settings) and0009(queues/prompt compatibility) → update the existing Mac worker from a verified checkout and confirm both protocols/liveness → deploy web → wait for Vercel Ready → authenticated manual/settings/AI preview smoke test → user-selected saving only. Record commit, migrations, worker version, deployment ID and outcomes. Rollback hides/disables new AI UI or reverts web/worker to compatible version; retain additive tables, frozen instructions and saved provenance rather than deleting financial data. Manual budgets and legacy diagnosis remain usable; configured jobs wait for a supporting worker and are never downgraded by stripping promptInput.

- [ ] **4. Final fresh gates and review.** Run all six commands listed above; record counts/durations and failure details, not historical totals. Inspect `git diff --check`, all household predicates, exact staged paths and dependency changes. Use `superpowers:requesting-code-review` before integrating the completed feature; resolve concrete issues and rerun affected gates. No merge/push/deploy is implied by this plan. Report any real CLI smoke limitation separately from unit/DB/E2E status.
- [ ] **5. Commit.**

```bash
git add tests/e2e/budget-recommendation-persistence.spec.ts tests/e2e/budget-recommendations.spec.ts tests/integration/budget-recommendation-service.test.ts tests/integration/budget-recommendation-save.test.ts tests/smoke/budget-recommendation.ts docs/ai-budget-planning-runbook.md
git commit -m "test: verify unified AI budget planning end to end"
```

## Self-review / spec traceability

| Approved budget spec | Implementation and evidence |
| --- | --- |
| §1–3 unified screen, preserve manual workflows | Task 1; Task 12 one editor, references and fill previews |
| §4 current/next AI, one target month, draft selection/adjustment | Tasks 3, 8, 11–12; redirect/default/month-rollover E2E |
| §5 unchanged money formulas, signed actual, recurring, hidden/unclassified, bounded history | Tasks 3–4; snapshot integration, aggregate and overflow tests |
| §6 schema, floors, evidence, explanation not invented | Task 5; Task 7 worker parser; Tasks 8–10 server revalidation |
| §7 isolated queues, one fair worker, recovery/idempotency, stale separation | Tasks 6–8, 11; lease/capability/fairness/late-response tests |
| §8 partial CAS saves, user adjustment/origin, overage, unchanged target | Tasks 6, 8, 10–13; persisted reasons and two-window/stale E2E |
| §9 isolation, RLS/RPC, source text untrusted, redirects | Tasks 1, 4–8; foreign-household, request boundary, protected provenance tests |
| §10 Swiss Ledger/mobile/dark/accessibility/no flicker | Tasks 11–13; screenshots, overflow, keyboard and panel-identity E2E |
| §11 all existing and new tests, deterministic model, separate smoke | Each task red/green gate; Task 13 final six gates and live-smoke reporting |
| §12 implementation vs production approval | Global constraints, Task 13 runbook; no automatic production writes |

| Approved AI settings spec | Implementation and evidence |
| --- | --- |
| §1–3 common/ledger/budget editing, defaults, real read-only preview | Tasks 2, 9; empty/null, CAS, preview no-side-effect and settings E2E |
| §4 protected math/schema/permissions, user-provided instruction evidence | Tasks 2, 5, 7–8, 12; hash/quote/tool/amount validation tests |
| §5 persisted revision and frozen input within limits | Tasks 2, 6–8; same input across settings/code changes and JSONB reorder |
| §6 separate instruction/data change, preserve reports and old unrecorded prompts | Tasks 8–9, 12; targeted hash, legacy viewer and rerun tests |
| §7 capability isolation, read-only model, legacy/new compatibility | Tasks 6–9; old/new claim, long-job presence, missing model and secret tests |
| §8 focused ownership/shared execution once | File map and Tasks 2, 7–9; no generic job platform or duplicate runner |
| §9 regression/security/browser gates | Each task's tests; Task 13 six final gates plus synthetic CLI smoke |
| §10 scope/deployment boundary | Global constraints and Task 13 approval-only runbook |

Self-review covers all13 numbered tasks, exact consumers/producers, both migrations, affected old fixtures, prompt-input threading through worker/read/save/preview, all explicit-path commit lists, and no unresolved task-number references. Document checks do not imply runtime tests have been run.

No application code is implemented by this document. During execution check off steps only after observed results and keep each task's evidence with its commit.

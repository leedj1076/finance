# Budget Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 C2 `항목 | 예산 | 참고` 편집기를 구현한다.

**Architecture:** 기존 예산 로더·저장 서비스와 AI API 계약을 유지한다. 서버의 별도 참고 읽기 모델을 클라이언트 초안과 결합하고, 초안·추천 요청·목록·상한·근거를 책임별로 나눈다. 기존 UI 호출부는 새 컴포넌트 조립 때까지 컴파일 가능한 상태로 단계적으로 전환한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle, Supabase, Vitest, Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-11-budget-editor-redesign-design.md`

## Global Constraints

- 저장 계약(`BudgetSaveRequest`)·서버 저장 서비스·AI 워커·스냅샷 계약·DB 스키마는 바꾸지 않는다. 마이그레이션 없음.
- 모든 Drizzle 조회는 `householdId` 범위. 서비스 롤 키·워커 토큰은 서버에만.
- AI 값을 넣기 전 `checkRecommendationForApply`를 반드시 거친다. 행의 `recommendationJobId`로만 AI 출처를 표시한다. 금액이 같다는 이유로 AI라고 표시하지 않는다.
- 어떤 채우기도 저장 전에는 DB를 바꾸지 않는다. 손댄 행이 덮어써질 때는 확인 팝오버.
- 색·타입·간격은 `src/app/globals.css` 토큰과 `t-*` 클래스만 쓴다. 원시 `text-[Npx]`, 임의 hex, 둥근 모서리, 이모지 아이콘 금지. 아이콘은 인라인 SVG.
- 문구는 스펙과 목업의 한국어를 그대로. 임의로 바꾸지 않는다.
- `NODE_OPTIONS=` 접두어로 node/pnpm을 실행한다.
- 작업 단위마다 명시한 경로만 `git add`하고 커밋한다. 다른 작업의 파일은 건드리지 않는다.
- 각 작업의 완료 게이트: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`.
- 승인된 설계를 다시 하지 않는다. 불명확한 세부 구현은 가장 단순한 쪽으로 결정하고 기록한다.

## Task interfaces and transitional boundaries

`BudgetPlanRow`는 스펙 §8.1의 필드를 그대로 가지며, 비정기 캡션의 지출 월을 정확히 표시하기 위해 `average3.spendMonths?: string[]`를 화면용 보조 필드로 추가한다. `getBudgetPlanningData`는 기존 결과에 `planRows: BudgetPlanRow[]`를 추가한다. 순수 함수 `initialSource(row, completedJobId, recommendedAmount?)`는 저장된 출처 ID와 현재 추천액을 비교한다. 추천액은 클라이언트 GET 결과에서 공급한다. `calculateAverage3`의 입력은 후보 월, 거래 존재 월, 대분류 월합계, 마감 상태이며 결과는 `BudgetPlanRow['average3']`다.

`BudgetSource = 'previousBudget' | 'previousActual' | 'average3' | 'ai'`; 초안 `source`는 이 타입 또는 null이다. `choose`는 `{major, amount, source, recommendationJobId}`를, `fill`은 같은 형태의 행 배열을 받는다. 새 API가 기존 호출부를 깨뜨리는 작업은 호출부도 최소한으로 옮기며 최종 조립에서 임시 UI를 제거한다.

`CeilingBar`는 금액·목표·dirty/pending/disabled·목표 변경 콜백을 받는 프레젠테이션 컴포넌트다. `PlanItem`은 계획 행·초안 행·현재/저장 추천·선택/수정 콜백을 받는다. `PlanList`는 묶음·전체 채우기 확인·실행 취소 표시를 맡고 AI 확인 자체는 폼의 한 경로에서 수행한다. `PlanToolbar`는 네 출처 채우기와 추천 상태·대화상자·요약 열기만 맡는다. `useBudgetRecommendation`는 기존 패널의 상태·요청·복구·폴링·입력 검증을 그대로 옮기고 대화상자와 도구 줄이 사용할 컨트롤러를 반환한다.

### Task 1: 참고 읽기 모델과 순수 계산

**Files:** Create `src/features/budgets/plan-calculations.ts`, `src/features/budgets/plan-sources.ts`, `tests/finance/budget-plan-calculations.test.ts`, `tests/integration/budget-plan-sources.test.ts`; modify `src/features/budgets/planning-queries.ts`, `tests/finance/budget-planning.test.ts`.

**Interfaces:** Produces `BudgetPlanRow`, `BudgetSource`, `calculateAverage3`, `initialSource`, `differenceCaption`, `readBudgetPlanRows`, `planRows`. Uses `readMonthStatuses` and baseline versions; `review-queries.ts` remains unchanged.

- [x] Write failing tests: target October/current September yields August/July/June candidates, no-record month excluded from denominator and months, income-only month counts with zero major expense, fewer than three months supported, roundLikePython ties, provisional status, irregular spend count; initial AI requires matching ID AND amount; historical first match wins; zero cannot select.
```ts
expect(differenceCaption(131700, 120000)).toBe('+11,700 초과')
expect(differenceCaption(380000, 380000)).toBe('예산과 같음')
```
- [x] Run `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/budget-plan-calculations.test.ts` and capture RED.
- [x] Implement household-scoped history aggregation for the latest three ended calendar months before both target and current month. Filter candidate months by any household transaction, divide each major by retained month count, default absent major to zero, reuse review.previousActual. Use the same `now` and repeatable-read transaction. Add seeded integration cases including cross-household isolation and current previous-month partial date.
```ts
const upper = month < currentMonth ? month : currentMonth
const candidates = [1, 2, 3].map(offset => shiftMonth(upper, -offset))
```
- [x] Run focused tests, task gate, and `NODE_OPTIONS= pnpm test:db` when Docker is available. Log blocked DB execution without claiming a pass.
- [x] Commit only the six task paths with `feat(budgets): add reference planning read model`.

### Task 2: 출처 기반 초안과 전체 채우기 판정

**Files:** Modify `src/features/budgets/draft.ts`, `tests/finance/budget-draft.test.ts`, temporary call sites in `src/features/budgets/budget-form.tsx`; add `src/features/budgets/plan-fill.ts`, `tests/finance/budget-plan-fill.test.ts`.

**Interfaces:** `createBudgetDraft(baseline, plan?, completedJobId?, recommendedAmounts?)`; `choose`, `fill`, `edit`, `undo`, `rebase`, `saved`; `overwrittenDraftRows(draft, choices)` yields only dirty rows whose amount/provenance would change.

- [x] Replace select/apply/manual tests with choose clearing historical provenance, AI choose setting ID, edit retaining provenance while clearing source, fill and one undo, source ignored by save payload, dirty rebase retaining invalid input. Test fill confirmation excludes unchanged desired values and includes provenance-only edits.
```ts
expect(draftBudgetChanges({ ...draft, rows: draft.rows.map(row => ({ ...row, source: 'previousBudget' })) })).toEqual([])
```
- [x] Run focused draft/fill tests and record RED.
- [x] Implement the specified reducer. Preserve source across a successful save when it describes the same row; initialize newly loaded rows from plan. Move legacy checkbox selection into temporary form-local state and translate its actions into choose/fill, so reducer has no deprecated actions while the old view compiles until Task 7.
- [x] Run task gate; commit explicit task files with `refactor(budgets): track chosen draft sources`.

### Task 3: 고정 상한 줄

**Files:** Create `src/features/budgets/ceiling-bar.tsx`, `tests/finance/budget-ceiling-bar.test.tsx`; modify `src/features/budgets/plan-calculations.ts`, `src/app/globals.css`.

**Interfaces:** Export `CeilingBar` and relocate unchanged `spendingCeilingForTarget` calculation to plan-calculations; leave old simulator export until removal. Props expose target, income basis, total/null, ceiling, dirty/pending/disabled and target callback.

- [x] Add render/calculation tests for unchanged canonical ceiling, changed target ties, zero income, invalid total, dirty save vs disabled 저장됨, slider 0–80 and arithmetic explanation.
```ts
expect(spendingCeilingForTarget({ averageIncome: 1001, initialSavingsTarget: 30, savingsTarget: 50, serverSpendCeiling: 701 })).toBe(500)
```
- [x] Run focused tests to RED; implement sticky 56px offset, 52px bar, accessible target popover, desktop and compact mobile labels from §6–7 using existing type/color tokens.
- [x] Run task gate; commit explicit paths with `feat(budgets): add sticky ceiling and savings control`.

### Task 4: 참고 목록과 전체 채우기 UI

**Files:** Create `src/features/budgets/plan-toolbar.tsx`, `plan-list.tsx`, `plan-item.tsx`, `tests/finance/budget-plan-item.test.tsx`, `tests/finance/budget-plan-list.test.tsx`; modify `src/app/globals.css`.

**Interfaces:** Consume plan rows, draft state, fill choices, recommendation data, callbacks. Keep evidence content injectable until Task 5. Source choices include source/amount/jobId; the form checks AI before producing choices.

- [x] Add RED render tests for four source buttons, unavailable zero strike-through/disabled, selected SVG and aria-pressed, partial and provisional captions, current-only usage, manual/AI-adjusted captions including saved job date, confirmation n and each before/after amount, keep-edited/cancel/all and undo actions.
```ts
expect(html).toContain('줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다')
expect(html).toContain('고친 항목은 두기')
```
- [x] Implement 200px/200px/flexible columns, three groups and four reference lines. Source selection uses the draft source, never numerical coincidence during a session. Saved missing origins display the exact warning. Toolbar exposes four fill buttons plus AI state actions; confirmation includes only rows that would be overwritten.
- [x] Run focused tests and task gate; commit the task files with `feat(budgets): build reference list and fill controls`.

### Task 5: 추천 훅·요청 대화상자·근거

**Files:** Create `src/features/budget-recommendations/use-recommendation.ts`, `src/features/budgets/ai-request-dialog.tsx`, `src/features/budgets/ai-evidence.tsx`, `tests/finance/budget-recommendation-controls.test.tsx`, `tests/finance/budget-ai-evidence.test.tsx`; modify `plan-toolbar.tsx`, `plan-item.tsx` as necessary. Keep old panel only until Task 7.

**Interfaces:** `useBudgetRecommendation` consumes month, majors, canonical basis, targetDirty, getDraftAmounts and optional onData; returns request/restore/poll state plus bounded input controls and prompt loader. Dialog receives controller/open/onClose; evidence receives complete saved/current recommendation context and checked-apply callback.

- [x] Port request-error and controls tests before implementation, preserving timeout/ambiguous classification, exact frozen request UUID retry and stale request cancellation. Add tests for escaped reason/references, finding labels, prior-job origins, summary counts and prompt links.
```ts
expect(classifyBudgetRecommendationRequestError(new Error('request_timeout')).ambiguous).toBe(true)
```
- [x] Run focused tests for RED. Extract existing panel ownership logic without relaxing validation. Native dialog opens from toolbar, closes on successful start, leaves editing available during queued/running; month remount discards inputs. Notes 4000 and planned rows 30 with 200-char notes. Implement every §5.3 status, retry and status recovery, old-instructions marker, evidence and summary popovers with prompt viewer.
- [x] Run task gate; commit explicit paths with `feat(budgets): move AI requests and evidence into dialogs`.

### Task 6: 390px 목록 점검

**Files:** Modify `ceiling-bar.tsx`, `plan-toolbar.tsx`, `plan-list.tsx`, `plan-item.tsx`, `ai-request-dialog.tsx`, `ai-evidence.tsx`, `src/app/globals.css` only where responsive verification requires it; create `tests/finance/budget-editor-mobile.test.tsx`.

**Interfaces:** Same components and callbacks as desktop, breakpoint ≤640px; no separate card/data hierarchy.

- [x] Add responsive markup verification for a 150px input container, four-line 84/84/flexible/16 reference layout and mobile fill menu accessible controls.
```ts
expect(html).toContain('전체 채우기')
expect(html).not.toContain('type="radio"')
```
- [x] Implement/verify 36px mobile reference rows, wrapped reason, two-line ceiling and no clipped dialogs. Compare provided 390px PNG and source; visual runtime verification continues in Task 8 after page assembly.
- [x] Run task gate; commit changed explicit paths with `fix(budgets): fit reference editor at mobile widths`.

### Task 7: 폼·페이지 조립과 구 UI 삭제

**Files:** Modify `src/features/budgets/budget-form.tsx`, `src/app/budgets/page.tsx`, related finance form rendering tests and `tests/e2e/fixtures/budget-save-lifecycle.tsx`; optionally create `src/features/budgets/use-plan-recommendations.ts` for checked apply/provenance ownership if necessary to keep form <300 lines. Delete `src/features/budgets/simulator.tsx`, `budget-reference.tsx`, `budget-row.tsx`, `src/features/budget-recommendations/panel.tsx` and obsolete tests/imports in `tests/finance/budget-review.test.ts`, `budget-recommendation-panel*.test.tsx`.

**Interfaces:** BudgetForm consumes `planRows`, baselines, basis, savedRecommendations and canonical target values. Preserve BudgetSaveRequest/actions/services, conflict refresh and pending submission protection.

- [x] Update render tests for future KPI/CTA suppression, current-only pace, absence of old sections, no automatic AI apply, checked apply ID matching and provenance retention, save lifecycle fixtures.
- [x] Run focused tests for RED. Assemble ceiling/toolbar/list/dialog/evidence. Central checked AI path must use only returned verified amounts, cancel on unmount, reject stale/changed IDs and targetDirty/active work, freeze controls during check/save, and recheck AI fill if confirmation is delayed. Recover initial source when current recommendation first loads only on untouched rows, never overwrite amounts.
```ts
const verified = await checkRecommendationForApply(month, jobId, controller.signal)
// Build choices from verified.report.rows, never the pre-check report.
```
- [x] Remove obsolete views and imports, retain review reader/calculations and redirect, relocate ceiling tests. Keep simulator-calculations.ts solely as a re-export of spendingCeilingForTarget from plan-calculations.ts, because protected save-service.ts imports this path. Remove obsolete simulator tests in tests/integration/simulator.test.ts while retaining loader/ceiling assertions at their appropriate locations. Check form line count <300 and forbidden protected-file diffs empty.
- [x] Run task gate; commit explicit touched paths with `refactor(budgets): assemble the reference editor`.

### Task 8: 브라우저 회귀와 화면 캡처

**Files:** Modify `tests/e2e/budget-recommendations.spec.ts`, `budget-recommendation-persistence.spec.ts`, `budget-save-lifecycle.spec.ts`, relevant budget cases in existing E2E; create `tests/e2e/budget-editor.spec.ts` and result screenshots under `docs/design/budget-editor/result/`. Runtime screenshot finding: permit a scoped `src/app/globals.css` desktop grid-track fix (and `plan-item.tsx` only if CSS cannot preserve the shared hierarchy) so input captions sit directly below inputs, with a browser bounding-box regression.

**Interfaces:** Real browser controls via accessible names; existing local Supabase/test fixtures and intercepted AI transport. Never use production household data for mutation.

- [x] Port existing E2E assertions first to expose changed selectors and behaviors; preserve ambiguous POST recovery, stale apply, provenance persistence, conflict and pending-save coverage.
- [x] Add four §12 flows: reference→manual→save/reload initial match; dirty whole-fill→keep edits→undo; AI dialog/request/wait and stale disabled rows; mobile 390 tap/menu. Use native button aria-pressed to assert selection.
```ts
await page.getByLabel('식비 예산').fill('600000')
await expect(page.getByText('직접 입력', { exact: true }).first()).toBeVisible()
```
- [ ] Run `NODE_OPTIONS= pnpm e2e` with available local DB, task gate, `NODE_OPTIONS= pnpm test:db`, `NODE_OPTIONS= pnpm build`. Record actual counts and failures, not inferred results. Save 1440px desktop and 390px mobile screenshots and compare against PNGs. **Partial:** task gate, build, 30 standalone browser cases and screenshots passed; DB/full-stack execution remains blocked by manually paused Docker.
- [x] Commit explicit test/result paths with `test(budgets): cover reference editor workflows`.

### Task 9: 운영 설명과 최종 검증 기록

**Files:** Modify `docs/ai-budget-planning-runbook.md`; create `docs/design/budget-editor/result/verification.md`; update checkboxes in this plan.

**Interfaces:** Runbook describes new UI without changing worker/server operational instructions.

- [x] Search runbook for removed checkbox/apply/manual/panel flows and replace with four reference lines, request dialog, overwrite confirmation, provenance and undo rules.
- [x] Write verification record with command counts, blocked checks, screenshot comparison, independently chosen details, deleted files and replaced tests. Record HTML browser policy restriction and supplied PNG inspection accurately.
- [ ] Verify no broken local references, protected contracts unchanged, `git diff --check`; run task gate. Use final code review and finishing-a-development-branch skill; keep branch local unless user requests integration. **Partial:** fresh tsc/lint/80 files·698 unit/30 standalone browser gate passed; DB-backed gate remains blocked and final whole-branch review belongs to the controller after this commit.
- [x] Commit explicit documentation paths with `docs(budgets): describe the reference editor workflow`.

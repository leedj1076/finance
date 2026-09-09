# Monthly Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household explicitly close a whole month and show only unchanged, closed months in annual statistics.

**Architecture:** PostgreSQL maintains a per-household/month revision in the same transaction as ledger mutations. Closing compares the reviewed revision; the report reads eligibility and transactions from one consistent snapshot. Live ledger/home/budget calculations remain unchanged and gain provisional labels.

**Tech Stack:** Next.js 15, React 19, Drizzle/PostgreSQL/Supabase, Chart.js 4, Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-monthly-close-design.md`

## Global Constraints

- `/report`는 마감한 월만 집계한다. 미마감은 0원이 아니다.
- 수입·지출·저축 정의, 순저축률, 반올림, 페이스·예측 산식, 자산 잔액, 가져오기 지문·분류 방식은 바꾸지 않는다.
- 한국 시간 기준으로 **끝난 월만** 마감할 수 있다.
- 서버의 모든 Drizzle 쿼리에도 householdId 조건을 유지한다.
- 로그인 사용자의 ID를 사용하며 폼의 가구 ID·사용자 ID는 신뢰하지 않는다.
- 이번 설계의 기본 마이그레이션에는 자동 과거 마감을 넣지 않는다.
- 화면 전체 로딩·스크롤 초기화는 만들지 않는다.
- Production migration, merge, push and deployment require a separate user request. Test only against the verified local database. Preserve unrelated untracked files.

## Workspace and verification

Continue the approved design branch in the current checkout (no worktree consent received). The tasks are sequentially coupled; execute inline and obtain an independent final review. Baseline: `pnpm test:all` — 74 files, 507 passing tests on 2026-09-09.

Responsibility map: `month-close/state.ts` owns serializable eligibility types, `queries.ts` consistent summaries/statuses, `service.ts` compare-and-close/reopen, `actions.ts` authentication/cache boundary, `month-close-control.tsx` interaction, schema/migration database invariants. `analytics/stats-report.ts` owns the closed-only report read model; existing arithmetic modules remain pure. Existing report/chart/table files consume explicit month eligibility. Mutation messages use one helper, not repeated state rules.

### Task 1: Atomic month revision and close service

**Files:** Create `src/db/schema/month-close.ts`, `src/features/month-close/{state,queries,service}.ts`, `tests/finance/month-close.test.ts`, `tests/integration/month-close.test.ts`; modify schema exports; generate `drizzle/0007_monthly_close.sql` and matching metadata.

**Interfaces:**
- Produces `MonthCloseState = 'open' | 'closed' | 'needs_review'`.
- Produces `MonthStatus { month: string; revision: number; closedRevision: number | null; closedAt: string | null; state: MonthCloseState }`.
- Produces `getMonthStatuses(householdId: string, months: string[]): Promise<MonthStatus[]>` with explicit missing-month open status.
- Produces `getMonthCloseSummary(householdId: string, month: string): Promise<MonthCloseSummary>` where summary extends MonthStatus with count, income, expense, saving, pendingCount, unclassifiedCount, unpostedRecurringCount, closable and requiresAcknowledgment.
- Produces `closeMonth(householdId: string, userId: string, input: { month: string; revision: number; acknowledgeWarnings: boolean; acknowledgeEmpty: boolean }): Promise<{ok: boolean; error?: string}>`, `reopenMonth(householdId: string, month: string): Promise<{ok: boolean; error?: string}>`.

- [x] **1. Write state and integration tests before implementation.** Use literal cases for open/closed/invalidated, valid month and current-month refusal. Integration seeds a household and transaction, obtains a summary, closes it, edits the amount and asserts `needs_review`. Assert a no-op update retains `closed`, movement invalidates both months, rollback retains revision, duplicate import skip does not invalidate, conflicting close requests cannot certify unseen changes, an empty ended month closes only with explicit acknowledgment, and household cascade deletion succeeds.

```ts
expect(monthCloseState({ revision: 2, closedRevision: 1, closedAt: '2026-09-09T00:00:00Z' })).toBe('needs_review')
expect(monthCloseState({ revision: 0, closedRevision: 0, closedAt: '2026-09-09T00:00:00Z' })).toBe('closed')
```

- [x] **2. RED:** `pnpm test -- tests/finance/month-close.test.ts` and `pnpm test:db -- tests/integration/month-close.test.ts`; new module/table absent, then behavior failures before fixes.
- [x] **3. Implement table and trigger.** Composite household/month key, month check, nonnegative monotonic revision, nullable closing record. AFTER statement triggers use transition tables and sorted distinct keys for each statement, skip non-meaningful updates with `IS DISTINCT FROM`, and increment on actual inserted/deleted rows only. A security-definer trigger function has fixed search_path, no client EXECUTE, and checks existing household before upsert (cascade safe). Revoke authenticated/anon writes to the new table; enable member-only SELECT RLS. No historical close/backfill of transactions. Local migration only after hostname verification.

```ts
export function monthCloseState(row: { revision: number; closedRevision: number | null; closedAt: string | null }): MonthCloseState {
  if (!row.closedAt) return 'open'
  return row.closedRevision === row.revision ? 'closed' : 'needs_review'
}
```

- [x] **4. Implement consistent repeatable-read summary and conditional close.** Aggregate the entire month, not ledger filters/limit. Count pending inbox, uncategorized transactions and due/unposted recurring rules using existing schedule/UID semantics. In close transaction ensure a state row exists, lock it, reject changed expected revision, recompute current warnings and require explicit acknowledgment, persist server user ID. A concurrent writer either precedes this check or invalidates after it. Reopen clears closedRevision while retaining history. Invalid month/revision fails cleanly.
- [x] **5. GREEN:** focused tests plus RLS test exercising authenticated direct-write rejection and other household read isolation, deterministic close/write lock race, sorted multi-month bulk update and rollback. `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test:all`, `pnpm build`.
- [x] **6. Commit exact task files:** `feat(month-close): add atomic ledger revisions and closing service`.

### Task 2: Closed-only consistent report data and tooltip boundary

**Files:** Create `src/features/analytics/stats-report.ts`, `tests/finance/closed-report.test.ts`, `tests/integration/closed-report.test.ts`; modify `analytics/report.ts`, `analytics/category-detail.ts`, `src/app/api/cell-tx/route.ts`, relevant report integration fixtures.

**Interfaces:**
- Consumes Task 1 MonthStatus and ledgerMonths schema.
- Produces `getStatsReportData(householdId: string, requestedYear?: number)` containing `report`, `monthly`, `accountMonthly` (expense/income/saving), `details`, `savingsTarget`, `months: MonthStatus[]`, `eligibleMonths: number[]`, `previousComparable: boolean`, `assetBasisMonth: string | null`.
- Adds optional explicit `eligibleMonths: number[]`, `previousComparable: boolean` to pure `buildAnnualReport` input; only the closed-only reader uses them. No silent production fallback.
- Adds optional `closedMonths?: number[]`, `monthRevisions?: Record<number, number>` to `CategoryDetail`, preserved for all flows.
- Closed cell HTTP contract: `scope=closed&revision=<integer>`, validates current closing state/revision in same read snapshot as items; stale/unclosed returns 409 with refresh message, never numbers. Default live scope unchanged.

- [x] **1. RED tests:** seed January income 1000/expense 400, February expense 999, March zero; close January and empty March. Assert annual expense400, divisor2, average net300, monthly slots January active/March active/February inactive. Previous comparison only if both previous January and March are explicitly closed; no matches means unavailable (not fabricated zero comparison). No close means no forecast. Test stale tooltip revision returns409 and live scope still returns February999.

```ts
expect(data.eligibleMonths).toEqual([1, 3])
expect(data.report.annual.expense).toBe(400)
expect(data.report.cashflow.monthlyNet).toBe(300)
expect(data.monthly[1].active).toBe(false)
expect(data.monthly[2].active).toBe(true)
```

- [x] **2. Run RED:** `pnpm test -- tests/finance/closed-report.test.ts` and `pnpm test:db -- tests/integration/closed-report.test.ts`.
- [x] **3. Implement one repeatable-read report transaction.** Load selected+previous-year statuses and transactions, taxonomy, target and cash asset balances from that snapshot, always household scoped. Build arithmetic inputs using the exact closed-month set, not last active month. Closed empty months are explicitly active and counted. YoY uses identical month numbers and is suppressed if any corresponding prior month is open. Preserve six forecast calendar positions and old average arithmetic; expose no forecast when count0. Expose asset basis month separately. Category/account series and TOP/min/max/target counts consume the same mask.

```ts
const selected = new Set(eligibleMonths)
const included = rows.filter(row => selected.has(Number(row.date.slice(5, 7))))
const previousComparable = eligibleMonths.length > 0 && eligibleMonths.every(month => previousClosed.has(month))
```

- [x] **4. Update closed cell query/cache contract with valid revision parsing, response status and consistent snapshot.** Do not alter existing live category tooltip API consumers. Tests include malformed scope/revision and cross-household IDs.
- [x] **5. GREEN:** focused/new and existing report/category tests, lint/tsc/test:all/build. Commit `feat(stats): restrict annual read model to closed months`.

### Task 3: Whole-month closing interaction and live status notices

**Files:** Create `month-close/actions.ts`, `month-close/month-close-control.tsx`, `month-close/month-status-label.tsx`, `month-close/mutation-notice.ts`; modify ledger/dashboard/budgets/review pages, ledger/diagnosis presentation, transaction-writing actions in ledger/inbox/manage/recurring, `src/lib/revalidate.ts`; tests `tests/integration/month-close-actions.test.ts`, existing mutation tests, `tests/finance/revalidate.test.ts`.

**Interfaces:**
- Consumes summary/close/reopen signatures from Task1 and `requireHousehold()` authenticated user.
- Produces authenticated `loadMonthCloseSummary(month)`, `closeLedgerMonth(input)`, `reopenLedgerMonth(month)` server actions, returning serializable results, no redirects.
- Produces `<MonthCloseControl month={month} status={status} />`.
- Produces mutation notice helper scoped to affected transaction months: capture closed months before actual write; after write report only those now `needs_review`. UI success message appends reopened month names. Inbox-only writes bypass this helper.

- [x] **1. RED tests:** calling action with stale revision leaves month open, caller cannot supply another household/user, current month refused, warning+empty acknowledgments enforced, manual edit/inbox apply/recurring/unclassified mutate close while skip/exclude/restore do not. Keep inline action return shapes and row state; add message field instead of redirect.

```ts
expect(result.ok).toBe(false)
expect((await getMonthStatuses(householdId, ['2026-08']))[0].state).toBe('needs_review')
expect(routesToRevalidate(['monthClose'])).toEqual(expect.arrayContaining(['/ledger', '/report', '/dashboard', '/budgets', '/budgets/review']))
```

- [x] **2. RED:** run focused action/cache tests before action/helper implementation.
- [x] **3. Implement inline accessible native dialog.** Trigger label shows selected month, current state and month-only scope. On open fetch full summary; show loading/error, complete totals, three warning counts, separate warning and empty-month checkboxes. Submit disable while pending. Changed revision refreshes summary and clears acknowledgments. Existing close offers reopen with explicit report exclusion notice. Use transition + server-action path revalidation without route navigation; preserve scroll/forms. An additional router.refresh is unnecessary after the action. Closed month with pending items shows separate pending warning without invalidating ledger state.

```tsx
<button type="button" disabled={!summary.closable || pending || (summary.requiresAcknowledgment && !acknowledgeWarnings) || (summary.count === 0 && !acknowledgeEmpty)} onClick={submitClose}>월 전체 마감</button>
```

- [x] **4. Add live state labels** to ledger alltabs, home comparison/trends, budget and review, AI diagnosis unclosed target. No global live-loader filtering or AI queue/prompt changes. Add monthClose invalidation readers and inbox→ledger reader for pending notice. Wire actual mutation notices including cross-month moves.
- [x] **5. GREEN:** focused action+mutation tests and lint/tsc/test:all/build. Commit `feat(ledger): add month closing controls and provisional notices`.

### Task 4: Explicit missing-month rendering throughout statistics

**Files:** Modify `src/app/report/page.tsx`, `analytics/stats-monthly.ts`, `stats-monthly-section.tsx`, `series-chart.tsx`, `series-chart-geometry.ts`, `annual-flow-overview.tsx`, affected chart helpers; tests `tests/finance/stats-monthly.test.ts`, `series-chart.test.ts`, new closed-month rendering tests.

**Interfaces:**
- Consumes Task2 closed-only report payload/CategoryDetail masks/revisions; SeriesChartSeries values remain `(number | null)[]`.
- Model uses display/null values for rendering and numeric-only values for sums, explicitly preserving absent slots. Closed zero remains0. Mini-sparkline retains original x-coordinate slots and breaks paths over nulls.

- [x] **1. RED tests:** `1월 마감 / 2월 미마감 / 3월 마감` yields series values `[400,null,0,...]`; table zero/— distinguished; a hover on March has no MoM because February open; all three chart modes cannot hit February; mini-trend does not connect January to March. No eligible months gives count0 and no 1-month-average fiction.

```ts
expect(model.series[0].values.slice(0, 3)).toEqual([400, null, 0])
expect(model.divisor).toBe(2)
expect(model.rows[0].average).toBe(200)
```

- [x] **2. RED:** `pnpm test -- tests/finance/stats-monthly.test.ts tests/finance/series-chart.test.ts`.
- [x] **3. Wire /report to getStatsReportData only.** Remove live annual dashboard/category loaders from this page. Display closed months/count, open/review/current/future states; explicit empty-state link to ledger. Use active/eligible count rather than positive annual sums. Suppress all mismatched YoY/TOP and no-close forecast; label asset baseline. Twelve columns always retained. Preserve category/payment toggles, series selection, cell exclusion and report URL state.
- [x] **4. Preserve nulls end to end:** no `null -> 0` in Chart.js datasets or hover targets; `spanGaps:false`, no area bridge over ineligible slot. Table unavailable cells cannot exclude/fetch. Tooltip cache key includes closed scope+revision;409 clears stale tooltip and offers refresh. Adjacent-month deltas only when both slots eligible. Mini-trend uses separate SVG path segments/points without compressing absent month indices.
- [x] **5. GREEN:** focused chart/model tests then lint/tsc/test:all/build. Commit `feat(stats): distinguish unclosed months across charts and tables`.

### Task 5: End-to-end lifecycle, independent review and release notes

**Files:** Create `tests/e2e/month-close.spec.ts`; adjust existing E2E report fixtures (explicitly close only their known intended months), append verification notes to this plan/spec. No production fixtures or credentials committed.

- [x] **1. Write and run lifecycle E2E against real local app:** filtered ledger with two differently categorized amounts opens whole-month totals, acknowledges warnings, closes, checks report, edits inline without full loading, observes `재확인 필요`, report gap, recloses. Include current-month restriction, empty month, manual reopen, keyboard Escape/focus, dark/mobile dialog, all three chart modes/null-gap behavior, stale tooltip, pending inbox-only notice.

```ts
await expect(page.getByRole('dialog')).toContainText('전체 거래')
await expect(page.getByRole('dialog')).toContainText('필터와 무관')
await expect(page.getByText('재확인 필요', { exact: true }).first()).toBeVisible()
```

- [x] **2. Test actual mutation pathways** not just raw SQL: manual create/edit/delete, inbox single/bulk/high-confidence, recurring actual adjusted date, unclassified single/bulk, duplicate conflict and inbox status-only operations. Add missing cases to integration suite and fix regressions with red/green evidence.
- [x] **3. Verify:** `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test:all`, `pnpm build`, `pnpm e2e`. If local runtime cannot be started, report exactly what was not run; never claim unverified completion.
- [x] **4. Request independent whole-branch review** against approved spec and baseline `4cfcdb1`, focusing concurrency/tenant isolation, full eligibility coverage, no flash. Address confirmed findings with regression tests and rerun affected/full gates.
- [x] **5. Commit** `test(month-close): cover closing lifecycle and report eligibility`. Report exact checks and pending production migration; use finishing-a-development-branch skill to offer integration choices. Do not merge/push/deploy without the new request.

## Coverage review

Spec§1–3: Tasks1+3; §4: Tasks2+3+4; §5: Task1; §6: Tasks1–4; §7: Task5 release notes and local-only gates; §8: all tasks/T5 browser lifecycle. Existing data starts open by absent row. Shared state interface Task1→2/3, mask interface Task2→4, render/action interface Task3/4→5. The optional pure-builder eligibility preserves legacy live math tests, but the production /report reader always supplies eligibility. No separate speculative subsystem is introduced.

## Verification and release handoff — 2026-09-09

Implementation is complete on `docs/monthly-close-design`, based on `4cfcdb1`. Main, remote branches and production have not been changed by this feature. Unrelated untracked design files, the older refactor plan and `outputs/` remain untouched.

- Task 1: `c0e2f4c`; independent core review strengthened deterministic close/write lock races, authenticated SQLSTATE 42501 rejection and member isolation in `5e14e20`.
- Task 2: `1a60319`, Task 3: `da994a7`, Task 4: `db249f8`. Each task passed lint, typecheck, full unit/integration tests and build before committing.
- Final `pnpm lint` and `pnpm exec tsc --noEmit`: exit 0.
- Final `pnpm test:all`: **80 files / 543 tests passed**, including real local PostgreSQL concurrency, permission, mutation-path and closed-tooltip HTTP tests.
- Final `pnpm build`: exit 0, optimized build completed.
- Full `pnpm e2e`: **32 passed**. Four monthly-close scenarios cover whole-month scope despite filters, inline invalidation without document reload, reclose, sparse masks across three chart modes, stale tooltip/refresh with retained selection, mobile dark dialog, current-month refusal, explicit empty-month consent, keyboard dismissal/focus, stale-confirmation consent reset and inbox-only pending notices.
- Existing report E2E fixtures explicitly close their intended local months through the real service; no application fallback treats open data as closed. The history cancellation test now asserts active/aborted reads correctly under dev StrictMode's additional cancelled mount read.
- Browser review also caught HTML NUL normalization in the detail selector; option IDs are URI-encoded at the DOM boundary. Existing internal series IDs remain unchanged.
- Whole-branch independent review found a retained Chart.js-plugin closure after in-place refresh and leading closed-zero mini-trend trimming. Both were reproduced before fixing. Plugins now read current data/options; closed-only sparklines retain zero/refund slots. Re-review found no remaining Critical/Important issues; focused regressions passed independently (14 tests).
- Desktop report and 390px dark-mode dialog screenshots were visually inspected. Temporary screenshots remain in ignored `test-results/`, not committed as personal data.

### Production remains pending

`drizzle/0007_monthly_close.sql` and its metadata were applied **only to the verified local PostgreSQL at 127.0.0.1:54322**. No original transaction data was backfilled or auto-closed. After a separate deployment request: verify the production target, take a database backup, apply the additive migration **before** deploying code that queries `ledger_months`, then verify authenticated access and the empty-until-closed report without inventing real transactions. Existing months remain open until the user explicitly reviews/closes them. Merge/push/deploy are not implied by implementation completion.

# Task 2 report: source-aware budget drafts

## TDD evidence

- RED: `/tmp/budget-task2-red.log` recorded 10 failed and 9 passed draft tests, plus the missing `plan-fill` module.
- Focused GREEN: `NODE_OPTIONS= pnpm test tests/finance/budget-draft.test.ts tests/finance/budget-plan-fill.test.ts` passed 21/21 tests across 2 files.

## Implementation

- `BudgetDraftRow` now stores `source: BudgetSource | null`; selection was removed from reducer state.
- `createBudgetDraft` combines saved baselines with optional plan metadata and initializes AI only when job ID and recommended amount match.
- `choose` and `fill` share `BudgetDraftChoice`. Historical and temporary null-source choices clear recommendation provenance; AI choices retain the verified job ID.
- Manual edits clear the chosen source while retaining recommendation provenance. Save serialization still emits only amount, recommendation job ID, and expected version.
- `saved` adopts server baselines and versions while retaining a matching session source; `rebase` retains dirty or invalid in-progress rows and adopts clean/new rows.
- `overwrittenDraftRows` reports only dirty rows whose amount or persisted provenance would actually change. Source-only changes do not require confirmation.
- The legacy form keeps selected majors in local React state. Verified AI reports are translated into `fill` choices; old fills use `previousBudget` only for the matching historical action and `null` for legacy computed fills.
- Existing `BudgetRow` test literals include `source: null` for temporary type compatibility.

## Final interfaces

```ts
type BudgetDraftChoice = {
  major: string
  amount: number
  source: BudgetSource | null
  recommendationJobId: string | null
}

createBudgetDraft(
  baseline: BudgetBaseline[],
  plan?: BudgetPlanRow[],
  completedJobId?: string | null,
  recommendedAmounts?: Record<string, number>,
): BudgetDraft

budgetDraftReducer(state: BudgetDraft, action:
  | { type: 'edit'; major: string; amount: string }
  | ({ type: 'choose' } & BudgetDraftChoice)
  | { type: 'fill'; choices: BudgetDraftChoice[] }
  | { type: 'undo' }
  | { type: 'rebase'; rows: BudgetBaseline[] }
  | { type: 'saved'; rows: BudgetBaseline[] }
): BudgetDraft

overwrittenDraftRows(draft: BudgetDraft, choices: BudgetDraftChoice[]): BudgetDraftRow[]
```

## Gates

`NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test` exited 0. Vitest passed 673/673 tests across 75 files. ESLint and TypeScript completed without errors. The existing Vite native config compatibility warning remains.

## Scope and concerns

- Protected save service, save contract, schema, snapshot, and recommendation report files have no diff.
- The legacy manual conversion passes its numeric input through `choose`; Task 7 removes this compatibility UI. Invalid draft input remains blocked from saving as before.
- The controller-owned plan document remains modified but is not part of this task commit.

## Review follow-up

- Added `manualDraftChoice(row): BudgetDraftChoice | null`, which uses the same exact non-negative safe-integer validation as save serialization. The temporary legacy manual action dispatches only when this conversion succeeds.
- Regression RED: the focused draft suite failed because `manualDraftChoice` did not exist. GREEN: focused draft/fill tests passed 22/22, including proof that blank input stays blank and invalid while its recommendation provenance remains intact.
- Re-ran `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`; all gates exited 0 and Vitest passed 674/674 tests across 75 files.

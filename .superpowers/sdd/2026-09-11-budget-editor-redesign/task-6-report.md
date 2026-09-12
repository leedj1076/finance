# Task 6 report — 390px budget editor layout

## Changes

- Kept the desktop three-column `PlanItem` hierarchy while adding one shared top-line wrapper. At ≤640px it places the item name and the fixed 150px amount control on the same line, followed by the full-width caption and reference list.
- Kept the four reference buttons and their existing selection/callback semantics. Mobile CSS uses `84px 84px minmax(0, 1fr) 16px`, 8px gaps, and 36px rows.
- Reused the Task 4 native `details` / `summary` fill menu; no radio controls or second mobile data hierarchy were introduced.
- Allowed AI reason text to wrap on mobile instead of truncating it.
- Matched the desktop request/evidence/summary widths to 640px/440px/420px, bounded every dialog to the viewport, and changed anchored AI popovers to a viewport-bottom sheet at ≤640px. Native popover/dialog dismissal and ownership remain unchanged.
- Preserved the existing two-line mobile ceiling bar and its native savings-target popover because it already meets §7.

## Tests

- RED: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/budget-editor-mobile.test.tsx` failed on the missing shared top line and missing responsive dialog-size classes (2 expected failures; native fill-menu check already passed).
- GREEN: the same focused command passed 3/3 tests.
- Task gate: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test` exited 0; 81 test files and 719 tests passed. Vitest printed the existing future Vite native-config warning.

## Commit

- `fix(budgets): fit reference editor at mobile widths`

## Integration notes

- Task 7 can assemble these same components without mobile-specific props or callback changes.
- `PlanItem` still emits historical choices through `onChoose`, AI intent through `onChooseAi`, and evidence intent through `onOpenEvidence`; no field/source ownership changed.
- `AiRequestDialog`, `AiEvidencePopover`, and `AiSummaryPopover` retain their controlled open/close behavior. Only presentation classes and viewport bounds changed.
- Runtime assembled-page screenshots remain Task 8 scope; no browser harness was added here.

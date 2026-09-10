# Statistics table provisional trends

User's explicit design reference: the table under 통계 → 달마다 must use the same unclosed-month dashed and transparent styling as the chart above. Reuse its `PROVISIONAL_DASH` and 0.45 opacity; do not choose a new palette or change calculations, hover, exclusions, selection, row hierarchy or layout.

The main checkout already contains an uncommitted two-file implementation from another session. Preserve main and all unrelated files. This isolated branch adopts that exact baseline and adds focused regression coverage. No production data, main merge, push or deployment.

Workspace: `.worktrees/ai-budget-save`, branch `feat/stats-trend-provisional`, base `a1f753e`. The old `feat/ai-budget-save` branch remains at its completed commit. Local environment hostnames were verified loopback. The AI budget consumer owns shared E2E port3101; coordinate before any browser server, never run it concurrently.

## Task 1: Preserve and verify provisional sparklines

Allowed files:

- `src/features/analytics/stats-monthly.ts`
- `src/features/analytics/stats-monthly-section.tsx`
- `tests/finance/stats-monthly.test.ts`
- `tests/finance/provisional-charts.test.tsx`
- `tests/e2e/month-close.spec.ts`

1. Confirm the two main source files still match the controller's recorded hashes. Read only those source files/diff there. Do not stage or modify the main checkout.
2. Add focused unit/render regression tests before adopting the existing implementation. Cover calendar-aligned closed masks after leading/trailing missing data and the last-six-point window, solid↔provisional edges, gaps (no invented zero or connecting missing months), recorded zero/refund values, final marker state, and undefined mask compatibility. Cover both major/subcategory rows and account/category modes across expense/income/saving where existing fixtures permit. Show exact dash and opacity attributes, not only a polyline count.
3. Observe intended RED, then apply the existing two-file source diff with `apply_patch` to this isolated worktree. If the regression exposes a genuine defect, report its cause before making the smallest scoped correction; do not change unrelated chart behavior.
4. Update the existing month-close browser assertion that assumes one polyline: split solid/provisional segments are now expected. Assert actual segment styling for the fixture's major and subcategory trends while preserving its other month-close/tooltip checks. Do not bypass auth, month-close service or production APIs.
5. Run focused unit/render tests, `pnpm exec tsc --noEmit`, scoped ESLint and `git diff --check`. Report browser E2E as pending until the controller grants exclusive3101; integrated final E2E may cover it after this commit is reviewed/cherry-picked.
6. Commit only the five allowed files as `fix: match provisional table trends to monthly charts`. Report exact tests, source preservation hashes, commit and pending browser gate. No `git add -A`, no extra agents, no DB/schema/config changes, and do not touch unrelated untracked docs or outputs.

Controller performs an independent scoped review, integrates only reviewed changes into the local feature branch, and closes the browser-verification obligation during the serialized final E2E. This task is not fully verified solely by a unit pass.

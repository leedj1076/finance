# Monthly AI diagnosis implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Finish and verify each owned task before integration.

**Goal:** Add an on-demand monthly report using the approved V1 report structure and V2 salary cashflow block, processed by the user's Mac through Codex CLI.

**Architecture:** Next.js authenticates the household and saves an immutable, computed monthly snapshot in Supabase Postgres. A Mac worker polls narrowly scoped RPCs with a revocable household-bound token, runs Codex CLI through stdin, validates structured output, and completes the job. React polls authenticated status and retains the latest successful report during regeneration and failures.

**Tech Stack:** Existing Next.js 15, React 19, Drizzle/Postgres, Supabase, TypeScript/tsx, Vitest, installed Codex CLI 0.153.4.

**Spec:** User-approved V1 body plus V2 cashflow in `docs/design/swiss-ledger/ai-diagnosis-{july,july-v2}.html`; user-supplied queue/CLI architecture in this conversation.

## Global constraints

- Tab order: summary, list, ai, categories, merchants. Diagnosis always uses the complete selected month, irrespective of ledger filters.
- No OpenAI API key for diagnosis, shell interpolation, inbound Mac port, or autonomous ledger edits.
- All aggregates are calculated in code. Explicitly distinguish salary remainder, total-income remainder, savings transfers, and actual available cash.
- Preserve V1 sections: summary, changes, household trend, checks, next-month actions. Evidence links use only recorded transaction IDs. No invented peer statistics, recurring-income assumptions, or liquidity estimates.
- Snapshot includes selected month plus three earlier months; missing months are distinguished from zero expense. Comparison uses symmetric travel/ceremony exclusions.
- Only one queued/running job per household/month. Atomic claim, finite lease, timeout, stale completion rejection, repeatable manual regeneration, and preservation of prior reports.
- Browser reads require household authentication. Worker tokens are hashed at rest, scoped to one household, and never expose database credentials to Codex.
- CLI runs with fixed arguments, stdin, isolated working directory, minimal environment, no shell, and no user plugins/tools. Reject invalid/oversized responses and unknown evidence IDs.
- No production deployment or production migration is part of local verification.

## Task 1: Snapshot and report contract (root)

Files: `src/features/diagnosis/{types,snapshot,report,prompt,queries}.ts`; `tests/finance/diagnosis-{snapshot,report}.test.ts`.

- [x] Test July salary 7,101,720 − expense 5,603,949 − savings 850,000 = 647,771, missing comparisons, edits affecting fingerprints, and whole-month aggregation.
- [x] Implement deterministic snapshot, canonical fingerprint, bounded report schema/validation and data-only prompt.
- [x] Query only the authenticated household and save a fixed snapshot when enqueuing.

## Task 2: Durable queue and scoped worker RPCs (database agent)

Files: `src/db/schema/diagnosis.ts`, schema barrel, `drizzle/0005*`, migration metadata, `tests/integration/diagnosis-queue.test.ts`.

- [x] Add jobs and workers, RLS select for members, revoke direct mutations and worker-token reads.
- [x] Implement claim/heartbeat/finish RPCs authorized by hashed worker token; atomically claim with SKIP LOCKED and enforce claim token/lease/household on completion.
- [x] Test concurrent claiming, household isolation, unauthenticated denial, duplicate active jobs, expired work, revoked token, and stale completion against local Supabase only.

## Task 3: Report UI (UI agent)

Files: `src/features/diagnosis/diagnosis-panel.tsx`, `src/app/ledger/page.tsx`, ledger tab typing where needed; renderer tests.

- [x] Integrate the approved report layout with V2 cashflow, V1 narrative sections, compact trend, evidence dialog, print, and generation status.
- [x] Use authenticated `GET/POST /api/diagnosis?month=YYYY-MM`; preserve completed report while new job is active or failed. Do not show demo content as a real report.
- [x] Keep month navigation; hide unrelated transaction filters for diagnosis and describe whole-month scope.
- [x] Verify empty/queued/running/completed/failed and changed-data states, negative remainder, and missing salary/history cases.

## Task 4: Mac worker (CLI agent)

Files: `scripts/diagnosis-worker.ts`, `src/features/diagnosis/codex-runner.ts`, worker support and tests. Root owns setup script/package scripts.

- [x] Test fixed argv, environment isolation, stdin, output shape, timeout/kill, process failure and output cap with fake executables.
- [x] Poll scoped Supabase RPCs, heartbeat during processing, validate report before completion, and report only safe error codes.
- [x] Handle shutdown without losing the durable job; expired leases become retryable failures.

## Task 5: API, setup, integration and review (root)

Files: `src/app/api/diagnosis/route.ts`, setup script, worker operations guide, `.env.example`, package scripts and tests.

- [x] Add session and same-origin checks, month validation, no-store status, idempotent active request behavior, and safe failure messages.
- [x] Provision a household-bound worker token into a private local config; provide foreground and launchd operation instructions without storing user login passwords.
- [x] Run unit/integration/lint/type/build checks and review the combined diff. Test actual CLI with synthetic data if installed authentication permits it.
- [x] Report precisely what is implemented and locally verified, and what requires deployment to trigger from the phone.

## Verification recorded 2026-09-09

- Unit: 305 tests passed. Diagnosis database integration: 27 tests passed on localhost Supabase.
- Browser: 1440px and 390px lifecycle tests passed; inspected screenshots for layout and no horizontal overflow.
- TypeScript, ESLint and Next.js production build passed.
- Real Codex CLI 0.153.4 accepted the fixed runtime configuration and produced a valid report from five synthetic transactions; no tool events were emitted.
- Real setup/worker-once/revoke smoke used a temporary local household and private config; no persistent service or production data was changed.
- Independent review found a hidden/orphan budget mismatch, fixed by active expense-major filtering and regression coverage; final review found no remaining important issue.
- Feature implementation is local. Production migration/deployment and a production-bound long-running Mac worker have not been activated.

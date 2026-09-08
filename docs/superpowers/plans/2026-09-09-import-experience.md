# Import Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement selectable matching cards, compact theme controls, encrypted NH PDF imports, and persistent truthful import progress.

**Architecture:** Keep existing financial and classification behavior. Add a shared authenticated import service with an optional progress observer, consumed by compatibility server actions and a same-origin NDJSON POST route. Keep UI state separate from route refresh and use a modal outside the animated page container.

**Tech Stack:** Next.js 15.5.25, React 19, TypeScript, Drizzle/PostgreSQL, Vitest, Playwright, PDF.js (exact compatible version pinned after verification).

**Spec:** `docs/superpowers/specs/2026-09-08-import-experience-design.md`

## Global Constraints

- 기존 재무 계산식, 거래 흐름, 분류 우선순위·신뢰도, 인박스 검토·반영 방식은 변경하지 않는다.
- 새로운 작업 서버, 작업 기록 테이블, 백그라운드 작업 재개 기능은 만들지 않는다. 운영 DB 마이그레이션은 계획하지 않는다.
- 기존 파일당 2MB 제한은 유지한다.
- 원본 파일과 비밀번호를 DB, 로그, 브라우저 저장소, 저장소 테스트 픽스처에 저장하지 않는다.
- 테스트 DB는 로컬 복사본만 사용한다. 운영 DB에 샘플을 업로드하지 않는다.
- 인증된 가구의 `householdId`를 모든 업무 쿼리에 적용한다. 원래 파일 지문과 발생 순번을 유지한다.
- Keep `docs/superpowers/plans/2026-09-07-reliability-first-refactor.md` untouched and untracked.
- Work on `feat/import-experience`, not main. User approved uninterrupted implementation, verification, commits and branch push. Do not deploy or merge main in this plan.
- Run gates sequentially before each feature commit: `pnpm lint && pnpm exec tsc --noEmit && pnpm test:all && pnpm e2e && pnpm build && git diff --check`. Never overlap E2E with DB tests, tsc or build.
- Baseline on 2026-09-09: 51 test files / 260 tests pass. Existing Vite config, FORCE_COLOR and Next development MaxListeners warnings are recorded, not new failures to conceal.

## File Map

- `account-match.ts`: pure candidates and selected account validation.
- `theme-selector.tsx`: existing theme state, icon trigger and accessible menu; theme storage/controller stays unchanged.
- `parsers/nh-pdf.ts`: PDF.js reading and typed safe errors; `parsers/nh-pdf-grid.ts` if needed for focused coordinate-to-row parsing.
- `import-progress.ts`: event contract, safe public error types, phase names.
- `import-service.ts`: existing staging orchestration with observers, no duplicate business implementation.
- `upload-action.ts`: authenticated compatibility adapters.
- `import-stream.ts`: NDJSON encoding/decoding and terminal result enforcement.
- `app/api/import/route.ts`: authentication, same-origin guard, bounded form parsing and stream response.
- `upload-form.tsx`: form inputs and orchestration; `upload-progress-dialog.tsx`: native dialog lifetime and progress/results; `use-import-upload.ts`: shared client stream state if needed to keep files focused.

## Task 1: Select and validate an eligible default card

**Files:** modify `src/features/inbox/account-match.ts`, `src/features/inbox/upload-action.ts`, `src/features/inbox/upload-form.tsx`; tests `tests/finance/account-match.test.ts`, `tests/integration/card-upload.test.ts`, `tests/e2e/parity.spec.ts`.

**Interfaces:** Preserve `suggestCardAccountId`. Export `cardAccountCandidates(accounts: CardAccountCandidate[], issuerLabel: string, owner: string): CardAccountCandidate[]` and `resolveCardAccountId(accounts: CardAccountCandidate[], issuerLabel: string, owner: string, selectedId: string | null): number | null`. Missing ID (`null`) permits unique fallback. A present blank/malformed/foreign ID returns null, never a silently corrected ID. Optional `active?: boolean` excludes false, while current SQL filters still enforce active state.

- [ ] Add the failing behavioral unit test:

```ts
const cards = [
  { id: 1, name: 'DJ 현대 네이버', owner: 'DJ', type: 'card' },
  { id: 2, name: 'DJ 현대 미래에셋', owner: 'DJ', type: 'card' },
  { id: 3, name: 'YJ 현대', owner: 'YJ', type: 'card' },
]
expect(resolveCardAccountId(cards, '현대카드', 'DJ', '2')).toBe(2)
expect(resolveCardAccountId(cards, '현대카드', 'DJ', null)).toBeNull()
expect(resolveCardAccountId(cards, '현대카드', 'DJ', '3')).toBeNull()
expect(resolveCardAccountId(cards, '현대카드', 'DJ', '')).toBeNull()
```

Run `pnpm test tests/finance/account-match.test.ts`; confirm the missing selection behavior fails, not unrelated setup.

- [ ] Implement the pure boundary and use it in the server. Candidate filter remains card type + owner + compact issuer name + active not false. ID parsing uses `/^[1-9]\d*$/` and `Number.isSafeInteger` before candidate membership lookup. Read FormData `accountId` as string or reject non-string values. Maintain missing-ID unique fallback.

```ts
const candidates = cardAccountCandidates(accounts, issuerLabel, owner)
if (selectedId === null) return candidates.length === 1 ? candidates[0].id : null
if (!/^[1-9]\d*$/.test(selectedId)) return null
const id = Number(selectedId)
return Number.isSafeInteger(id) && candidates.some(card => card.id === id) ? id : null
```

- [ ] Add UI: 0 candidates => manage link and disabled submit; 1 => read-only automatic match plus hidden accountId; multiple => required labeled select with empty initial option. Preserve selected value only while eligible; clear when issuer/owner changes. Explain that the default applies to the file's rows and remains editable in inbox. Add a second same-owner issuer card in integration tests and verify actual inserted account IDs; reject foreign/inactive/wrong-owner/wrong-issuer/invalid IDs before any rows insert. Change the old test that expected the server to ignore an explicitly wrong ID, because that behavior is intentionally replaced.
- [ ] E2E before UI implementation must fail on missing default-card select, then pass after selecting one of two cards and observing its inbox account. Existing one-card upload and password retry must continue to pass.
- [ ] Run focused tests, full gates, self-review, and commit only task files: `feat(inbox): choose eligible default cards for statement uploads`.

## Task 2: Compact accessible theme menu

**Files:** modify `src/components/theme-selector.tsx`, `src/components/app-header-menu.tsx` only if needed for nested mobile menu coordination, `src/app/globals.css`, `tests/e2e/theme.spec.ts`.

**Interfaces:** Keep `ThemeSelector({ mobile?: boolean })`, `ThemeController`, `applyThemePreference`, `THEME_CHANGE_EVENT`, existing preference key and system behavior. Trigger name `화면 테마: <현재 모드>`, menu name `화면 테마 선택`, radio menu items named `라이트`, `다크`, `시스템`.

- [ ] Update one existing E2E to open the trigger before choosing a mode, verify one visible trigger and checked menu choice. Run `pnpm e2e tests/e2e/theme.spec.ts` and capture RED before UI changes.

```ts
await page.getByRole('button', { name: '화면 테마: 시스템', exact: true }).click()
await page.getByRole('menuitemradio', { name: '다크', exact: true }).click()
await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark')
await expect(page.getByRole('menu', { name: '화면 테마 선택' })).toHaveCount(0)
```

- [ ] Implement local open/focus state with existing theme subscription. Use small code-native sun/moon/system SVG icons without external icon dependency. `aria-haspopup="menu"`, `aria-expanded`, stable menu ID, `role="menuitemradio"`, `aria-checked`. Arrow keys/Home/End navigate, Enter/Space select, Escape closes and returns focus; outside click closes without stealing focus from the clicked control. Tab exits normally. Avoid menu conflict with existing header/mobile handlers.
- [ ] Extend E2E with keyboard selection, outside/Escape closing, 390px mobile menu bounds and retained theme on reload/system change/storage denial. Update existing theme tests to use the new controls, retaining chart color assertions. Do not weaken assertions to skip mobile or chart tests.
- [ ] Run full gates and commit `feat(theme): replace mode buttons with compact accessible menu`.

## Task 3: Parse and upload encrypted NH PDFs

**Files:** create `src/features/inbox/parsers/nh-pdf.ts`, optionally `nh-pdf-grid.ts`, `tests/finance/nh-pdf.test.ts`, synthetic `tests/fixtures/nh-pdf.ts`; modify `upload-action.ts`, `upload-form.tsx`, `tests/integration/card-upload.test.ts`, `tests/e2e/parity.spec.ts`, package/lockfile and Next config only as needed to bundle PDF.js.

**Interfaces:** `parseNhPdf(buffer: Buffer, password?: string): Promise<CardRow[]>`; exported `NhPdfError` with safe codes `password_required`, `password_incorrect`, `invalid_pdf`, `unsupported_layout`; exported PDF header check. Existing synchronous XLS/HTML parser remains synchronous. Import action awaits PDF path only when issuer is nonghyup and extension/header agree.

- [ ] Read the local sample layout; never commit it or its password. Add synthetic row-coordinate fixtures exercising principal versus usage amount, multi-page headers, negative adjustments and a wrapped merchant. Add a real encrypted synthetic PDF for decoder tests, generated in test utilities with a synthetic password. Test buffer creation is not a production dependency.

```ts
const rows = await parseNhPdf(await syntheticNhPdf({ encrypted: true }), 'test-only-password')
expect(rows).toEqual([
  { date: '2026-07-12', merchant: '테스트 가맹점', amount: 12500, pay: null },
  { date: '2026-07-15', merchant: '테스트 환불', amount: -2500, pay: null },
])
await expect(parseNhPdf(await syntheticNhPdf({ encrypted: true }), 'wrong'))
  .rejects.toMatchObject({ code: 'password_incorrect' })
```

Run `pnpm test tests/finance/nh-pdf.test.ts`; capture RED before parser implementation.

- [ ] Install one pinned PDF.js version compatible with Node 22.21.1 locally and Node 24 production after checking official package metadata. Load the legacy Node build, pass binary `data` and optional password, disable evaluation/remote loading, extract text content only, and destroy documents/tasks in `finally`. Parse coordinate rows using table headers, distinguish blank from zero and preserve negative principal. Reject unreadable transaction-like rows instead of silently inserting a partial result. Require explicit statement year/period for short dates. Do not derive transaction month from bill month.
- [ ] Extend server file validation before staging; await `parseNhPdf` for NH PDF, preserve all other parsers. Map password and unsupported errors to safe Korean messages; do not expose raw exceptions. Extend accepted file type/help text and password field only for eligible formats, retain file/card on retry and erase password after attempt.
- [ ] Cover unencrypted/encrypted PDF, missing/wrong password, corrupt/non-PDF, image-only, malformed date/amount, repeated headers/subtotals and negative amount. Integration tests must inspect stored rows/amounts/card IDs and idempotent second upload. Local provided sample must be compared to the document but never uploaded to production or sent to AI. Verify import of PDF.js in a production build, including emitted worker assets if required.
- [ ] Run full gates and commit `feat(inbox): support encrypted NH card PDF statements`.

## Task 4: Shared import service and truthful streaming endpoint

**Files:** create `src/features/inbox/import-progress.ts`, `import-service.ts`, `import-stream.ts`, `src/app/api/import/route.ts`, `tests/finance/import-stream.test.ts`, `tests/finance/import-route.test.ts`, `tests/integration/import-progress.test.ts`; modify `upload-action.ts`, `staging.ts`, `resolve-suggestion.ts` only for observer boundaries.

**Interfaces:**

```ts
export type ImportPhase = 'validating' | 'reading' | 'matching' | 'classifying' | 'saving' | 'finalizing'
export type ImportResult = { message: string; added: number; alreadyProcessed: number; automatic: number; review: number }
export type ImportFailureCode = 'password_required' | 'password_incorrect' | 'invalid_input' | 'processing_failed' | 'connection_lost'
export type ImportEvent =
  | { type: 'stage'; phase: ImportPhase; completed?: number; total?: number }
  | { type: 'heartbeat' }
  | { type: 'result'; result: ImportResult }
  | { type: 'error'; code: ImportFailureCode; message: string }
export type ImportObserver = (event: Extract<ImportEvent, { type: 'stage' }>) => void
// service accepts a server-resolved householdId, never one from form fields.
export async function runImport(householdId: string, mode: 'card' | 'banksalad', data: FormData, observe?: ImportObserver): Promise<ImportResult>
export async function readImportStream(response: Response, onEvent: (event: ImportEvent) => void): Promise<ImportResult>
```

- [ ] Write stream tests for fragmented UTF-8/JSON chunks, terminal result versus EOF, safe error propagation, malformed events, and no result after error. Observer integration test must capture phase before a deliberately deferred external AI result and before database inserts. Retain actual database behavior; mock only external classifier and authentication where necessary.

```ts
const response = new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('{"type":"heartbeat"}\n'))
  controller.close()
}}))
await expect(readImportStream(response, () => {})).rejects.toMatchObject({ code: 'connection_lost' })
```

Run focused tests and capture RED before implementing.

- [ ] Move existing upload orchestration into the server-only service, preserve fingerprint/classification math and order, keep existing server actions as thin authenticated adapters returning compatible `{message?, error?}`. Add optional observer at actual boundaries; add optional callback in suggestion resolution only when AI is actually invoked. Insert chunk counts are based on processed candidates, not fake added counts. Return structured counts already computed by the real service, not parsed from translated text. Result is emitted only after finalization and cache invalidation. Preserve ordinary callers with observer omitted.
- [ ] POST `/api/import` accepts `mode` and existing FormData inputs. Resolve authentication, reject missing/foreign Origin (compare against actual request origin, no hardcoded public host), enforce current multipart/file limits and card eligibility, then stream NDJSON with no-cache headers. Use a Node runtime, Vercel-compatible maximum duration, bounded heartbeat and cleanup on success/error/disconnect. Catch every async task rejection; stop emitting to a canceled stream without claiming cancellation rolled back DB work. Do not create global jobs or use a long DB transaction while awaiting AI.
- [ ] Add route tests for unauthenticated, cross-origin, malformed multipart, invalid mode/card/files and truthful stage/result behavior. Check HTTP errors before streaming and typed safe errors during streaming. No credentials, raw source or exceptions in progress/error payloads. Add compatibility integration tests comparing old action results and service stored rows.
- [ ] Run full gates and commit `feat(inbox): stream real import stages from shared service`.

## Task 5: Persistent upload modal and stream-connected forms

**Files:** modify `src/features/inbox/upload-form.tsx`; create `upload-progress-dialog.tsx`, `use-import-upload.ts`; modify CSS only for this modal; update/add `tests/e2e/import-progress.spec.ts` and existing parity upload tests.

**Interfaces:** Consume Task 4 `ImportEvent`, `ImportResult`, `readImportStream`. Both forms use the same state machine and request driver; preserve Task 1 account selection and Task 3 password retry. Submit includes `mode`. Use native `<dialog>.showModal()` with portal outside `.page-enter` for top-layer positioning and focus containment, close only in terminal state.

- [ ] Before implementation, add E2E that intercepts `/api/import` with a delayed stream and asserts that a submitted file shows the dialog continuously, no 100% timer, and a terminal result that stays visible until dismissed. The existing UI must fail because it neither uses the route nor retains results in the dialog. Add browser characterization of animated ancestor/pending refresh if needed to establish early-disappearance cause, not an unverified root-cause claim.

```ts
await expect(page.getByRole('dialog', { name: '거래 파일 처리 진행' })).toBeVisible()
await expect(page.getByRole('button', { name: '검토 대기 보기', exact: true })).toBeVisible()
await page.getByRole('button', { name: '닫기', exact: true }).click()
await expect(page.getByRole('dialog', { name: '거래 파일 처리 진행' })).toHaveCount(0)
```

- [ ] Replace fake timers and divergent useFormStatus/uploading lifetime with one request driver: idle, processing, completed, error. Set in-flight guard before awaiting, disable both file-type tabs/inputs/submit while pending. Consume streamed phases, show only real scoped count ratios; display indeterminate state when counts absent. Keep heartbeat as connectivity only. Phase progress is not overall ETA. Use router.refresh in a transition after result while retaining form and modal state; no location reload or forced navigation.
- [ ] Show completed counts and optional existing summary detail; manual close or review navigation only. Handle wrong password with retained file/account and cleared password; failures have explicit return-to-input action. EOF/network failures say completion is unknown, offer review, and never automatically retry. Clean stream reader/heartbeat lifecycle and protect double submit; beforeunload warns only while processing. Support reduced motion and dark mode.
- [ ] Cover both upload types, slow classification/save, Escape/backdrop during processing, error/result persistence, password retry, document identity and scroll across refresh, disabled background navigation, modal bounds at 390px, keyboard focus return, zero default inbox selection after upload, and real card/PDF uploads. Do not test only mocked success: existing end-to-end staging/apply tests must use the real service/route.
- [ ] Run full gates and commit `fix(inbox): keep real upload progress and results visible`.

## Final verification and handoff

- [ ] Review entire branch against approved spec; resolve blocking findings with regression tests.
- [ ] Re-run all gates serially and inspect production build artifacts for the PDF worker/runtime dependency.
- [ ] Confirm no financial sample, real password, .env or untracked user plan staged. `git diff main..HEAD -- drizzle src/db/schema` must be empty.
- [ ] Push `feat/import-experience` only, verify remote SHA with `git ls-remote`, report commit(s), test counts, known unchanged fingerprint limitation and that main/production are unchanged.

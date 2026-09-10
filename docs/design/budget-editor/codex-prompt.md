# Codex 작업 프롬프트 · 예산 편집기 개편

아래 전체를 ChatGPT(Codex)에 붙여 넣는다. 저장소 루트(`finance-web`)에서 실행한다.

---

너는 이 Next.js 15 + Drizzle + Supabase 가계부 앱(`finance-web`)의 시니어 프론트엔드 개발자다. 예산 편집기(`/budgets`)를 승인된 설계대로 개편한다. 설계를 다시 하지 말고, 문서와 목업에 없는 결정이 필요하면 가장 단순한 쪽을 택하고 마지막 보고에 적어라.

## 먼저 읽을 것 (순서대로)

1. `docs/superpowers/specs/2026-09-11-budget-editor-redesign-design.md` — 유일한 기준. §2 결정 기록, §4 표 동작, §5 AI 열, §8 읽기 모델, §11 유지 원칙, §12 검증을 그대로 따른다.
2. `docs/design/budget-editor/README.md` 와 PNG 다섯 장, `mockups/*.html`(브라우저로 열어 간격·정렬·상태를 확인).
3. 현재 코드: `src/app/budgets/page.tsx`, `src/features/budgets/{budget-form.tsx,budget-row.tsx,draft.ts,queries.ts,planning-queries.ts,review-queries.ts,save-contract.ts,save-service.ts}`, `src/features/budget-recommendations/{panel.tsx,client.ts,types.ts}`, `src/features/month-close/{month-status-label.tsx,queries.ts}`, `src/app/globals.css`.
4. 원칙 문서: `docs/superpowers/specs/2026-09-10-ai-budget-planning-design.md` §1·§8·§9, `docs/superpowers/specs/2026-09-09-month-close-ux-design.md` §3.4·§5.

## 무엇을 만드나

한 표에서 항목별로 `지난달 예산 · 지난달 실적 · 3개월 평균 · AI 추천` 중 골라 넣는 편집기. 상한 줄은 표 위에 고정, AI 요청은 열 머리 버튼 + 대화상자, 모바일은 카드 + 칩. 채우기 버튼·미리보기·추천안 검토·시뮬레이션·돌아보기 표는 삭제. 자세한 것은 스펙.

## 지켜야 할 것

- 저장 계약(`BudgetSaveRequest`)·서버 저장 서비스·AI 워커·스냅샷 계약·DB 스키마는 바꾸지 않는다. 마이그레이션 없음.
- 모든 Drizzle 조회는 `householdId` 범위. 서비스 롤 키·워커 토큰은 서버에만.
- AI 값을 넣기 전 `checkRecommendationForApply`를 반드시 거친다. 행의 `recommendationJobId`로만 AI 출처를 표시한다. 금액이 같다는 이유로 AI라고 표시하지 않는다.
- 어떤 채우기도 저장 전에는 DB를 바꾸지 않는다. 손댄 행이 덮어써질 때는 확인 팝오버.
- 색·타입·간격은 `src/app/globals.css` 토큰과 `t-*` 클래스만 쓴다. 원시 `text-[Npx]`, 임의 hex, 둥근 모서리, 이모지 아이콘 금지. 아이콘은 인라인 SVG.
- 문구는 스펙과 목업의 한국어를 그대로. 임의로 바꾸지 않는다.
- `NODE_OPTIONS=` 접두어로 node/pnpm을 실행한다(이 Mac의 preload 설정 때문).
- 커밋은 작업 단위마다, 명시한 경로만 `git add`. `git add -A` 금지. 다른 사람의 untracked 파일을 건드리지 않는다.

## 진행 방식

1. 스펙 §8.3의 파일 경계대로 작업을 8~10개로 나누고, 각 작업의 파일·테스트·완료 조건을 `docs/superpowers/plans/2026-09-11-budget-editor-redesign.md`에 먼저 적어라(superpowers writing-plans 형식: 실패 테스트 → 구현 → 통과 → 커밋).
2. 순서: (a) `plan-calculations.ts`·`plan-sources.ts` 읽기 모델 + 단위·통합 테스트 → (b) `draft.ts` 정리(select 삭제, fill 확장) + 테스트 → (c) `ceiling-bar.tsx` → (d) `plan-table.tsx`·`plan-row.tsx` 선택 표시·클릭·열 채우기·확인 팝오버 → (e) `use-recommendation.ts` 훅 + `ai-request-dialog.tsx` + `ai-column.tsx` + `ai-evidence.tsx` → (f) `plan-cards.tsx` 모바일 → (g) `budget-form.tsx`·`page.tsx` 조립과 삭제 → (h) E2E 네 개 갱신 → (i) 문서(`docs/ai-budget-planning-runbook.md`의 UI 설명 갱신).
3. 각 작업 뒤 `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`. 통합은 `NODE_OPTIONS= pnpm test:db`(로컬 Supabase 필요, `supabase status`로 확인). 마지막에 `NODE_OPTIONS= pnpm e2e`와 `NODE_OPTIONS= pnpm build`.
4. E2E가 도는 환경이면 데스크톱 1440과 모바일 390 스크린샷을 `docs/design/budget-editor/result/`에 저장해 목업과 나란히 비교할 수 있게 하라.

## 완료 보고에 반드시 넣을 것

- 실행한 검증 명령과 결과(통과/실패 수). 실패가 남으면 그대로 적는다.
- 스펙에 없어서 스스로 정한 것 목록.
- 삭제한 파일과 교체한 테스트 목록.
- 목업과 다르게 구현한 부분과 이유.

시작하기 전에 스펙을 다 읽고, 이해가 다른 부분이 있으면 코드를 쓰기 전에 질문 목록으로 먼저 보고하라.

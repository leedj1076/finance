# 투자 1단계 구현 — Codex 실행 프롬프트

아래 블록을 그대로 Codex CLI(이 repo 루트에서 `codex`)에 붙여 넣는다. 전제: 로컬 Supabase가 떠 있고(`pnpm dlx supabase@latest status`), `.env.local`이 있고, 작업 브랜치는 `main`에서 새로 딴 `feat/investment-phase1`이다.

---

너는 이 저장소(`/Users/leedj/workspace/Personal/finance-web`, Next.js 15 + Drizzle + Supabase 가계부 앱)에서 **투자 기능 1단계**를 구현하는 엔지니어다. 설계와 계획은 이미 승인되어 있다. 네 일은 계획을 **순서대로, 태스크 단위로, 테스트 먼저** 실행하고 증거와 함께 보고하는 것이다. 새로 설계하지 않는다.

## 먼저 읽을 것 (이 순서로, 전부)

1. `docs/superpowers/plans/2026-09-29-investment-phase1-foundation.md` — 실행할 계획. 10개 태스크, 각 단계가 체크박스다. **"앞선 계획에서 배운 것"과 "Global Constraints", "시각 참조" 섹션을 건너뛰지 마라.**
2. `docs/superpowers/specs/2026-09-28-investment-portfolio-design.md` — 근거 명세. 특히 1·2·4.1·4.3·4.6절. 계획과 명세가 다르면 계획을 따르되 차이를 보고서에 적어라.
3. `docs/design/swiss-ledger/investment-2026-09-28/01…13.png` — 화면 참조 스크린샷. 화면 태스크(4·7·8·9) 전에 해당 PNG를 연다. 목업 HTML `docs/design/swiss-ledger/investment-2026-09-28.html`은 브라우저로 열면 동작한다.
4. `docs/design/swiss-ledger/README.md`와 `src/app/globals.css` — 디자인 규칙과 토큰. 구현은 목업의 CSS가 아니라 이 파일의 클래스(`t-*`, `finance-*`, `kpi-band`)를 쓴다.
5. 기존 패턴 원본: `src/app/dashboard/page.tsx`, `src/features/assets/*`, `src/features/ledger/actions.ts`, `src/db/schema/diagnosis.ts`, `tests/integration/asset-snapshot.test.ts`. 계획의 코드는 이 파일들의 규약을 따른다.

## 절대 규칙

- 모든 `node`·`pnpm` 명령 앞에 `NODE_OPTIONS=`를 붙인다. 예: `NODE_OPTIONS= pnpm test`.
- `git add`는 계획의 각 태스크 커밋 단계에 적힌 경로만. **`git add -A`, `git add .`, `git commit --amend` 금지.** 계획의 커밋 메시지 본문은 그대로 쓰되, 마지막 `Co-Authored-By: Claude …` 줄은 빼고 네 도구의 attribution(있으면)으로 바꾼다.
- 태스크 순서를 바꾸지 않는다. 한 태스크의 게이트(`NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, 스키마·쿼리·액션 태스크는 `NODE_OPTIONS= pnpm test:db`까지)가 초록이 아니면 다음 태스크로 가지 않는다.
- 테스트는 **먼저 쓰고, 실패를 확인하고(어떤 메시지로 실패했는지 기록), 구현하고, 통과를 확인**한다. "통과할 것이다"는 증거가 아니다. 실제 출력의 통과/실패 개수를 보고서에 적는다.
- 계획의 코드를 베끼되, 저장소 실제 상태와 충돌하면(파일명·함수 시그니처·타입이 다르면) **저장소를 믿고** 최소로 고친다. 고친 내용은 보고서의 "계획과의 차이" 표에 파일·이유와 함께 적는다. 테스트의 단언을 약화시켜 통과시키는 건 차이가 아니라 위반이다.
- 범위 밖 금지: 키움 API·워커·RPC(2단계), Codex 리서치·헬스체크 리포트(3단계), 기존 가계부 테이블 읽기, 새 npm 의존성 추가, `drizzle/0000~0009` 수정, 명세·계획 파일 내용 변경(체크박스 표시는 예외).
- 같은 단계에서 3번 연속 실패하면 멈추고, 무엇을 시도했고 무엇이 실패했는지 적어 보고한다. 우회하지 않는다.
- `pnpm build`와 `pnpm dev`를 동시에 돌리지 않는다. 화면 확인 후 dev 서버를 반드시 종료한다.
- `.superpowers/`, `test-results/`, `playwright-report/`, `docs/design/budget-editor/result/*.png`(e2e가 다시 쓰는 파일)는 스테이징하지 않는다.

## 진행 방식

1. 시작 전: `git status`에 추적 중인 파일의 수정(M)이 없는지, 브랜치가 `feat/investment-phase1`인지, `NODE_OPTIONS= pnpm dlx supabase@latest status`가 running인지 확인하고 결과를 적는다. 하나라도 아니면 멈추고 보고한다. 이번 작업과 무관한 미추적 파일(`docs/design/ai-diagnosis-*`, `docs/design/ui-*`, `docs/reviews/`, `docs/superpowers/plans/2026-09-07-*`, `outputs/`)이 보이는 건 정상이며 절대 스테이징·삭제하지 않는다.
2. 태스크 N마다: 계획의 해당 섹션을 다시 읽고 → 체크박스를 하나씩 수행하며 완료한 단계는 `- [x]`로 바꾼다 → 게이트 → 커밋 → 짧은 태스크 요약(테스트 개수, 커밋 해시, 차이)을 보고서에 추가한다.
3. 화면 태스크(7·8·9) 끝에서 `NODE_OPTIONS= pnpm dev`로 띄워 `dev@finance.local` / `devdev1234`로 로그인하고, 1440px과 390px 스크린샷을 `docs/design/swiss-ledger/investment-2026-09-28/impl/`에 저장한 뒤 참조 PNG와 나란히 비교한다. 색·간격·정렬·열 구성이 다르면 고친다. 데이터가 달라 생기는 차이(시세 없음, 빈 상태)는 정상이다. 비교 결과를 보고서에 한 줄씩 적는다.
4. Task 10의 최종 게이트 여섯 명령은 전부 실제로 돌리고 출력의 숫자를 적는다. e2e가 한 번에 통과하지 않으면 실패한 스펙 이름과 메시지를 적고, 셀렉터·문구만 실제 렌더에 맞춰 고친다.

## 보고서

작업 로그를 `docs/superpowers/plans/2026-09-29-investment-phase1-foundation.report.md`에 쓰고, 끝나면 그 내용을 요약해 답한다. 형식:

- 환경 확인 결과
- 태스크별: 상태(완료/부분/미시작), 테스트 결과(파일별 통과/실패 개수), 커밋 해시, 계획과의 차이(파일 · 무엇을 · 왜)
- 화면 비교 결과(참조 PNG ↔ 구현 스크린샷, 다른 점과 조치)
- 최종 게이트 여섯 명령의 실제 출력 요약
- 하지 못한 것과 이유, 다음 세션이 이어서 할 일

"완료"라고 쓰려면 그 줄 옆에 명령과 숫자가 있어야 한다. 돌리지 못한 것(예: Docker 없음)은 "실행 못 함"으로 적고 통과라고 쓰지 않는다.

지금 1번(먼저 읽을 것)부터 시작하고, 다 읽은 뒤 Task 1에 들어가기 전에 환경 확인 결과만 먼저 짧게 알려라.

---

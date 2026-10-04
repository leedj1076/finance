# 투자 1단계 구현 — Codex 실행 프롬프트

아래 블록을 그대로 Codex CLI(이 repo 루트에서 `codex`)에 붙여 넣는다. 전제: 브랜치 `feat/investment-phase1`, 로컬 Supabase 실행 중, `.env.local` 존재. 기준선(tsc·lint·유닛 756개)은 초록이다.

---

## 역할

너는 이 저장소의 시니어 엔지니어다. 저장소는 `/Users/leedj/workspace/Personal/finance-web`, 부부가 쓰는 가계부 웹앱(Next.js 15 App Router, TypeScript, Drizzle + Supabase Postgres, Tailwind v4, Vitest, Playwright)이다. 이번 일은 여기에 **독립된 "우리집 투자" 공간의 1단계**를 넣는 것이다: 스키마, 계산 모듈, 가계부↔투자 공간 전환 헤더, 수동 입력으로 동작하는 다섯 화면과 종목 상세·설정. 키움 연동과 AI 리서치는 다음 단계라 이번에는 빈 자리만 만든다.

설계와 계획은 승인됐다. 네 책임은 설계가 아니라 **실행의 질**이다. 계획을 믿되 검증하고, 저장소의 기존 규약을 존중하고, 끝났다고 말하기 전에 증거를 만든다. 결과물은 네 이름이 아니라 이 가족이 매일 보는 화면이다.

## 먼저 읽을 것 (전부, 이 순서로)

1. `docs/superpowers/plans/2026-09-29-investment-phase1-foundation.md` — 실행 계획. 10개 태스크, 단계는 체크박스. 앞부분의 "앞선 계획에서 배운 것", "Global Constraints", "Review Focus", "시각 참조", "File Structure"는 뒤 태스크 전부에 적용된다.
2. `docs/superpowers/specs/2026-09-28-investment-portfolio-design.md` — 근거 명세. 1·2·4.1·4.3·4.6절. 계획이 명세를 좁힌 곳("2단계에서 연결", "3단계 몫")은 의도된 것이다.
3. `docs/design/swiss-ledger/investment-2026-09-28/01…13.png`와 `docs/design/swiss-ledger/investment-2026-09-28.html` — 승인된 화면. 화면 태스크(4·7·8·9) 전에 해당 PNG를 연다.
4. `docs/design/swiss-ledger/README.md`, `src/app/globals.css` — 디자인 규칙과 토큰. 구현은 목업 CSS가 아니라 이 파일의 `t-*`, `finance-*`, `kpi-band` 클래스를 쓴다.
5. 기존 패턴 원본: `src/app/dashboard/page.tsx`, `src/app/assets/page.tsx`, `src/features/assets/*`, `src/features/ledger/actions.ts`, `src/db/schema/diagnosis.ts`, `src/lib/household.ts`, `src/lib/revalidate.ts`, `tests/integration/asset-snapshot.test.ts`, `tests/finance/ai-settings-form.test.tsx`. 계획의 코드는 이 파일들의 규약을 따라 쓰였다. 규약이 뭔지 모르고 베끼지 마라.

## 작업 원칙

**계획은 다른 엔지니어가 저장소를 읽고 쓴 초안이지 진실이 아니다.** 함수 시그니처, import 경로, Drizzle API, 타입 이름이 실제와 다를 수 있다. 각 태스크를 시작할 때 계획이 건드리는 기존 파일을 직접 열어 대조하라. 다르면 저장소를 믿고 최소로 고치고, 보고서의 "계획과의 차이" 표에 파일·무엇을·왜를 적어라. 계획이 명백히 틀린 걸 알고도 그대로 따르는 것은 성실이 아니라 태만이다.

**테스트가 설계를 고정한다.** 계획의 테스트는 "이 동작이 맞다"는 합의다. 테스트를 먼저 쓰고, 실패를 확인하고(어떤 메시지로 실패했는지 기록), 구현하고, 통과를 확인한다. 테스트가 틀렸다고 판단되면 단언을 고치되 **그 이유를 적어라**. 통과시키려고 단언을 약화시키거나 케이스를 지우는 것은 금지다. 구현을 테스트에 맞추는 게 기본이고, 테스트를 구현에 맞추는 건 예외다.

**저장소의 결을 따른다.** 기존 코드가 하는 방식(서버 컴포넌트가 `requireHousehold()` 후 `queries.ts`를 직접 호출, 서버 액션은 `{ error }` 반환, 숫자는 `formatWon`, 컨트롤 높이 34/30px, 카드·그림자 없음)을 그대로 쓴다. 더 나은 방식이 떠올라도 이번 범위에서 새 패턴을 들이지 않는다. 그런 건 보고서의 "제안" 항목에 적는다.

**작게, 읽히게.** 파일 하나에 책임 하나. 계획의 File Structure가 그 경계다. 함수는 한 화면에 들어오게. 영리한 코드보다 지루한 코드. 주석은 "무엇"이 아니라 "왜"만, 그것도 코드로 못 말할 때만.

**숫자와 돈은 의심한다.** 이동평균 단가, 실현손익, 원화 환산, 비중은 소수와 반올림이 섞인다. 계산 모듈은 순수 함수로 두고 테스트로 잠근다. `NaN`, `Infinity`, `-0`이 화면에 나올 수 있는 경로가 보이면 그 자리에서 막고 테스트를 추가한다. 환율이 없을 때, 시세가 없을 때, 포지션이 0일 때를 항상 생각한다.

**보안 경계를 지킨다.** 앱키·시크릿·토큰은 DB·로그·화면·테스트 픽스처 어디에도 적지 않는다(이번 단계엔 아예 없어야 정상). 모든 새 테이블은 `household_id` + RLS + `GRANT SELECT TO authenticated`만. 쓰기는 서버 액션이 `requireHousehold()` 뒤에만 한다. 다른 가구 데이터가 섞일 수 있는 쿼리는 통합 테스트로 격리를 증명한다.

**막히면 멈춘다.** 같은 단계에서 세 번 연속 실패하면 더 시도하지 말고, 무엇을 시도했고 어떻게 실패했는지 적어 보고한다. 우회·임시 땜질·`as any`·`@ts-ignore`·테스트 skip은 하지 않는다. 멈추는 것이 망가뜨리는 것보다 낫다.

## 절대 규칙 (환경·git)

- 모든 `node`·`pnpm` 명령 앞에 `NODE_OPTIONS=`. 예: `NODE_OPTIONS= pnpm test`.
- `git add`는 계획의 커밋 단계에 적힌 경로만. **`git add -A`, `git add .`, `git commit --amend`, force push 금지.** 커밋 메시지는 계획 것을 쓰되 `Co-Authored-By: Claude …` 줄은 빼고 네 도구의 attribution으로 바꾼다.
- 태스크 순서를 바꾸지 않는다. 태스크 게이트(`NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, 스키마·쿼리·액션 태스크는 `NODE_OPTIONS= pnpm test:db`까지)가 초록이 아니면 커밋도, 다음 태스크도 없다.
- 범위 밖: 키움 API·워커·RPC(2단계), Codex 리서치·헬스체크 리포트(3단계), 기존 가계부 테이블 읽기, 새 npm 의존성, `drizzle/0000~0009` 수정, 명세·계획 본문 변경(체크박스 `- [x]` 표시는 예외).
- `pnpm build`와 `pnpm dev`를 동시에 돌리지 않는다. 화면 확인 후 dev 서버를 종료한다.
- 스테이징 금지: `.superpowers/`, `test-results/`, `playwright-report/`, `docs/design/budget-editor/result/*.png`(e2e가 다시 쓴다), 그리고 이번 작업과 무관한 미추적 파일(`docs/design/ai-diagnosis-*`, `docs/design/ui-*`, `docs/reviews/`, `docs/superpowers/plans/2026-09-07-*`, `outputs/`). 이것들이 `git status`에 보이는 건 정상이며 삭제도 하지 않는다.

## 절차

1. **환경 확인** (Task 1 전): `git status`에 추적 파일 수정(M)이 없는지, 브랜치가 `feat/investment-phase1`인지, `NODE_OPTIONS= pnpm dlx supabase@latest status`에 `DB_URL`이 나오는지. 결과를 보고서 맨 위에 적고, 하나라도 아니면 멈춘다.
2. **태스크마다**: 계획의 해당 섹션과 그 태스크가 건드리는 기존 파일을 읽는다 → 체크박스를 하나씩 수행하며 완료는 `- [x]`로 바꾼다 → 게이트 → 커밋 → 보고서에 태스크 요약(테스트 파일별 통과/실패 수, 커밋 해시, 계획과의 차이)을 추가한다.
3. **셀프 리뷰** (각 태스크 커밋 전, 2분): `git diff --staged`를 처음 보는 사람처럼 읽는다. 죽은 import, 쓰이지 않는 export, 계획에서 복사해 온 설명 주석, 콘솔 로그, 하드코딩된 날짜·숫자, 한국어 문구 오타를 잡는다. 테스트 이름이 동작을 설명하는지 본다.
4. **화면 태스크(7·8·9) 끝**: `NODE_OPTIONS= pnpm dev`로 띄워 `dev@finance.local` / `devdev1234`로 로그인하고, 1440px·390px 스크린샷을 `docs/design/swiss-ledger/investment-2026-09-28/impl/`에 저장해 참조 PNG와 나란히 비교한다. 색·간격·정렬·열 구성·타이포가 다르면 고친다. 데이터 차이(시세 없음, 빈 상태, 리서치 자리 비움)는 정상이다. 비교 결과를 화면별 한 줄로 적는다.
5. **Task 10**: 최종 게이트 여섯 명령을 전부 실제로 돌리고 출력 숫자를 적는다. e2e가 한 번에 통과하지 않으면 실패 스펙과 메시지를 적고, 셀렉터·문구만 실제 렌더에 맞춰 고친다. 검사하는 동작 자체를 바꾸지 않는다.

## 완료의 정의

다음이 전부 참일 때만 "완료"다. 하나라도 아니면 "부분"이고, 무엇이 빠졌는지 적는다.

- 10개 태스크의 체크박스가 전부 `- [x]`이고 태스크마다 커밋이 있다.
- `tsc --noEmit`, `lint`, `test`(유닛), `test:db`(통합), `build`, `e2e` 여섯 명령이 이 브랜치 끝에서 초록이고, 그 출력 숫자가 보고서에 있다.
- `/investment`에서 계좌 추가 → 입금·매수 입력 → 보유 표에 계좌·국내 소그룹·종목 행과 맞는 KPI → 종목 상세에서 보유 메모 저장 → 가계부로 전환 → `/`가 가계부로 가는 흐름이 E2E로 증명된다.
- 참조 PNG와 구현 스크린샷의 차이가 데이터 차이뿐이다.
- 보고서에 "계획과의 차이" 표가 있다(없으면 "없음"이라고 쓴 이유를 적는다. 차이가 하나도 없을 가능성은 낮다).

## 보고서

`docs/superpowers/plans/2026-09-29-investment-phase1-foundation.report.md`에 작업하면서 계속 쓴다. 끝나면 그 내용을 요약해 답한다. 순서:

1. 환경 확인 결과
2. 태스크별: 상태(완료/부분/미시작) · 테스트 결과(파일별 통과/실패 수) · 커밋 해시 · 계획과의 차이(파일 · 무엇을 · 왜)
3. 화면 비교(참조 PNG ↔ 구현, 화면별 한 줄)
4. 최종 게이트 여섯 명령의 실제 출력 요약
5. 하지 못한 것과 이유, 다음 세션이 이어서 할 일
6. 제안(이번 범위 밖이지만 발견한 개선점. 실행하지 않고 적기만)

문체: 짧게, 숫자로. "잘 됩니다" 대신 "유닛 23/23, 통합 10/10, 커밋 a1b2c3d". 돌리지 못한 것은 "실행 못 함 — 이유"라고 쓰고 통과라고 쓰지 않는다. 확신 없는 것은 확신 없다고 쓴다.

## 첫 행동

"먼저 읽을 것" 1~5를 읽는다. 다 읽은 뒤 Task 1에 들어가기 전에 다음만 짧게 답하라: 환경 확인 결과, 그리고 읽으면서 계획과 저장소 사이에 이미 보이는 불일치가 있으면 그 목록.

---

# 투자 1단계 구현 — Codex 실행 프롬프트

아래 블록을 그대로 Codex CLI(이 repo 루트에서 `codex`)에 붙여 넣는다. 전제: 브랜치 `feat/investment-phase1`, 로컬 Supabase 실행 중, `.env.local` 존재. 기준선(tsc·lint·유닛 756개)은 초록이다.

---

## 역할

너는 이 저장소(`/Users/leedj/workspace/Personal/finance-web`, Next.js 15 + Drizzle + Supabase 가계부 앱)의 시니어 엔지니어다. 이번 일은 **독립된 "우리집 투자" 공간의 1단계**: 스키마, 계산 모듈, 가계부↔투자 공간 전환 헤더, 수동 입력으로 동작하는 다섯 화면과 종목 상세·설정. 키움 연동과 AI 리서치는 다음 단계라 빈 자리만 만든다.

설계와 계획은 승인됐다. 네 책임은 설계가 아니라 실행의 질이다. 계획을 믿되 검증하고, 저장소의 기존 규약을 따르고, 끝났다고 말하기 전에 증거를 만든다.

## 먼저 읽을 것 (전부, 이 순서로)

1. `docs/superpowers/plans/2026-09-29-investment-phase1-foundation.md` — 실행 계획. 10개 태스크, 단계는 체크박스. 앞머리의 "앞선 계획에서 배운 것", "Global Constraints", "Review Focus", "시각 참조", "File Structure"가 뒤 태스크 전부의 규칙이다.
2. `docs/superpowers/specs/2026-09-28-investment-portfolio-design.md` — 근거 명세. 1·2·4.1·4.3·4.6절. 계획이 명세를 좁힌 곳("2단계에서 연결", "3단계 몫")은 의도된 것이다.
3. `docs/design/swiss-ledger/investment-2026-09-28/01…13.png`와 `docs/design/swiss-ledger/investment-2026-09-28.html` — 승인된 화면. 화면 태스크(4·7·8·9) 전에 해당 PNG를 연다.
4. `docs/design/swiss-ledger/README.md`, `src/app/globals.css` — 디자인 규칙과 토큰. 구현은 목업 CSS가 아니라 이 파일의 `t-*`, `finance-*`, `kpi-band` 클래스를 쓴다.
5. 기존 패턴 원본: `src/app/dashboard/page.tsx`, `src/features/assets/*`, `src/features/ledger/actions.ts`, `src/db/schema/diagnosis.ts`, `src/lib/household.ts`, `src/lib/revalidate.ts`, `tests/integration/asset-snapshot.test.ts`. 계획의 코드는 이 파일들의 규약을 따라 쓰였다.

## 작업 원칙

- **계획은 저장소를 읽고 쓴 초안이지 진실이 아니다.** 함수 시그니처, import 경로, Drizzle API가 실제와 다를 수 있다. 태스크를 시작할 때 계획이 건드리는 기존 파일을 직접 열어 대조하고, 다르면 저장소를 믿고 최소로 고친 뒤 보고서의 "계획과의 차이" 표에 파일·무엇을·왜를 적는다.
- **테스트가 설계를 고정한다.** 테스트를 먼저 쓰고, 실패 메시지를 확인하고, 구현하고, 통과를 확인한다. 테스트가 틀렸다고 판단되면 단언을 고치되 이유를 적는다. 통과시키려고 단언을 약화시키거나 케이스를 지우지 않는다.
- **저장소의 결을 따른다.** 서버 컴포넌트가 `requireHousehold()` 후 `queries.ts`를 직접 호출, 서버 액션은 `{ error }` 반환, 숫자는 `formatWon`, 컨트롤 높이 34/30px, 카드·그림자 없음. 더 나은 방식이 떠올라도 이번 범위에서 새 패턴을 들이지 않고 보고서 "제안"에 적는다.
- **작게, 읽히게.** 파일 하나에 책임 하나(계획의 File Structure가 경계). 주석은 "왜"만.
- **돈 계산은 의심한다.** 이동평균 단가·실현손익·원화 환산·비중은 순수 함수로 두고 테스트로 잠근다. 환율 없음, 시세 없음, 포지션 0에서 `NaN`·`Infinity`·`-0`이 화면에 나올 경로가 보이면 막고 테스트를 추가한다.
- **보안 경계.** 앱키·시크릿·토큰은 어디에도 적지 않는다(이번 단계엔 없어야 정상). 새 테이블은 전부 `household_id` + RLS + `GRANT SELECT TO authenticated`. 가구 격리는 통합 테스트로 증명한다.
- **막히면 멈춘다.** 같은 단계에서 세 번 연속 실패하면 시도·실패 내역을 적고 보고한다. 우회, `as any`, `@ts-ignore`, 테스트 skip은 하지 않는다.

## 절대 규칙

계획의 "앞선 계획에서 배운 것"과 "Global Constraints"가 그대로 절대 규칙이다(`NODE_OPTIONS=` 접두어, `git add`는 적힌 경로만, `--amend` 금지, 태스크 게이트). 거기에 없는 것 세 가지:

- 계획의 커밋 메시지에서 `Co-Authored-By: Claude …` 줄은 빼고 네 도구의 attribution으로 바꾼다.
- 명세·계획 본문은 바꾸지 않는다. 체크박스 `- [x]` 표시만 예외.
- 이번 작업과 무관한 미추적 파일(`docs/design/ai-diagnosis-*`, `docs/design/ui-*`, `docs/reviews/`, `docs/superpowers/plans/2026-09-07-*`, `outputs/`)이 `git status`에 보이는 건 정상이다. 스테이징·삭제하지 않는다.

## 절차

1. **환경 확인** (Task 1 전): `git status`에 추적 파일 수정(M)이 없는지, 브랜치가 `feat/investment-phase1`인지, `NODE_OPTIONS= pnpm dlx supabase@latest status`에 `DB_URL`이 나오는지. 하나라도 아니면 멈추고 보고한다.
2. **태스크마다**: 계획의 해당 섹션과 그 태스크가 건드리는 기존 파일을 읽는다 → 체크박스를 하나씩 수행하며 완료는 `- [x]`로 → 게이트 → 커밋 전에 `git diff --staged`를 한 번 읽어 죽은 import·쓰이지 않는 export·복사해 온 주석·콘솔 로그를 지운다 → 커밋 → 보고서에 태스크 요약을 추가한다.
3. **화면 태스크(7·8·9) 끝**: `NODE_OPTIONS= pnpm dev`로 띄워 `dev@finance.local` / `devdev1234`로 로그인하고, 1440px·390px 스크린샷을 `docs/design/swiss-ledger/investment-2026-09-28/impl/`에 저장해 참조 PNG와 나란히 비교한다. 색·간격·정렬·열 구성이 다르면 고친다. 데이터 차이(시세 없음, 빈 상태)는 정상이다. dev 서버는 확인 후 종료한다.
4. **Task 10**: 최종 게이트 여섯 명령을 전부 실제로 돌리고 출력 숫자를 적는다. e2e가 실패하면 셀렉터·문구만 실제 렌더에 맞춰 고치고, 검사하는 동작은 바꾸지 않는다.

## 완료의 정의

전부 참일 때만 "완료", 아니면 "부분"과 빠진 것.

- 10개 태스크의 체크박스가 전부 `- [x]`이고 태스크마다 커밋이 있다.
- `tsc --noEmit`, `lint`, `test`, `test:db`, `build`, `e2e` 여섯 명령이 브랜치 끝에서 초록이고 출력 숫자가 보고서에 있다.
- 계좌 추가 → 입금·매수 입력 → 보유 표와 KPI → 종목 상세 보유 메모 저장 → 가계부로 전환 → `/`가 가계부로 가는 흐름이 E2E로 증명된다.
- 참조 PNG와 구현 스크린샷의 차이가 데이터 차이뿐이다.
- 보고서에 "계획과의 차이" 표가 있다.

## 보고서

`docs/superpowers/plans/2026-09-29-investment-phase1-foundation.report.md`에 작업하면서 쓰고, 끝나면 요약해 답한다. 순서: 환경 확인 → 태스크별(상태 · 테스트 파일별 통과/실패 수 · 커밋 해시 · 계획과의 차이) → 화면 비교(화면별 한 줄) → 최종 게이트 출력 → 못 한 것과 이유 → 제안.

문체는 짧게, 숫자로. "잘 됩니다" 대신 "유닛 23/23, 통합 10/10, 커밋 a1b2c3d". 돌리지 못한 것은 "실행 못 함 — 이유"라고 쓰고 통과라고 쓰지 않는다.

## 첫 행동

"먼저 읽을 것" 1~5를 읽는다. Task 1에 들어가기 전에 환경 확인 결과와, 읽으면서 보인 계획↔저장소 불일치 목록만 짧게 답하라.

---

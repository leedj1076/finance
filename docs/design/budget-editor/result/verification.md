# C2 예산 편집기 검증 기록

기준 브랜치 `codex/budget-editor-redesign`, 최신 애플리케이션·테스트 commit `af63d9e` (2026-09-13 DB 인수 후속 수정). 이 기록은 로컬 브랜치와 인증된 합성 테스트 가구의 검증이며 운영 배포, 운영 DB 반영 또는 실제 사용자 가구 데이터 검증을 뜻하지 않는다.

## 2026-09-12 로컬 게이트 (이전 기록)

컨트롤러가 Task 9 문서 작업과 병행해 다음 명령을 애플리케이션·테스트 기준 commit에서 한 번 실행했다.

```sh
NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts
```

- 전체 명령 exit 0.
- TypeScript와 ESLint 통과.
- Vitest 80 files / 698 tests 통과, 11.57초.
- standalone Playwright 30/30 통과, 11.9초. 새 보고서 280,000원과 사용자가 편집한 310,000원을 구분하는 강화된 회귀도 포함한다.
- 기존 Vite future config 경고와 Playwright `NO_COLOR`/`FORCE_COLOR` 경고만 관찰됐다.

Task 8에서 동일한 애플리케이션 소스에 대해 `NODE_OPTIONS= pnpm build`가 exit 0이었고 22개 정적 페이지를 생성했다. 이후 변경은 테스트와 문서뿐이므로 Task 9에서 빌드를 중복 실행하지 않았다.

Task 2의 최종 회귀 근거도 런타임 산출물이 아닌 이 문서에 보존한다. `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`가 exit 0이었고, 당시 Vitest는 75 files / 674 tests를 통과했다. 빈 수동 입력을 0으로 바꾸지 않고 유효하지 않은 초안으로 유지하는 focused draft/fill 검증은 22/22 통과했다.

Task 6의 반응형 단계에서는 focused 3/3, TypeScript·lint 및 당시 81 files / 719 tests가 통과했다. 이후 구 panel 전용 테스트를 대체·제거한 최종 구성이 위 698개다. Task 2·6 scratch report는 Git 추적만 해제하고 ignored 로컬 파일은 보존했다.

## 2026-09-13 DB 인수 후속 검증

이전의 Docker 일시 정지 제약은 해소됐다. `supabase status` exit 0, 컨테이너 정상 응답, DB/API가 각각 `127.0.0.1:54322` / `127.0.0.1:54321`임을 확인한 뒤 테스트했다. 자격 증명은 출력하지 않았고 마이그레이션·DB 초기화·운영 접근은 하지 않았다.

| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS= pnpm test:db` | exit 0, 40 files / 315 tests, 42.74초 |
| 첫 `NODE_OPTIONS= pnpm e2e` | exit 1, 66 passed / 8 failed, 1.6분 |
| 수정 후 최종 `NODE_OPTIONS= pnpm e2e` | exit 1, 73 passed / 2 failed, 1.4분. 기존 8개 실패와 새 hydration 회귀는 모두 통과 |
| 최종 실패 두 건만 한 번 재실행 | exit 0, 2/2 통과, 28.1초. 코드 변경 없이 재실행 |
| `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test` | exit 0, TypeScript·ESLint 통과, 80 files / 698 unit tests, 9.46초 |
| production build | 최종 E2E의 `pnpm build && pnpm start --port 3101`에서 성공. 같은 소스의 빌드를 따로 중복 실행하지 않음 |

새 hydration 테스트를 포함한 standalone 31개도 최종 전체 E2E에 포함되어 통과했다. DB 조회·서버 코드 변경이 없어 315개 DB 테스트는 후속 HTML·테스트 수정 후 중복 실행하지 않았다. 기존 Vite loader, Next worktree root 추론, `NO_COLOR`/`FORCE_COLOR` 경고는 숨기지 않았다.

### 수정한 원인

- 저장된 AI 출처 캡션의 `<p>` 안에 팝오버의 block HTML이 들어가 브라우저 파싱 시 DOM이 바뀌었다. 실제 컴포넌트를 서버 렌더 → Chromium 파싱 → `hydrateRoot`로 연결한 회귀가 invalid HTML nesting으로 실패하는 것을 확인하고, 캡션만 같은 클래스의 `<div>`로 바꿔 통과시켰다. 저장 후 재로딩의 React 418 오류도 사라졌다.
- 목표 슬라이더와 팝오버를 함께 찾던 테스트 선택자, 숨긴 팝오버 제목을 찾던 이전 AI 출처 선택자를 실제 control/caption으로 좁혔다.
- 상한 350,000원보다 큰 수동 예산 저장 테스트에 명시적 초과 동의를 추가했다. 서버 안전장치는 유지했다.
- 다음 월 이동 전에 저장 완료를 기다리도록 하고, 통계 하위 셀은 기존 접힘 기본값을 유지한 채 테스트에서 명시적으로 펼쳤다.
- 삭제된 시뮬레이터의 숫자 입력 검증은 현재 예산·AI 예정 지출 입력의 원 단위 정수/음수/소수 검증으로 옮겼다. 테스트용 worker는 loopback 검증 후 로컬 DB에만 생성하며 가구 fixture와 함께 정리한다. 실제 모델 요청은 보내지 않는다.

### 남은 E2E 한계

최종 전체 실행의 두 실패는 예산 편집기 밖에서 발생했다. `month-close.spec.ts`의 모바일 마감 해제 후 상태 assertion은 아직 처리 중인 마감 상태를 보았고, `parity.spec.ts`의 인박스 제목 편집 시나리오는 대기 2건 대신 3건을 보았다. 이 두 건만 함께 한 번 재실행하자 둘 다 통과했다. 간헐적 재현으로 기록하며 원인을 확정하거나 수정했다고 주장하지 않는다. **최종 전체 실행은 73/75이며, 75/75 단일 전체 통과가 아니다.** 재현되지 않는 다른 기능을 임의로 바꾸거나 전체 테스트를 반복하지 않았다. 배포 전 단일 전체 green gate는 아직 확보되지 않았다.

보호된 저장 계약·저장 서비스·AI snapshot·worker·DB schema와 migration은 이 브랜치에서 변경하지 않았다. `BudgetForm`은 최종 233줄이다. 주 checkout은 확인 시 `c544621051a7535b0dbb5cb36111ad655161530e` 그대로였고, 그곳의 기존 미추적 파일은 건드리지 않았다.

## 브라우저 화면 검토

다음 네 결과는 실제 `BudgetForm`과 컴파일된 `src/app/globals.css`를 사용하는 standalone React fixture의 합성 데이터 화면이다. 로그인된 실제 가구 페이지나 운영 데이터가 아니다.

- [데스크톱 1440](synthetic-desktop-1440.png): 세 그룹, 네 참고 줄, 긴 항목명, 누락·0원·잠정 실적, AI 근거와 한 개의 선택 출처.
- [데스크톱 저축 목표](synthetic-desktop-target-1440.png): 실제 trigger 아래에 고정된 native popover와 정상 범위의 목표 control.
- [모바일 390](synthetic-mobile-390.png): 참고 선택 뒤 dirty 저장 상태, 가로 넘침 없는 공통 목록 계층.
- [모바일 전체 채우기](synthetic-mobile-menu-390.png): viewport 안의 native 메뉴와 탭 가능한 선택지.

컨트롤러가 네 최종 PNG를 모두 직접 확인하여 입력 바로 아래 4–6px 캡션, 선택 출처 한 개, 활성화된 모바일 저장, 가로 잘림 없음, 목표 popover anchoring과 메뉴 경계를 승인했다. fixture는 production main wrapper와 실제 source CSS를 쓰지만 DB-backed header, 월 이동, 상태 chip이 없고 Next font loader 대신 목업의 Apple SD Gothic Neo fallback을 사용한다. 쉘·데이터·행 수·폰트 차이가 있으므로 픽셀 동일성은 주장하지 않는다.

9월 13일에는 인증된 로컬 합성 가구에서 실제 Next 페이지를 추가로 캡처했다. 추천 완료 상태를 기다리고 팝오버를 닫은 [1440px 화면](local-desktop-1440.png)과 [390px 화면](local-mobile-390.png)을 컨트롤러가 직접 확인했다. 실제 앱 헤더·월 이동·상태 칩, 저장 310,000원과 원래 AI 추천 300,000원 출처·근거가 표시되며 가로 넘침이 없다. 모바일 전체 페이지 캡처 중간에 고정 하단 내비게이션이 보이는 것은 full-page 캡처 특성이다. 실제 사용자·운영 데이터가 아닌 테스트 fixture다.

브라우저 URL 정책으로 제공된 mockup HTML을 직접 열 수 없었다. 우회하지 않고 HTML source와 제공된 `01-desktop-editor.png`, `05-mobile-390.png`를 비교했다. 따라서 mockup HTML 자체의 런타임 브라우저 검사는 미검증이며, 위 네 PNG와 standalone 회귀가 허용된 대체 검증이다.

## 구현 중 독립 판단과 오판 비용

- 최근 3개월 평균은 종료된 최근 세 달 가운데 거래가 기록된 달만 포함하고 더 오래된 달로 보충하지 않았다. 잘못된 판단이면 평균 대상 기간과 관련 테스트를 조정해야 한다.
- Task 2에서는 단계별 gate를 유지하기 위해 구 form 호출부를 임시 이행하고 Task 7에서 제거했다. 잘못됐더라도 비용은 임시 코드 재작업에 한정된다.
- HTML browser 정책 제한에는 우회하지 않고 PNG와 HTML source를 사용했다. 이 판단이 부족하면 허용된 환경에서 mockup HTML runtime 검사를 추가해야 한다.
- 보호된 `save-service.ts` import를 유지하기 위해 `simulator-calculations.ts`를 한 줄 ceiling helper re-export로 남겼다. 불필요한 판단이면 server import 한 곳을 바꾸고 shim을 삭제하면 된다.
- 실제 지출 월 캡션을 표시하려고 UI 전용 `average3.spendMonths?`를 추가했다. 불필요하면 이 additive field를 제거하고 캡션을 줄이면 되며 snapshot·save·schema에는 영향이 없다.
- 과거 AI 작업의 원래 금액과 현재 금액이 같으면 `에서 조정` 없이 원래 추천 출처를 표시한다. 문구 판단이 틀리면 caption만 바꾸면 되고 저장 데이터는 달라지지 않는다.
- 보호된 AI snapshot에서 순수 계산을 계속 사용하므로 `tests/finance/budget-review.test.ts`는 유지하고 제거된 UI assertion만 대체했다. 틀렸다면 중복 테스트 유지 비용만 남는다.
- Docker 없이도 관찰 가능한 ownership 결함을 잡기 위해 standalone Playwright fixture와 controls 회귀를 Task 5부터 도입했다. 통합 방식이 바뀌면 작은 test-only config를 합치면 되며 runtime/API에는 영향이 없다.

## 삭제한 UI와 대체한 테스트

구 checkbox/apply/manual/panel UI를 구성하던 `src/features/budget-recommendations/panel.tsx`, `src/features/budgets/budget-reference.tsx`, `budget-row.tsx`, `simulator.tsx`를 삭제했다. `simulator-calculations.ts`는 위 보호 경계 때문에 re-export로 유지했다.

구 panel 전용 `tests/finance/budget-recommendation-panel.test.tsx`와 `budget-recommendation-panel-controls.test.tsx`는 삭제하고, 요청·복구·ownership은 `budget-recommendation-controls.test.tsx`, 근거는 `budget-ai-evidence.test.tsx`, 조립·참고·채우기는 `budget-form.test.ts`, `budget-plan-item.test.tsx`, `budget-plan-list.test.tsx`, `budget-plan-fill.test.ts`, 실제 React 상호작용은 standalone browser spec으로 대체했다. `tests/integration/simulator.test.ts`의 구 UI/시뮬레이터 assertion은 제거하고 살아 있는 loader/ceiling/read-model 검증을 해당 단위·통합 테스트에 유지했다. AI snapshot 순수 계산을 검증하는 `budget-review.test.ts`는 삭제하지 않았다.

## 최종 상태

문서 로컬 링크 검사, 보호 경로 비교와 `git diff --check`는 통과했다. `c544621..a8dbe77` 전체 브랜치와 Task 9 문서의 최종 통합 리뷰에서 Critical/Important 애플리케이션 결함은 발견되지 않았다. 가구 범위 조회, 저장·CAS·늦은 응답 소유권, AI 재검증·출처·취소, 기존 회귀의 이관을 확인했다. Minor 한 건은 새로 추적된 Task 6 scratch report였으며, 로컬 파일을 보존한 채 추적을 해제했다. 이 마지막 정리는 문서·추적 상태뿐이며 검증된 애플리케이션과 테스트 소스는 그대로다.

DB 통합·인증·persistence·저장 충돌·새로고침 검증을 실제로 실행했고 예산 개편 관련 회귀는 통과했다. 최종 전체 E2E의 두 간헐적 실패는 위 한계에 그대로 남긴다. `3341143..af63d9e` 후속 변경의 독립 scoped review는 스펙·품질 모두 승인했으며 Critical/Important 지적은 없었다. 저장된 출처 캡션의 최소 HTML 수정, 실제 hydration 회귀, 기존 E2E assertion 유지, 로컬 fixture 범위와 정리를 확인했다. 브랜치 `codex/budget-editor-redesign`과 worktree를 로컬에 보존하며 push, merge, 배포 또는 운영 작업을 하지 않았다.

## 2026-09-14 추이 열 검증

`docs/superpowers/specs/2026-09-14-budget-trend-column-design.md` 구현 뒤 브랜치 `feat/budget-trend-column`, 커밋 `826dbf1`에서 실행한 결과다.

시작 전 전달받은 전제는 "Docker Desktop이 수동으로 일시 정지돼 있어 로컬 Supabase(`127.0.0.1:54322`)에 접근할 수 없다"였다. 그런데 `NODE_OPTIONS= supabase status`를 실행하니 exit 0과 함께 DB `127.0.0.1:54322`, API `127.0.0.1:54321`가 정상 응답했다. imgproxy·edge_runtime·pooler 세 부가 컨테이너만 정지 상태였다. 출력에 포함된 키·비밀번호는 이 문서 어디에도 옮기지 않았다. 이 전제가 실제와 달랐기 때문에 이번 실행에서는 `pnpm test:db`와 `pnpm e2e`가 접속 실패 없이 실제로 로컬 DB에 붙어 돌았다. Docker를 켜거나 끄는 조작은 하지 않았고 이 상태 변화는 이 작업이 일으킨 것이 아니다.

| 명령 | 결과 |
|---|---|
| `NODE_OPTIONS= supabase status` | exit 0. DB `127.0.0.1:54322`, API `127.0.0.1:54321` 응답. 부가 컨테이너 3개 정지. Docker 일시 정지 전제와 다름 |
| `NODE_OPTIONS= pnpm exec tsc --noEmit` | exit 0, 오류 없음, 2.1초 |
| `NODE_OPTIONS= pnpm lint` | exit 0, 오류 없음, 5.0초 |
| `NODE_OPTIONS= pnpm test` | exit 0, 82 files / 717 tests 통과, 12.04초 |
| `NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts` | exit 0, 38 passed (38), 16.5초 |
| `NODE_OPTIONS= pnpm test:db` | exit 0, 40 files / 319 tests 통과, 103.38초. 접속 실패로 예상했던 것과 달리 실제로 돌았다 |
| `NODE_OPTIONS= pnpm e2e` | exit 1, 82개 중 81 passed / 1 failed, 약 1.7분 |
| `NODE_OPTIONS= pnpm build` | exit 0. 정적 3개·동적 19개, 총 22개 라우트 생성. `/budgets` 24.6 kB / First Load JS 133 kB |

### `pnpm test:db`로 처음 실행된 네 건

Task 2·3에서 작성된 뒤 지금까지 한 번도 실행되지 못했다고 알려졌던 통합 테스트 네 건이, DB가 실제로 열려 있던 이번 실행에서 돌았고 전부 통과했다.

- `tests/integration/budget-plan-sources.test.ts` → `trend carries the average months oldest first with their close state`
- `tests/integration/budget-plan-sources.test.ts` → `trend never leaks another household`
- `tests/integration/category-detail.test.ts` → `a major-only query sums every sub under that major`
- `tests/integration/category-detail.test.ts` → `a major-only query stays inside the household`

전체 집계(319개) 안에 섞인 결과를 그대로 믿지 않고 이 두 파일만 `--reporter=verbose`로 별도로 다시 돌려, 포함된 열 개 테스트 각각의 통과를 개별 확인했다(`Test Files 2 passed (2)`, `Tests 10 passed (10)`, 1.34초). 네 건 모두 **"unrun"이 아니라 실행되어 통과**로 기록한다. 이전 315개에 이 네 건이 더해져 319개가 된 것도 파일 수·테스트 수 델타(315→319, +4)와 정확히 일치한다.

### `pnpm e2e`: 81/82, 단일 전체 통과 아님

exit 1, 82개 중 81 passed / 1 failed였다. 실패한 한 건은 `tests/e2e/parity.spec.ts:258`의 인박스 제목 편집 시나리오로, 가져오기 작업 내비게이션에서 대기 2건을 기대했지만 3건이 보였다(`검토 대기3파일 업로드처리 기록미분류 거래0`). 2026-09-13 기록의 같은 시나리오 간헐적 실패(대기 2건 대신 3건)와 같은 패턴이다. 이 한 건만 단독으로 재실행하니 통과했다(`1 passed`, 28.0초). 브리프가 함께 지목했던 `month-close.spec.ts`의 모바일 마감 해제 케이스(734행, "current month is restricted and empty ended months require explicit consent in mobile dark mode")는 이번 전체 실행에서 처음부터 통과해 별도 재실행이 필요 없었다.

추이 열 관련 E2E 일곱 건(호버, 지난달 표시, sub 없는 요청, 클릭 토글, 키보드 포커스·Escape, 마감된 stale 월, 390px 탭)과 synthetic 스크린샷 회귀 모두 통과했다. **82/82 단일 전체 통과는 아니다.** 실패한 기능이나 다른 코드를 임의로 고치지 않았다.

### 합성 스크린샷 재생성

standalone 실행이 `docs/design/budget-editor/result/`의 `synthetic-desktop-1440.png`, `synthetic-desktop-target-1440.png`, `synthetic-mobile-390.png`, `synthetic-mobile-menu-390.png`를 다시 썼다. 기존 파일은 추이 열 이전 화면이었다(Task 6가 테스트 커밋에서 바이너리 변경을 빼려고 되돌려 둔 상태). 네 파일을 직접 열어 확인했다.

- 데스크톱 1440: 참고 열 오른쪽에 "추이" 열이 새로 보인다. "최근 3개월 실제 지출 · 칸에 올리면 거래 목록" 안내와 함께 각 행에 7월·8월·9월(지난달) 세 달 실적이 있다. 잘리거나 겹치는 요소 없음.
- 데스크톱 저축 목표: 목표 저축률 트리거 바로 아래 native popover가 고정되고, 추이 열은 가려지지 않고 그대로 보인다.
- 모바일 390: 카테고리마다 "7월 118,000  8월 122,000  9월·지난달 126,000" 형태의 한 줄 요약이 참고 블록 아래 표시된다. 가로 스크롤이나 잘림 없음.
- 모바일 전체 채우기: 펼쳐진 메뉴가 390px 뷰포트 안에 완전히 들어간다.

네 파일을 커밋한다. `local-desktop-1440.png`, `local-mobile-390.png`는 실제 로그인 세션과 라이브 DB로 캡처하는 파일로, `tests/e2e/budget-recommendation-persistence.spec.ts`가 `pnpm e2e` 실행 중 정상 테스트 절차의 일부로 두 파일에 스크린샷을 쓴다. 이번에는 Supabase가 실제로 응답했기 때문에 그 스펙이 끝까지 돌면서 두 파일도 추이 열이 보이는 최신 화면으로 덮어썼다. 하지만 이번 작업에 위임된 커밋 범위는 `synthetic-*.png` 네 개뿐이고 이 두 파일은 포함되지 않으므로, `git checkout`으로 커밋된 버전(추이 열 이전 화면)으로 되돌려 작업 트리에 남기지 않았다. 즉 최신 인증 화면을 가진 파일을 본 것은 맞지만 의도적으로 커밋하지 않았다. 저장소에 남은 `local-*.png` 두 파일은 여전히 추이 열 이전 화면이며 stale하다. 다시 캡처해 커밋할지는 컨트롤러가 별도로 정할 일로 남긴다.

### standalone 브라우저 스위트가 기준선에서 red였던 이유

추이 팝오버가 끌어들인 `next/link`가 모듈 스코프에서 `process.env.__NEXT_*` 라우터 플래그를 읽는데, standalone 번들러 설정(`tests/e2e/fixtures/budget-editor-browser.ts`)이 그 값을 정의하지 않아 실제 브라우저에서 번들이 "process is not defined"로 로드 시점에 터졌다. boot()의 첫 assertion에 닿기도 전에 스위트 전체가 실패하는 기준선이 있었고, Task 6가 그 파일에 필요한 플래그를 정의해 고쳤다. 이번 실행은 추이 관련 일곱 건이 더해진 38/38이다.

### 보호 경계

브랜치 병합 기준점 `9af8e2b`부터 `826dbf1`까지 바뀐 파일을 전부 나열해 확인했다. `save-contract.ts`, `save-service.ts`, `budget-recommendations/snapshot.ts`, `budget-recommendations/worker.ts`는 목록에 없다. DB 스키마·마이그레이션 변경도 없다. 바뀐 것은 `src/features/analytics/*`, `src/features/budgets/*`와 그 테스트들, `eslint.config.mjs`(Task 1, 중첩 워크트리를 lint ignore에 추가), `src/app/globals.css`뿐이다.

## 2026-09-15 참고·추이 열 너비 재조정

`ui-alignment-followup` 후속 작업에서 `.plan-item`의 기본 네 번째 열(추이)을 `360px`에서 `248px`로 줄이고 그 112px를 참고 열에 넘겼다. 이 브랜치의 앞 커밋 `56fdcd8`까지는 이미 `main`에 병합(`f01fa63`)되어 배포 중이므로, 이 변경은 라이브 코드에 대한 후속 변경이다.

### 근거

`.plan-trend__cell`은 `110px 110px minmax(0, 1fr)`에 14px gap 두 개이므로 실제로 쓰는 폭은 248px다. 세 번째 트랙은 모바일 전용 라벨·구분자를 담는데 데스크톱에서는 `display:none`이라 **측정값이 92px의 빈 트랙**이었다. 반면 참고 열은 행에서 가장 넓은 내용을 담는다. `/budgets`의 참고 행 72개와 추이 셀 54개를 각 요소의 실제 computed font로 재어 얻은 트랙별 최대 내용은 다음과 같다.

| 트랙 | 최대 내용 | 폭 |
|---|---|---|
| 참고 label | `지난달 예산` | 57px |
| 참고 amount | `1,176,587` | 62px |
| 참고 caption | `3·4·5월 · 3·4·5월 3회 · 잠정` | 130px |
| 추이 month | `5월 · 지난달` | 55px |
| 추이 amount | `1,298,764` | 62px |
| 항목 | `생활용품` | 58px |

`.plan-reference__option`의 좁은 트랙 밴드도 같은 112px만큼 줄어 `1335.98px` → `1223.98px`에서 끝난다. 참고 열은 `viewport − 792`이고 데스크톱 옵션 트랙은 캡션에 `참고 − 302`를 남기므로, 캡션이 130px에 도달하는 지점이 1336px에서 **1224px**로 당겨졌다. `1024–1195` 밴드는 유지했다. 추이 248px는 이제 기본값과 같아졌지만 항목 160px가 여전히 참고에 40px를 벌어 주며, 1024px에서 캡션 트랙이 그것을 뺐을 때 4px, 두었을 때 44px로 측정됐다.

390px/640/641/700/800/900/1023/1024/1100/1195/1196/1204/1250/1300/1335/1336/1400/1440/1600에서 확인했다. 월·금액·항목 이름은 어느 폭에서도 잘리지 않고, `.plan-item__references`와 `.plan-trend` 바깥으로 넘치는 자식도 없으며, 캡션 트랙이 0이 되는 구간도 없다.

**닫히지 않은 잔여 문제:** 1024px에서 44px, 641px에서 53px인 캡션 잘림은 그대로다. 두 반응형 밴드가 이미 추이를 248px로 고정하고 있어 기본 규칙이 그 구간에서 완전히 덮이기 때문이며, 변경 전후 측정값이 동일하다. 이 변경이 개선한 구간은 1196px 이상뿐이다.

### 다시 생성한 이미지

- [데스크톱 1440](synthetic-desktop-1440.png), [데스크톱 저축 목표](synthetic-desktop-target-1440.png): 참고 행이 오른쪽으로 112px 넓어지고 추이 열이 좁아졌다. 추이의 월·금액 쌍이 이전처럼 빈 공간을 사이에 두고 떨어져 있지 않고 붙어서 오른쪽 끝에 정렬된다. 잘리거나 겹치는 요소는 없다. 위 표의 설명은 그대로 유효하다.
- [로컬 1440](local-desktop-1440.png): 같은 열 변화가 실제 로그인 페이지에서도 보인다. 이 파일은 2026-09-14 기록에서 "추이 열 이전 화면이라 stale"로 남겨 둔 것이라 이번 갱신에는 추이 열 도입분까지 함께 반영된다. 라이브 캡처라 날짜(`14일 경과` → `15일 경과`)와 AI 추천 시각도 함께 바뀐다.

**모바일 390px 이미지 두 개는 바꾸지 않았다.** `@media (max-width: 640px)`가 기본 열을 완전히 덮으므로 이 변경은 390px에 닿지 않는다. 배포된 `56fdcd8`의 `globals.css`를 트리에 넣고 합성 스크린샷 테스트를 그대로 다시 돌려 확인했고, `synthetic-mobile-390.png`와 `synthetic-mobile-menu-390.png`는 두 CSS에서 **바이트 단위로 동일**했다(데스크톱 두 장은 예상대로 달랐다). 따라서 모바일 이미지가 커밋된 baseline과 다른 부분은 이 변경이 아니라 그 전부터의 drift이며, 이 커밋에 섞지 않았다.

### 이 변경과 무관한 관찰

`month-nav.tsx`의 월 입력은 `w-[124px]` 고정에 `t-body-strong`(13px/600)이라, 웹폰트 `IBM Plex Sans KR`가 적용된 상태에서 `September 2026`이 `September 20…`으로 잘린다. 이 파일은 이 브랜치에서 건드리지 않았고 배포된 `main`과 바이트가 같으므로 기존 문제이며, 지금 라이브에서도 재현된다. 이번 변경 범위 밖이라 고치지 않고 기록만 남긴다.

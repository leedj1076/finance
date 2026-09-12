# C2 예산 편집기 검증 기록

기준 브랜치 `codex/budget-editor-redesign`, 애플리케이션·테스트 기준 commit `22acf2e570cb6adee1b180c31cd409f8ee984575`. 이 기록은 로컬 브랜치 검증이며 운영 배포, 운영 DB 반영 또는 인증된 실제 가구 화면 검증을 뜻하지 않는다.

## 최종 로컬 게이트

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

## 열려 있는 DB 기반 게이트

로컬 Docker/Supabase가 수동으로 일시 정지된 상태라 `pnpm test:db`와 DB-backed `pnpm e2e`는 이번 개편에서 실행하지 않았다. Task 8에서 관련 3개 spec의 7개 테스트가 수집되는 것까지만 확인했으며 실행 통과로 계산하지 않는다. Docker를 재개하고 DB/API hostname이 loopback인지 다시 확인한 뒤 두 게이트를 실행하기 전에는 실제 persistence, 인증 가구 페이지, DB concurrency를 최종 승인할 수 없다.

보호된 저장 계약·저장 서비스·AI snapshot·worker·DB schema와 migration은 이 브랜치에서 변경하지 않았다. `BudgetForm`은 최종 233줄이다. 주 checkout은 확인 시 `c544621051a7535b0dbb5cb36111ad655161530e` 그대로였고, 그곳의 기존 미추적 파일은 건드리지 않았다.

## 브라우저 화면 검토

다음 네 결과는 실제 `BudgetForm`과 컴파일된 `src/app/globals.css`를 사용하는 standalone React fixture의 합성 데이터 화면이다. 로그인된 실제 가구 페이지나 운영 데이터가 아니다.

- [데스크톱 1440](synthetic-desktop-1440.png): 세 그룹, 네 참고 줄, 긴 항목명, 누락·0원·잠정 실적, AI 근거와 한 개의 선택 출처.
- [데스크톱 저축 목표](synthetic-desktop-target-1440.png): 실제 trigger 아래에 고정된 native popover와 정상 범위의 목표 control.
- [모바일 390](synthetic-mobile-390.png): 참고 선택 뒤 dirty 저장 상태, 가로 넘침 없는 공통 목록 계층.
- [모바일 전체 채우기](synthetic-mobile-menu-390.png): viewport 안의 native 메뉴와 탭 가능한 선택지.

컨트롤러가 네 최종 PNG를 모두 직접 확인하여 입력 바로 아래 4–6px 캡션, 선택 출처 한 개, 활성화된 모바일 저장, 가로 잘림 없음, 목표 popover anchoring과 메뉴 경계를 승인했다. fixture는 production main wrapper와 실제 source CSS를 쓰지만 DB-backed header, 월 이동, 상태 chip이 없고 Next font loader 대신 목업의 Apple SD Gothic Neo fallback을 사용한다. 쉘·데이터·행 수·폰트 차이가 있으므로 픽셀 동일성은 주장하지 않는다.

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

문서 로컬 링크 검사, 보호 경로 비교와 `git diff --check`는 Task 9 commit 전에 통과했다. DB-backed release gate는 열려 있고, 이 문서를 포함한 전체 브랜치의 최종 통합 리뷰는 컨트롤러가 Task 9 commit 뒤 수행할 예정이므로 아직 완료로 기록하지 않는다. 브랜치는 로컬에만 두며 push, merge, 배포 또는 운영 작업을 하지 않는다.

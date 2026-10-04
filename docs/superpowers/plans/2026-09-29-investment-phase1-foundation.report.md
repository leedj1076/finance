# 투자 1단계 실행 보고서

## 환경 확인
- 시작: feat/investment-phase1 · b068da4. 추적 파일 변경 0. 무관한 미추적 파일 유지.
- Supabase: status exit 0 · 로컬 DB 127.0.0.1:54322. DB 명령은 로컬 CLI 환경을 명시해 실행. 비밀값 저장 없음.
- 기준 유닛: 85파일 · 756/756. 기존 Vite 설정 로더 경고 1종.
- 실행: 지정 체크아웃에서 순차 구현. 마지막 별도 리뷰. push·배포 없음.

## 태스크별
### Task 1 — 완료
- RED: 스키마 export 없음 → beforeAll 실패. 신규 테스트 실행 못 함(러너가 6 skipped로 표기; skip 코드는 없음).
- 구현: 10개 테이블·RLS·SELECT GRANT, 0011 마이그레이션 로컬 적용.
- investment-schema.test.ts: 최초 GREEN 시도 11통과/5실패(Drizzle 오류 래핑 단언 불일치) → 원인 단언 수정 후 16/16.
- tsc: exit 0. lint: exit 0. 유닛: 85파일 · 756/756.
- 전체 통합: 43파일 중 42통과/1실패 · 347건 중 346통과/1실패 · 48.67초.
- 실패: tests/integration/simulator.test.ts > uses only completed-month transactions from the requested household. 평균 수입 예상 3,000,001, 실제 32,000,001.
- 원인: 2026-09가 진행 중이라는 fixture 전제인데 getBudgetData의 기본 now=new Date()를 사용. 현재 10월이므로 9월 수입 90,000,000도 평균에 포함. 해당 테스트와 쿼리는 시작 커밋 대비 변경 0.
- 사용자 계속 진행 승인 후 동일 조회 구현 readBudgetData(db, householdId, '2026-09', 2026-09-15) 사용. getBudgetData 래퍼는 now 인자를 노출하지 않음. import 2곳·호출 1곳 변경, 단언·운영 계산식 변경 없음.
- 재검증: 통합 43파일 · 347/347 (50.05초), 유닛 85파일 · 756/756, tsc/lint exit 0.
- 커밋: 904cb6f.

### Task 2 — 완료
- investment-format.test.ts: RED 모듈 없음 → GREEN 6/6 (기본 3 + 비유한값 3).
- 게이트: tsc/lint exit 0. 유닛 86파일 · 762/762.
- 커밋: fa4f384.

### Task 3 — 완료
- investment-calculations.test.ts: RED 모듈 없음 → GREEN 21/21 (계획 코드 13 + 경계값 8).
- 게이트: tsc/lint exit 0. 유닛 87파일 · 783/783.
- 커밋: d94039a.

### Task 4 — 완료
- app-header-space.test.tsx: RED 모듈 없음 → GREEN 4/4.
- 게이트: tsc/lint exit 0. 유닛 88파일 · 787/787.
- PNG 01·10 헤더 확인. 공간별 메뉴·모바일 메뉴·루트 쿠키 라우팅 구현.
- 커밋: b2cfba1.

### Task 5 — 완료
- investment-transaction-input.test.ts: RED 모듈 없음 → GREEN 18/18.
- revalidate.test.ts: RED 신규 도메인 없음 → GREEN 5/5.
- 첫 tsc: it.each 추론의 optional undefined 오류 1 → Record<string, string> 명시. 단언 변경 없음.
- 게이트: tsc/lint exit 0. 유닛 89파일 · 806/806.
- 커밋: d9ad4bc.

### Task 6 — 완료
- RED: queries/actions 모듈 없음. GREEN: investment-queries.test.ts 9/9, investment-actions.test.ts 14/14.
- 추가: 가구 격리·미인증·동시 매도·과거 매도·매수 삭제·비활성 계좌·중복 계좌·키움 메모 전용·동시 관심 추가·월 경계·단가 미상·당시 환율.
- 게이트: tsc/lint exit 0. 유닛 89파일 · 806/806. 통합 45파일 · 370/370 (53.24초).
- 커밋: f2bba5c.

### Task 7 — 완료
- investment-components.test.tsx: RED 모듈 없음 → 9/9. 추가 RED 해외 미평가·환율 없음에서 국내 합계 누락 → 10/10.
- 게이트: tsc/lint exit 0. 유닛 90파일 · 816/816.
- dev 로그인·1440/390px 촬영. 모바일 scrollWidth 390/viewport 390; KPI 175px × 2; 행 펼치기·새로고침 후 계좌 접힘 유지 통과.
- 재촬영 로그인 리디렉션 1회 timeout. 로그 확인 후 재시도 통과. 최종 E2E에서도 확인 예정.
- 실제 페이지는 Task 8이므로 합성 fixture로 dashboard 임시 미리보기. 촬영 후 원본 복구, SpaceMemo 2줄만 남음. dev 서버 종료.
- 커밋: 41bc35c.

### Task 8 — 완료
- investment-pages.test.tsx: RED 모듈 없음 → 4/4; 추가 RED 미평가 KPI·컨트롤 높이 → 6/6.
- 게이트: tsc/lint exit 0. 유닛 91파일 · 822/822.
- 로컬 빈 상태 3화면, 합성 계좌·거래로 1440/390px 6장. USD 선택 표시·공간 전환 통과. 페이지 가로 넘침 0.
- 촬영 스크립트의 select 라벨 exact 판정 1회 timeout → 실제 name 속성으로 수정 후 통과. 합성 행만 ID/가구 조건으로 삭제, dev 종료.
- 커밋: cc163e8.

### Task 9 — 완료
- investment-detail.test.tsx: RED 모듈 없음 → 3/3. 추가 RED 단가 미상·미평가·컨트롤 높이 → 6/6.
- investment-queries.test.ts: 추가 RED 키체인 별칭·3개월 가격 누락 → 11/11 (기존 9 + 신규 2).
- 게이트: tsc/lint exit 0. 유닛 92파일 · 828/828 (9.68초). 통합 45파일 · 372/372 (44.44초).
- 브라우저: 계좌 → 입금·매수 → 보유/KPI → 메모 저장·새로고침 통과. 1440/390px 8장 + 실제 다크 테마 1장. 가로 넘침 0, 페이지 오류 0.
- 합성 데이터만 ID/가구 조건으로 제거. dev 서버 종료. 커밋: 9755906.

### Task 10 — 완료
- investment.spec.ts: 최초 0/1. 가계부 전환 직후 `/`가 투자로 돌아가는 실제 쿠키 갱신 경합 확인.
- 전환 링크 클릭에서 쿠키 즉시 기록, SpaceMemo도 같은 헬퍼 사용. 검사 동작 변경 없이 1/1 (34.2초, 테스트 5.0초).
- 계좌/관심 추가·입금/매수·초과 매도 거부·평균단가/예수금·접힘 유지·보유 메모 reload·390px 펼침·가계부 복귀 증명.
- 첫 전체 E2E: 113통과/6실패 (2.6분). 기존 auth/parity의 중복 텍스트 2건, diagnosis의 옛 탭 순서 2건은 셀렉터/문구만 수정. 투자/정기거래의 간헐적 React 418 2건은 dev 모드 반복 6/6에서 재현 안 됨; 오류 검사를 유지하고 전체 재검증.
- 전체 재검증: 119/119 (2.4분), retry/skip 없음. 간헐적 오류가 고쳐졌다고 단정하지 않음. 커밋: 1d85484. 커밋 뒤 투자 E2E도 1/1 (33.2초).

### 최종 독립 리뷰 — Important 3건 수정
- 범위: b068da4..1d85484. 별도 리뷰어 1회. Critical 0 / Important 3 / Minor 1. 재리뷰 없음.
- Important 1: 비활성 계좌를 보유·상세·추이·어드바이저·관심 제외 판정에서 동일하게 제외. 거래 이력은 유지.
- Important 2: 시세 미상 포지션이 분모에 포함되면 종목·시장 소계 비중 전체를 대시로 표시. 환율 없음에 따른 해외 제외 정책은 유지.
- RED: investment-calculations.test.ts, investment-components.test.tsx, investment-queries.test.ts 합계 42통과/3실패. GREEN: 22/22 + 11/11 + 12/12 = 45/45 (0.972초).
- Important 3: 계좌·관심 종목·수동 거래·거래 메모·보유 메모의 서버 검증 실패 후 초안 보존. 신규 입력만 성공 후 초기화, 저장 중 편집 잠금.
- 브라우저 RED: investment.spec.ts 0/1, 값 보존 단언 16건 실패. 첫 수정 뒤 select 2건, onReset 취소 시도 뒤 select 3건 실패. 설치된 React가 commit 중 이벤트를 비활성화한 상태로 native reset을 호출하므로 onReset은 해결책이 아님을 확인. 기존 예산 폼처럼 onSubmit에서 기본 동작을 취소하고 transition 안에서 액션을 명시 호출. 초안은 제어 상태로, 신규 입력 초기화는 성공 시에만 처리. 단언 삭제·완화 없음.
- 최종 집중 GREEN: investment.spec.ts 1/1 (34.5초, 실제 동작 5.2초). 오류 후 시장·계좌·날짜·메모·수량·단가·투자 기간·손실 한도·비중 분모 보존, 성공 시 신규 입력 초기화, 저장 후 재진입 확인.
- Minor 보류: research_jobs_security_check의 mode=NULL 허용. 1단계 쓰기 경로 없음. 3단계 실행 경로 추가 전에 NOT NULL 조건·거부 테스트 필요.
- 보완 커밋: 0315515 활성 계좌 / 69c1f39 비중 계산 / 581c7c0 소계 표시 / 46a8aa1 초안 보존. 각 변경과 해당 회귀 테스트를 함께 커밋.
- 보완 후 전체: tsc/lint 0, 유닛 830/830, 통합 373/373, 빌드 28/28, E2E 119/119. Critical·Important 미해결 0.

## 계획과의 차이
| 태스크 · 파일 | 무엇을 | 왜 |
|---|---|---|
| 1 · drizzle/0011_investment.sql | 0010 대신 0011 생성 | 0010은 정기거래 영업일 방향 마이그레이션이 사용 중 |
| 1 · investment-schema.test.ts | 두 가구 구성, 10개 테이블의 RLS·권한 검증 | 비회원 조회 0건만으로 가구 격리를 증명할 수 없음 |
| 1 · investment-schema.test.ts | rejects.toThrow에서 cause.constraint_name 검사로 변경 | 현재 Drizzle은 PostgreSQL 제약조건 오류를 cause로 감쌈. 제약조건 이름 검사는 유지 |
| 실행 환경 | CLI에서 로컬 환경을 주입 | .env.local 기본값으로 운영 DB를 건드리는 경로 방지 |
| 1 · tests/integration/simulator.test.ts | 테스트 기준 날짜 고정 | 10월 이후에도 9월 진행 중 fixture를 동일하게 검증. 사용자 계속 진행 승인 |
| 2 · format.ts | 비유한값·표시 반올림 후 음의 0 차단, MINUS 내부 상수 | 사용자 금액 안전 규칙. 쓰이지 않는 export 방지 |
| 3 · investment-calculations.test.ts | 입금 fixture KRW 9,664,000 / USD 2,413 | 매수 이후 예수금 기대 1,120,000 / 640을 성립시킴. 기존 기대값 유지 |
| 3 · calculations.ts | 단가 미상 손익 null, 청산 단가 초기화, 잘못된 시세·환율 배제, 평균단가 6자리 | 미상 단가를 0으로 간주한 허위 이익과 NaN 방지. 계산 명세 유지 |
| 4 · app-header-menu.tsx | 투자 톱니는 설정 페이지 직접 링크 | Interfaces의 톱니 목적지 준수. 닫힌 팝오버를 SSR에서 검사하는 계획 충돌 해결; 가계부 팝오버 유지 |
| 4 · app-header.tsx, globals.css | 투자에서는 인박스 조회 생략; 브랜드 수직 중앙 정렬 | 공간 독립성·참조 헤더 정렬 유지 |
| 5 · transaction-input.ts | 실제 날짜·원문 소수 자리·안전한 수치 범위 검증, 현금 거래의 잔여 종목값 무시 | DB 자동 반올림·Infinity·잘못된 통화 추론 차단 |
| 5 · revalidate.ts | 동적 종목 상세도 page 단위 갱신 | 6개 정적 경로만으로 상세 메모·보유 수치가 갱신되지 않음 |
| 6 · queries.ts | monthBounds 종료일 미포함; 단가 미상 이익 제외 | 실제 monthBounds는 다음 달 1일 반환. 단가 미상은 이익 0원이 아님 |
| 6 · queries.ts | 추이에 예수금·순입금과 당시 환율 사용, 미평가 날짜 제외 | 총 평가금액·투입원금 명세. 최신 환율로 과거를 왜곡하거나 미상 가격을 0원 처리하지 않음 |
| 6 · actions.ts | 가구 단위 트랜잭션 락·시간순 잔고 검사, 최종 변경에도 가구 조건 | 동시 실행·과거 날짜·삭제 시 음수 포지션과 테넌트 경계 누락 차단 |
| 6 · actions.ts | 비활성 체크·잘못된 ID·중복 계좌·동시 관심 추가 검증 | 계획의 unchecked=true와 예외 노출·중복 삽입 경합 수정 |
| 7 · holdings-table.tsx | 가구별 저장 키·키보드 접기·모바일 행 펼치기·3개 합계·시장 필터 prop | 명세 4.6 필수 동작이 계획 코드에서 누락. 기존 단언 유지 |
| 7 · globals.css, page-shell.tsx, status-line.tsx | KPI 모바일 2열·폰트 20·경계선, 모바일 소유자 줄, 상태 줄 간격 보정 | 기존 전역 KPI 규칙과 목업의 충돌 해소. 1440/390px로 비교 |
| 7 · 미리보기·스크린샷 | 임시 합성 미리보기 제거 후 impl PNG 3개 저장 | 공통 부품만 있는 Task 7에서도 화면 검증 요구를 이행 |
| 8 · page.tsx | 시장 URL 토글과 가구별 HoldingsTable 연결, 미평가·단가 미상 KPI는 대시 | 명세 4.6 필터, 알려지지 않은 값을 0원으로 표시하지 않는 규칙 |
| 8 · transaction-form/transactions/watch-form | 통화 동기화·활성 계좌 제한·34px 컨트롤·저장 상태·접히는 입력 폼 | 계획의 USD 표시 오류, 빈 계좌 제출, 성공 피드백 누락 보완. 목업의 인라인 펼침 유지 |
| 9 · queries.ts, investment-queries.test.ts, detail/page, trend-chart | 가구별 3개월 가격 조회·종가/평균단가 차트, 설정의 키체인 별칭 반환 | 명세 4.6과 종목 상세 목업의 가격 비교는 AI 영역이 아님. 초안에서 누락되어 기존 조회 테스트에 2개 추가 |
| 9 · detail/trend/advisor, allocation-bars | 단가·시세 미상은 대시, 환율 없으면 해외 비중 제외, 유한값/막대 폭 제한 | 알려지지 않은 비용·가격을 0으로 계산한 허위 손익·100% 예수금 표시 차단 |
| 9 · account-form, holding-memo-form | 34px 컨트롤, 좁은 화면 그리드, v-regex의 하이픈 이스케이프 | 저장소 시각 규칙·브라우저 유효성 검사 준수. 비중 설명은 실제 계산 분모인 주식 계좌로 명시 |
| 10 · investment.spec.ts | 실제 heading·summary·button 셀렉터; 예수금·메모 reload·모바일 검사 추가 | 계획의 tr 토글은 접근성 button으로 구현. 행동 단언은 유지/강화 |
| 10 · app-header-menu, space, space-memo | 공간 링크에서 쿠키 즉시 저장 | E2E가 발견한 `/`의 이전 공간 복귀 버그. 렌더 후 effect만 기다리지 않음 |
| 10 · tests/e2e/auth, diagnosis, parity | 저장/오류 표시를 실제 행·셀로 한정, 탭 순서를 실제 렌더로 정정 | 사용자 지침의 셀렉터·문구 수정 범위. 기존 행동 검사 유지 |
| 최종 리뷰 · queries.ts, investment-queries.test.ts | 활성 계좌 기준으로 현재 포트폴리오 조회 통일, 전체 거래 이력 유지 | 보유와 상세·추이의 수량·현금·비중 불일치 재현 |
| 최종 리뷰 · calculations.ts, holdings-table.tsx, 계산·렌더 테스트 | 미평가 포지션이 분모에 있으면 비중 전체 미확정 | 시세 미상 자산을 0원 취급한 허위 100% 방지 |
| 최종 리뷰 · 입력 폼 5개, investment.spec.ts | 제어된 초안·명시적 제출·성공 시 신규 입력 초기화 | { error }도 완료된 폼 액션이라 사용자 입력을 지우는 실제 브라우저 버그 |

## 화면 비교
- Task 7 · 헤더/상태/KPI/표: PNG 01·02·10과 비교. 48px/20px 여백, KPI 4열/2열, 표 8열/3열 확인. 차이는 합성 데이터·시세/리서치 연결 상태. `impl/task7-desktop.png`, `task7-mobile.png`, `task7-mobile-expanded.png`.
- Task 8 · 보유/거래/관심: PNG 01·04·05·10·11과 비교. 헤어라인·열 정렬·34px 컨트롤·모바일 2열 KPI 확인. 미실행 AI 열은 1단계 빈 상태. `impl/task8-{holdings,transactions,watch}-{desktop,mobile}.png`.
- Task 9 · 추이/어드바이저/상세/설정: PNG 03·06·07·09·12·13과 비교. 데스크톱 좌우 영역·모바일 세로 배치·메모 폼·다크 토큰 확인. 시세·AI 없는 상태의 높이/내용 차이는 의도적. `impl/task9-{trend,advisor,detail,settings}-{desktop,mobile}.png`, `task9-detail-dark.png`.
- 최종 E2E 보유 캡처 1440/390px 재확인. 2계좌·삼성전자 120주·평균단가 71,200·예수금 1,456,000, 시세 미상 대시·모바일 펼침·가로 넘침 0. 테스트 합성 데이터이며 운영 값 아님.

## 최종 게이트 출력
최종 리뷰 보완 코드(46a8aa1과 동일한 소스)에서 순서대로 실행. DB·빌드·E2E는 CLI에서 확인한 localhost 환경을 명시. 이후 변경은 보고서뿐:
| 명령 | 결과 |
|---|---|
| NODE_OPTIONS= pnpm exec tsc --noEmit | exit 0 · 오류 0 |
| NODE_OPTIONS= pnpm lint | exit 0 · 오류 0 |
| NODE_OPTIONS= pnpm test | 92파일 · 830/830 · 12.08초 |
| NODE_OPTIONS= pnpm test:db | 45파일 · 373/373 · 50.85초 |
| NODE_OPTIONS= pnpm build | exit 0 · 정적 페이지 28/28 · 컴파일 5.1초 |
| NODE_OPTIONS= pnpm e2e | 119/119 · 2.3분 · retry/skip 0 |
- 기존 경고: Vite CJS 설정 로더 1종, Playwright NO_COLOR/FORCE_COLOR 충돌. 실패 없음.
- E2E 캡처: `test-results/investment-investment-spac-1b7e1-totals-collapse-detail-memo-chromium/investment-desktop.png`, `investment-mobile.png`.
- 기존 예산 E2E가 다시 쓴 `docs/design/budget-editor/result/` PNG 6개는 스테이징하지 않음.

## 판단 기록 — Rulings I made
발생 순서. 각 항목은 선택·이유·잘못됐을 때의 비용이다.

1. 지정 체크아웃/feat 브랜치 유지. 사용자 지정 경로 우선. 비용: 작업 디렉터리 추가 격리 없음; 무관한 파일은 보존.
2. DB 명령에 CLI 로컬 환경 명시. 운영 dotenv 기본값 회피. 비용: 로컬 Supabase가 없으면 검증 실행 불가.
3. 0010 대신 0011 마이그레이션, RLS 두 가구·10개 테이블 검사. 기존 번호 보존. 비용: 계획의 파일명과 다름.
4. Drizzle 오류의 cause.constraint_name 단언. 실제 오류 래핑에 맞춤. 비용: 래핑 계약 변경 시 테스트 수정 필요.
5. simulator fixture의 날짜 고정. 동일 reader·기대값 유지. 비용: 해당 테스트는 실제 현재 날짜가 아닌 고정 시점을 검사.
6. 계산 fixture 입금액 보정, 미상 단가/시세/환율을 null로 유지. 기대 잔액과 금융 안전 규칙 준수. 비용: 추정 이익 대신 빈 수치가 늘어남.
7. 투자 톱니는 설정 직접 링크, 가계부 인박스 조회 생략. 공간 독립성·Interfaces 준수. 비용: 투자에서 기존 설정 팝오버를 쓰지 않음.
8. 실제 날짜·원문 소수 자리·안전 범위 검증, 동적 상세 revalidation. DB 반올림·경계값 누락 방지. 비용: 입력이 더 엄격하고 갱신 범위가 넓음.
9. 월 종료일 미포함·시점별 환율·예수금/순입금 추이, 가구 락·시간순 잔고 검증. 실제 저장소 계약과 정합성 준수. 비용: 쓰기 락 지연, 입금일 환율 기준 수익률과 다른 차트 해석.
10. 가구별 접힘 저장·키보드/모바일 펼침·통화별 합계·시장 prop 추가. 명세 4.6 누락 보완. 비용: 후속 페이지에 householdId/market 전달 필요; 임시 합성 미리보기는 제거.
11. 페이지 URL 필터·미평가 KPI·통화 동기화·활성 계좌 제한·성공 피드백. 실제 수동 사용 가능성과 목업 준수. 비용: 불완전 데이터에서 표시/입력 제한.
12. 종목 상세 3개월 가격 차트·키체인 별칭 반환 추가. 명세 4.6의 누락된 일반 기능이며 AI 기능이 아님. 비용: 상세 조회 1개 추가.
13. 공간 링크 클릭에서 쿠키 즉시 저장. E2E가 재현한 루트 복귀 경합 해결. 비용: 내비게이션 실패 시에도 선호 공간은 먼저 변경됨.
14. 기존 E2E의 중복 텍스트 셀렉터·옛 탭 순서만 정정. 실제 렌더와 일치, 행동 검사 유지. 비용: 저장/오류 단언이 특정 desktop 행/셀에 한정됨.
15. 활성 계좌 거래로 현재 포트폴리오 집계 통일, 전체 거래 이력은 유지. 화면 수치 일치. 비용: 비활성화 계좌는 과거 포트폴리오 곡선에서도 제외됨.
16. 포함된 미평가 자산이 있으면 분모 기반 비중 전체 미확정. 허위 100% 방지. 비용: 시세가 들어오기 전 표시 수치가 줄어듦.
17. 초안 보존 + 명시적 제출/초기화 + 저장 중 편집 잠금. 실제 입력 유실 회귀 해결. 비용: 저장 완료 전 필드 수정 불가; 서버 액션 계약은 동일.
18. 키움 동기화/폴링·AI 실행/리포트는 후속 단계 유지. 승인된 범위. 비용: 현재 자동 시세/AI 사용 불가.
19. 섹터/통화 노출/소유자/계좌 비중 선택과 연환산 수익률은 후속 유지. 승인된 계획. 비용: 분석 컨트롤 제한.
20. 추이 원금을 각 관측일 환율로 계산하는 기존 Task 6 정책 유지. 테스트와 일치. 비용: 환율 변동이 평가금액과 원금 양쪽에 반영되며 입금일 원가 수익률은 아님.
21. 불완전 수동 입금 이력을 위한 음수 예수금 허용. 초과 주식 매도 거부와 구별. 비용: 실제 은행 결제 잔고 검증이 아니므로 기록 보완 필요.
22. 인증된 계좌 편집기의 전체 번호 표시 유지, 보유는 뒤 4자리. 편집 목적. 비용: 설정 화면 캡처 공유 전 비식별 처리 필요.
23. 간헐적 React 418은 해결 주장하지 않음. 후속 통과와 별개로 오류 단언 유지. 비용: 재발 가능, 발생 경로·스택 확보 필요.

## 못 한 것과 이유
- Task 1~10 및 최종 검증 완료. push·병합·배포·운영 DB 변경 없음(이번 실행 범위 밖). feat/investment-phase1 유지.
- 키움 연동·자동 시세 수집·AI 리서치 실행은 승인된 2·3단계 몫이며 빈 상태만 구현.
- Deferred minors: research_jobs_security_check의 mode NULL 제약 보완 1건. 현재 생성 경로가 없어 후속 단계 전 보완 대상으로 기록.

## 제안
- 3단계 작업 생성 경로를 연결하기 전에 보류한 mode 필수 제약과 거부 테스트를 먼저 추가.
- React 418 재발 시 캡처된 페이지 경로·스택으로 원인 규명. 오류 검사 제거나 무조건 재시도로 숨기지 않음.

## 후속 릴리스 — 2026-10-05
- 사용자 승인: 다음 단계 중 1번(main 병합·운영 DB 반영·푸시·배포). 위의 배포 미실행 기록은 승인 전 개발 단계의 상태.
- 원격 확인: origin/main fbe19aa, feature 2bbd0d5. 충돌 없이 fast-forward로 main 병합. 무관한 PNG 6개·미추적 파일·기존 stash 보존.
- 병합 후 유닛: 92파일 · 830/830 · 9.65초. 애플리케이션 소스는 위 최종 6종 게이트 실행본과 동일.
- 운영 DB: 서울 프로젝트의 기존 0000~0010 Drizzle 해시 11개가 저장소와 일치. 0011_investment 하나만 트랜잭션으로 적용, 이력 12개.
- 마이그레이션 SHA-256: `2476dc8ce62730b216910bb0fe124eae5f4b6a31ea6d9b5eb63b6faaf9f0fdfe`.
- 검증: 신규 테이블 10/10 RLS 활성·authenticated SELECT 허용·쓰기 불가·anon 접근 불가·가구 조회 정책 1개씩. 기존 테이블 21/21 건수와 거래 금액 합계 불변(거래 2,852건).
- 백업: `~/.local/share/finance-web/backups/2026-10-05-investment-phase1.nGK0gV/`. public/drizzle 스키마 71,517바이트·데이터 2,149,404바이트. 0600 파일, 저장소 밖 보관. `before.json`, `after.json`, 트랜잭션 SQL도 보관.
- 스키마 백업 SHA-256: `2c43928db4c8023d91040c45493cbd382958a40e7b9d9876830d7e65e031548a`. 데이터 백업 SHA-256: `1273cd3bcb5718045c9540a17c78730aeaaa061f4aa179588496fa6df2a1ea87`.
- 배포 대상: Vercel finance / icn1 / `www.blissful.family`. 이전 Ready 배포 `dpl_6kho3oUDnxMxFo6rEzJdJggvuReA`를 롤백 기준으로 확인.
- 이 기록의 시점은 DB 적용 완료·코드 푸시 전. 배포는 main 푸시 후 진행하고 Ready·운영 응답을 별도로 확인한다. 키움·AI 후속 단계는 실행하지 않는다.

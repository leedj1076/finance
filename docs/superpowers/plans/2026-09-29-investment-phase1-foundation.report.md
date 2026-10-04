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
- 커밋: 공통 화면 태스크 커밋(다음 기록에서 해시 갱신).

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

## 화면 비교
- Task 7 · 헤더/상태/KPI/표: PNG 01·02·10과 비교. 48px/20px 여백, KPI 4열/2열, 표 8열/3열 확인. 차이는 합성 데이터·시세/리서치 연결 상태. `impl/task7-desktop.png`, `task7-mobile.png`, `task7-mobile-expanded.png`.

## 최종 게이트 출력
실행 전.

## 못 한 것과 이유
Task 8~10 진행 예정. push·배포·운영 DB 변경 없음.

## 제안
없음.

# Flask 패리티 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 Flask 앱(/Users/leedj/workspace/Personal/finance)에 있는데 finance-web에 없는 기능 16건(MISSING 10 + PARTIAL 6)을 포팅해 기능 패리티를 만든다. 특히 카드사 명세서 업로드와 대시보드 상세 기능.

**Architecture:** **Flask 코드가 정본 명세다** — 각 Task는 Flask의 정확한 함수/템플릿을 참조해 동작·수식·규칙을 그대로 옮긴다(수치 로직은 1:1, UI는 web의 기존 컴포넌트 패턴으로). 데이터 접근은 기존 web 패턴(서버 컴포넌트 + `requireHousehold()` + Drizzle householdId 필터) 유지.

**Tech Stack:** 기존 finance-web 스택. 신규 의존성: `xlsx`(SheetJS — 카드 파일 xlsx/BIFF/HTML 파싱)만.

**Spec:** 이 플랜의 감사표(아래) + Flask 원본 코드. 참조 경로: `/Users/leedj/workspace/Personal/finance/{app.py,card_import.py,templates/*.html,static/*.js}`. 실카드파일: `/Users/leedj/workspace/Personal/finance/imports/`(개인정보 — repo 복사 금지, 로컬 검증만).
카드 파서의 완성된 TS 코드는 `docs/superpowers/plans/2026-09-01-smart-classification.md`의 Task 4에 이미 있음(그대로 사용 — 단독 동작 코드).

## Global Constraints

- **모든 Drizzle 쿼리에 householdId 필터** (owner 접속은 RLS 우회).
- **저축률 = (수입−지출)/수입** (순저축 기준). 저축납입은 별도 보조지표. 목표 기본 30%.
- **월평균 분모 = 완료월**(진행 중인 현재 월 제외, `months_elapsed` 개념) — 현재월 데이터는 표시하되 평균 분자에서도 제외.
- 금액 정수 KRW. 월키 'YYYY-MM'.
- 차트/UI는 web의 기존 컴포넌트·스타일 패턴을 따른다(새 차트 라이브러리 도입 금지 — 기존 차트 컴포넌트가 쓰는 방식 재사용).
- 브랜치 `feat/flask-parity`에서 작업, Task마다 커밋. 테스트는 `pnpm test`(로컬 Supabase 필요, 베이스라인 52 passed), 실카드파일 검증은 로컬 수동.
- Flask 수치 로직 포팅 시 **동작 변경 금지** — 개선하고 싶은 게 보여도 노트만 남기고 1:1 포팅.
- smart-classification 플랜(머천트 캐시+AI)은 이 패리티 뒤에 별도 실행 — 이 플랜에서 confidence/merchant_lookup을 만들지 않는다.

## 감사표 (이 플랜이 메우는 갭)

MISSING: ①카드사 명세서 5종 업로드 ②월말 지출 예측 ③safe-to-spend ④결제수단별 월별 차트+테이블 ⑤항목별 월별 상세 테이블(셀 제외/호버 툴팁) ⑥카테고리 상세 페이지 ⑦연간결산 ⑧변동비 감축 시뮬레이터 ⑨뱅샐 자산 스냅샷 자동 upsert ⑩미분류 일괄 분류
PARTIAL: ⑪사후 예산초과 알림(확인 후 보완) ⑫ledger 필터(확인 후 보완) ⑬재무건강 신호등+고정비비율 ⑭파이 drill-down 링크 ⑮카테고리 차트 legend 토글/강조 ⑯인박스 flow 변경 시 대분류·소분류 동적 전환(확인 후 보완)

---

### Task 1: 카드사 명세서 업로드 (갭①)

**Files:**
- Create: `src/features/inbox/parsers/cards.ts`, `tests/finance/card-parsers.test.ts`, `tests/finance/card-upload.test.ts`
- Modify: `src/features/inbox/upload-action.ts`(+`uploadCardStatement`), 업로드 UI(인박스/임포트 화면의 업로드 폼), `package.json`(+xlsx)

**Interfaces:**
- Produces: `parseCardStatement(buffer, issuer): CardRow[]`, `cardFingerprint(issuer, owner, row, occurrenceIdx)`, `looksLikeBanksalad(buffer)`, `CARD_ISSUERS`, `uploadCardStatement(formData): Promise<{error?: string}>`(필드 file/issuer/owner).
- **명세**: 파서 코드와 테스트는 `docs/superpowers/plans/2026-09-01-smart-classification.md` **Task 4 Step 2·4의 코드를 그대로** 사용(카드 5종 헤더 키워드·합계/소계 중단·SheetJS 3종 포맷 — 원명세는 Flask `card_import.py`). 업로드 액션은 같은 플랜 Task 7 Step 1·3을 기반으로 하되 **confidence/resolveSuggestions 참조를 제거**하고 기존 스테이징 방식(buildHistorySuggester 제안 → sugSource 'history'/null, 뱅샐 매핑 없음)으로 단순화. `source_tag` 개념: transactions.source = `card:{issuer}` (apply 시 — inbox에 소스 구분 저장 방법은 기존 스키마 필드 활용, 없으면 `pay` 필드에 카드사 라벨 + apply에서 uid 접두사 'card:'로 판별).

- [ ] Step 1: `pnpm add xlsx` 후 파서+테스트를 smart-classification Task 4 코드로 작성 → `pnpm test tests/finance/card-parsers.test.ts` PASS
- [ ] Step 2: 실파일 로컬 검증(같은 플랜 Task 4 Step 6의 tsx 스니펫) — 5종 각 0건 초과 파싱, 실패 시 파서 보정
- [ ] Step 3: `uploadCardStatement` + 멱등/동일행 보존 테스트(같은 플랜 Task 7 Step 1 테스트) → PASS
- [ ] Step 4: 업로드 UI에 "카드사 명세서" 모드(카드사+소유자 선택) 추가, `pnpm test` 전체 green
- [ ] Step 5: commit `feat(inbox): card statement upload (5 issuers) into inbox pipeline`

### Task 2: 가계부 완성 — 월말 예측 + safe-to-spend + 알림/필터 보완 (갭②③⑪⑫)

**Files:**
- Create: `src/features/ledger/forecast.ts`, `tests/finance/forecast.test.ts`
- Modify: `src/app/ledger/page.tsx`, `src/features/ledger/`(필터), `src/features/budgets/pace.ts`(사후 초과 확인)

**Interfaces/명세 (Flask):**
- `expense_forecast`: app.py `def expense_forecast` (~705행) — 현재월 run-rate(경과 5일↑이고 MTD>0이면 `MTD/경과일×월일수`), 아니면 완료월 평균. `{projected, basis: 'run_rate'|'hist_avg', mtd}` 반환.
- `safe_to_spend`: app.py `def safe_to_spend` (~734행) — `상한 = 월평균수입(완료월)×(1−목표저축률)`, `남은 돈 = 상한 − MTD지출`, `일 권장 = 남은 돈/남은 일수`. 목표율은 settings.
- 사후 초과: Flask ledger 라우트의 `over_budget`(실제>예산 목록) — web pace.ts가 사전경고만이면 사후 목록 추가.
- 필터: Flask `ledger_filters()`(account/fflow/fmajor/q, add/edit/delete 후 유지) — web ledger에 없으면 searchParams 기반으로 추가.

- [ ] Step 1: forecast/safe-to-spend 순수함수 + 테스트(경계: 5일 미만→hist_avg, 수입 0, 남은일 0) → PASS
- [ ] Step 2: ledger 페이지에 예측 바 + "더 쓸 수 있는 돈" 히어로(일 권장액 포함) 렌더
- [ ] Step 3: 사후 초과 알림·필터 현황 확인 후 부족분 구현(이미 있으면 증거 남기고 skip)
- [ ] Step 4: `pnpm test` green, commit `feat(ledger): month-end forecast + safe-to-spend + filters/over-budget parity`

### Task 3: 대시보드 — 항목별 월별 상세 테이블 (갭⑤)

**Files:**
- Create: `src/features/analytics/category-detail.ts`(데이터), `src/features/analytics/category-detail-table.tsx`(클라이언트), `src/app/api/cell-tx/route.ts`(호버 툴팁 데이터), `tests/finance/category-detail.test.ts`
- Modify: `src/app/dashboard/page.tsx`

**명세 (Flask):** `api_category_detail`(app.py 562) + `api_cell_tx`(597) + dashboard.html의 `renderCatTable`/`showCellTip`(셀 클릭=합계 제외 토글 cellEx, 호버 180ms 지연 툴팁=그 (대분류,소분류,월)의 거래 목록 금액순+합계/건수, 15건 초과 "외 N건", 현재월 '진행' 마커, **월평균=완료월 기준**(합계−현재월)/완료월수, 소계/총계 행).

- [ ] Step 1: 데이터 함수(대분류>소분류×월 매트릭스 + divisor + currentMonth) 테스트 → 구현 → PASS
- [ ] Step 2: cell-tx route handler(householdId 필터 필수: flow/year/month/major/sub → 거래 목록) 테스트 → PASS
- [ ] Step 3: 테이블 컴포넌트(클릭 제외 토글은 클라 상태, 호버 툴팁 fetch+캐시+지연) — Flask dashboard.html JS가 UX 명세
- [ ] Step 4: `pnpm test` green + 수동 확인, commit `feat(dashboard): category detail table with cell exclude + hover tx tooltip`

### Task 4: 대시보드 — 결제수단별 월별 + 차트 상호작용 + 재무건강 (갭④⑬⑮)

**Files:**
- Create: `src/features/analytics/account-monthly.ts`, 컴포넌트, `tests/finance/account-monthly.test.ts`
- Modify: `src/app/dashboard/page.tsx`, 기존 카테고리 차트 컴포넌트, 재무건강 표시부

**명세 (Flask):** `api_by_account_monthly`(507: 결제수단×월 시리즈, 데이터 없는 월 null) + dashboard.html 테이블(colSum>0 월만 컬럼) / 카테고리 차트 legend chips(클릭 토글·hover 강조, dashboard.html 317-333) / `financial_health`(892): 저축률·비상금 개월수(현금성자산÷월평균지출)·부채비율·**고정비비율(fixed÷지출)** 4개 good/ok/warn 신호등, 자산 미입력 시 "자산 입력 필요".

- [ ] Step 1: account-monthly 데이터 함수 테스트 → 구현 → 차트+테이블 렌더
- [ ] Step 2: 카테고리 차트에 legend 토글/hover 강조(기존 차트 컴포넌트 패턴 내에서)
- [ ] Step 3: 재무건강을 대시보드에 4지표 신호등으로(고정비비율 추가, 임계값은 Flask 값 그대로)
- [ ] Step 4: `pnpm test` green, commit `feat(dashboard): account monthly + chart interactions + financial health lights`

### Task 5: 카테고리 상세 페이지 + drill-down 연결 (갭⑥⑭)

**Files:**
- Create: `src/app/category/page.tsx`(searchParams: flow/major/ym|year), 데이터 함수, `tests/finance/category-page.test.ts`
- Modify: 대시보드 파이/항목별 테이블·분석 테이블에서 해당 페이지 링크

**명세 (Flask):** `/category`(1162) + category.html — 선택 대분류의 소분류 breakdown, **가맹점 TOP 10**, 거래 리스트.

- [ ] Step 1: 데이터 함수 테스트 → 페이지 구현 → 기존 화면들에서 링크 연결
- [ ] Step 2: `pnpm test` green, commit `feat(analysis): category drill-down page + links`

### Task 6: 연간결산 페이지 (갭⑦)

**Files:**
- Create: `src/app/report/page.tsx`, `src/features/analytics/report.ts`, `tests/finance/report.test.ts`
- Modify: 네비게이션

**명세 (Flask):** `/report`(940) + report.html — 연 수입/지출/순저축/저축납입 + 전년 대비(YoY), 연 저축률+최고/최저 월, 지출 TOP6, 최대 단일지출, **6개월 현금흐름 예측**(현금성자산 시작 + 월평균 순흐름 누적).

- [ ] Step 1: report 데이터 함수 테스트(YoY·TOP6·예측 수식은 Flask와 동일 결과) → 구현
- [ ] Step 2: 페이지 + 네비 링크, `pnpm test` green, commit `feat(report): annual report with YoY + 6-month cashflow forecast`

### Task 7: 예산 — 변동비 감축 시뮬레이터 (갭⑧)

**Files:**
- Create: `src/features/budgets/simulator.tsx`, `tests/finance/simulator.test.ts`(계산 로직)
- Modify: `src/app/budgets/page.tsx` 또는 budget-form.tsx

**명세 (Flask):** budgets.html의 "변동비 감축 시뮬레이터" — 변동비 대분류별 월평균(완료월) + 감축액 입력(-10%/-20% 칩) → `예상 저축률 = (월평균수입 − (월평균지출−Σ감축))/월평균수입` 실시간 + 목표까지 남은 갭 + "이 감축안을 이번 달 예산에 반영"(예산 입력 필드 채움, 저장은 기존 버튼).

- [ ] Step 1: 계산 훅/함수 테스트 → 컴포넌트 구현(기존 budget-form의 그룹 데이터 재사용)
- [ ] Step 2: `pnpm test` green, commit `feat(budgets): variable-spend cut simulator`

### Task 8: 뱅샐 자산 스냅샷 + 미분류 일괄 분류 + 인박스 flow 전환 (갭⑨⑩⑯)

**Files:**
- Modify: `src/features/inbox/upload-action.ts`(+자산 스냅샷 upsert), `src/features/inbox/banksalad.ts`(뱅샐현황 시트 파싱 — Flask `banksalad_import.parse_status` 명세: 예금 합계/청약/적금/투자평가액/대출, owner별), `src/app/manage/…`(미분류 일괄 분류 탭), `src/features/inbox/inbox-review-form.tsx`(flow 전환 확인/보완)
- Test: `tests/finance/asset-snapshot.test.ts`, 기존 인박스 테스트 확장

**명세 (Flask):** `_bs_upsert_asset_snapshots`(업로드 체크박스 기본 ON, asset_accounts 이름 매칭 자동생성 + balance_snapshots(month) upsert, 대출은 liability) / `/classify`(1791)+classify.html(미분류 거래 일괄 카테고리 지정) / 인박스 flow 변경 시 대분류·소분류 목록이 그 flow 것으로 재구성(inbox.html의 fillMajor/fillSub).

- [ ] Step 1: 뱅샐현황 파싱+스냅샷 upsert 테스트(합성 xlsx 픽스처) → 구현(업로드 폼 체크박스 기본 ON)
- [ ] Step 2: 미분류 일괄 분류 화면(기존 manage 패턴) + 서버 액션 테스트
- [ ] Step 3: 인박스 flow 전환 동작 확인 — 대분류 목록이 안 바뀌면 보완(테스트 or 수동 증거)
- [ ] Step 4: `pnpm test` green, commit `feat(inbox): banksalad asset snapshots + bulk classify + flow-switch parity`

### Task 9: E2E + 마감

**Files:**
- Create: `tests/e2e/parity.spec.ts`

- [ ] Step 1: E2E 2개 — (a) 카드 합성파일 업로드→인박스 표시→반영→가계부 확인, (b) 대시보드에 항목별 테이블·연간결산 링크 렌더 확인
- [ ] Step 2: `pnpm e2e` + `pnpm test` + `pnpm build` 전부 green, commit `test(e2e): parity flows`

---

## Self-Review

- 감사표 16건 ↔ Task 매핑: ①T1 ②③⑪⑫T2 ⑤T3 ④⑬⑮T4 ⑥⑭T5 ⑦T6 ⑧T7 ⑨⑩⑯T8 — 전부 커버.
- Flask 참조는 함수 단위 정본 명세(포팅 대상 코드가 실존·검증됨 — 이 세션에서 작성/검증된 로직). 파서 TS 코드는 smart-classification 플랜 Task 4에 완성본 존재.
- PARTIAL 항목(⑪⑫⑯)은 "확인 후 부족분만" — 이미 있으면 증거 남기고 skip 허용.
- 타입/이름: CardRow/CardIssuer/parseCardStatement/cardFingerprint/uploadCardStatement — smart-classification 플랜과 동일 서명(후속 플랜이 이 위에 confidence를 얹음).

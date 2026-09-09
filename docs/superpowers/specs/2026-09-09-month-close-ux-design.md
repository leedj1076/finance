# 월 마감 UX: 숨기지 않는 통계와 내역의 마무리 체크리스트

상태: 설계 확정 (2026-09-09, 사용자 "다 확정"). 이 문서는 `2026-09-09-monthly-close-design.md`의 표시·집계 정책 일부를 대체한다. 데이터 모델·트리거·RLS·마감 액션은 바꾸지 않는다.
기준 코드: `f0bce6a` (2026-09-09).
설계 그림: [월 마감 UX 설계](https://claude.ai/code/artifact/1e1ba1ec-3cff-4a86-bafd-8528be081dd8), [합치기 vs 쌓기](https://claude.ai/code/artifact/c6f0f048-07ab-4af2-aec3-b47e3a05ff6d), [체크리스트 위치 3안](https://claude.ai/code/artifact/cfc5e8be-025a-461a-b80a-e6c36174045d).

## 1. 왜 바꾸나

월 마감을 넣은 뒤 화면 점검에서 네 가지가 걸렸다.

1. 월말에 할 일이 네 곳에 흩어져 있다. 마감은 내역 상단 버튼, 다음 달 예산은 예산의 월말 리뷰, AI 진단은 내역의 탭, 정리 대상(대기·미분류·미반영)은 가져오기. 홈의 할 일 목록에는 마감이 없다.
2. 초기 정책이 "기존 월은 전부 미마감"이라 배포 직후 통계가 `마감한 월이 없습니다`만 보여준다. 한 달씩 다이얼로그로 마감해야 통계가 돌아온다.
3. 마감·잠정을 설명하는 문장이 페이지에 15줄 있다. 홈 헤더는 본문 전에 안내 문장 세 개를 읽게 한다.
4. 홈의 자산 카드는 뱅크샐러드를 올릴 때만 바뀌어 한 달 내내 `전월보다 +0원`이고, 순자산 추이는 위 KPI 카드와 중복이며, 돈의 흐름 폭포 차트는 월급이 들어오기 전에는 음수 막대만 보인다.

## 2. 결정 기록

브레인스토밍에서 순서대로 정했다. 각 항목은 대안을 보고 고른 것이다.

| 갈림길 | 결정 | 버린 대안 |
| --- | --- | --- |
| 통계에서 미마감 월 | **모두 보이되 잠정으로 표시** (점선·회색) | 마감 월만 보이고 나머지 숨김 (현재) |
| 평균·전월 대비·전년 비교·예측의 입력 | **마감 월만. 마감 월이 부족한 칸은 비우지 않고 회색 잠정 값 + `잠정` 표시** | 12개월 전부 계산 · 진행 중인 달만 제외 |
| 마무리 체크리스트 위치 | **내역 상단. 홈은 할 일 한 줄** | 홈 상단에 필요할 때만 · 홈 상단에 항상 |
| 체크리스트와 기존 마감 컨트롤 | **쌓기** — 체크리스트 아래에 기존 컨트롤과 확인 창을 그대로 둠 | 합치기 (체크리스트 4번째 줄이 마감 버튼) |
| 홈 제거 | **자산 카드, 순자산 추이, 이번 달 돈의 흐름 제거** | 유지 |
| 설명 문장 | **월 단위 화면 제목 옆 상태 칩 하나로 대체** | 유지 |

핵심 원칙 한 줄: **확정 값이 있으면 확정 값, 없으면 회색 잠정 값. 빈 칸은 없다.** 마감은 "통계 진입 조건"에서 "우리가 확인했다는 표시이자 평균·비교를 확정시키는 동작"으로 뜻이 바뀐다. 마감 후 원장 변경 시 재확인 필요로 돌아가는 동작은 그대로다.

## 3. 화면 설계

### 3.1 내역 · 마무리 체크리스트 (쌓기)

조회 월이 **끝났고 상태가 `open`** 일 때만 기존 `MonthCloseControl` 위에 체크리스트 블록을 놓는다. 진행 중인 달, `closed`, `needs_review`에서는 지금처럼 컨트롤 한 줄(칩 + 한 문장 + 버튼)만 있다.

블록 구성:

- 머리: `8월 마무리` · `정리 2 / 3` · 우측 `정리가 끝나면 아래에서 마감합니다`
- 정리 항목 세 줄. 각 줄은 점(완료 초록, 진행 주황, 대기 회색) · 이름 · 건수 · 우측 링크.
  - `가져오기 대기 N건` → `/inbox` (해당 월 대기 건수 = `MonthCloseSummary.pendingCount`)
  - `정기거래 미반영 N건` → 같은 화면의 기존 `미반영 N건 반영` 폼 (`unpostedRecurringCount`). 0건이면 `정기거래 반영 완료`
  - `미분류 거래 N건` → `/inbox?tab=unclassified` (`unclassifiedCount`). 부제 `분류하면 통계의 카테고리 표에 들어갑니다`
- 선택 항목 한 줄: `AI 진단 · 9월 예산 만들기 · 선택 · 마감 뒤에` → `/ledger?month=…&tab=ai`, `/budgets/review?month=…`
- 세 건수가 모두 0이면 정리 항목 세 줄이 `정리 완료 · 아래에서 마감` 한 줄로 접히고 선택 항목만 남는다. 아래 컨트롤의 `월 마감` 버튼은 초록으로 바뀐다.
- 마감하면 블록이 사라지고 컨트롤만 남는다.

기존 컨트롤과 확인 창은 유지한다. 확인 창은 전체 합계, 대기·미분류·미반영 세 건수, 남은 항목이 있을 때의 동의 한 줄, 버튼을 그대로 보여준다. 세 건수가 체크리스트와 겹치는 것은 마감 직전의 마지막 확인으로 두기로 한 결정이다. 확인 창과 컨트롤의 문구에서 "마감한 월만 통계에 포함"은 "확정 값으로 계산"으로 바꾼다.

체크리스트 상태 도출은 순수 함수로 두고 단위 테스트한다: `wrapUpSteps(summary: MonthCloseSummary, month, currentMonthKey)` → `{ visible, steps[], allClear }`.

### 3.2 홈 · 할 일 한 줄과 제거

- `HomeTodoKind`에 `close`를 추가한다. 우선순위 0으로 목록 맨 위. 대상은 **끝난 월 중 상태가 `open` 또는 `needs_review`인 가장 최근 월**이다.
  - `open`: 제목 `8월 마무리하기`, 상세 `미분류 5건 · 마감 전` (건수는 대기·미분류·미반영 중 0이 아닌 것만, 모두 0이면 `정리 완료 · 마감 전`), 링크 `/ledger?month=2026-08`
  - `needs_review`: 제목 `8월 다시 마감하기`, 상세 `마감 뒤 내역이 바뀌었습니다`
  - 대상 월이 둘 이상이면 제목 `8월 · 7월 마무리하기`, 상세 끝에 ` · 2개월`, 링크는 가장 최근 월
- `getHomeTodos`는 이전 12개월의 월 상태를 `readMonthStatuses`로 읽고, 대상 월의 `readMonthCloseSummary`로 건수를 얻는다. 홈이 아직 읽지 않던 데이터이므로 `Promise.all`에 합친다.
- 홈 상단 KPI는 두 칸: 순저축률 링, 이번 달 더 써도 되나. `자산이 늘고 있나` 카드와 그 데이터 로드(`getNetWorthSeries`)를 제거한다.
- `순자산 추이`와 `이번 달 돈의 흐름` 섹션을 제거한다. `CashflowWaterfall`과 `src/features/analytics/net-worth.ts`는 다른 사용처가 없으면 삭제한다. `getDashboardData`의 `current.fixedExpense / variableExpense / cashRemaining`는 통합 테스트가 덮고 있고 고정비 비율 계산에 재사용될 값이므로 읽기 모델에는 남긴다.
- 헤더의 안내 문장 세 개(`이번 달 · 잠정`, `홈의 금액·비교·추이는 미마감 내역을 포함한…`, `모든 수치는 월 단위 · 지난 달은 내역, 다른 해는 통계에서`)는 제목 옆 칩 `2026년 9월 · 진행 중 · 9일 경과 / 30일`로 대체한다. 지난 달·다른 해 링크는 사라진다. 각각 내역·통계 주 메뉴가 그 역할을 한다.

### 3.3 통계 · 숨기지 않고 잠정으로

**표시 규칙**

- 12개월 스트립: `closed` 초록 실선, 끝난 `open` 주황 점선 `미마감`, `needs_review` 빨강 점선 `재확인 필요`, 진행 중 잉크 실선 `진행 중`, 미래 흐린 `예정`. 클릭은 지금처럼 `/ledger?month=…`. 미마감 월은 도착지에 체크리스트가 있다.
- 헤더 칩: `2026년 · 마감 5개월 · 잠정 3개월 (6·7·8월)`. "월평균은 마감 월 기준" 문장은 뺀다.
- 막대 차트(수입·지출·저축): 마감 월은 채운 막대, 끝난 미마감 월과 진행 중인 달은 빗금 막대(`prov` 색 테두리). 진행 중인 달은 열 위에 `진행 중`, 미마감 월은 `잠정` 라벨. 미래 월은 비어 있다.
- 순저축률 선: 양 끝이 모두 마감인 구간은 실선, 한쪽이라도 미마감이면 점선. 마감 점은 채움, 미마감 점은 빈 원. 연 누적은 `마감 5개월 37.5%` 를 진하게, `잠정 포함 33.9%` 를 회색으로 함께 적는다.
- 항목별 월별 표: 끝난 미마감 열은 회색 글씨, 헤더에 `잠정`. 진행 중인 달은 기울임과 `진행 중`. 미래는 `—`. 평균 열은 **마감 월만**(헤더 `평균 · 마감 5개월`). 마감 0개월이면 평균 열은 끝난 월 전체로 계산한 값을 회색으로 보이고 헤더가 `평균 · 잠정`이 된다.
- 셀 제외, 호버 거래 조회, 미니 추이는 **마감 여부와 무관하게** 끝난 월과 진행 중인 달 모두에서 동작한다. 미마감 셀의 거래 조회는 `scope=live`, 마감 셀은 지금처럼 `scope=closed&revision=…`.
- 연 KPI(순저축률·수입·지출·순저축), 어디에 썼나, 가맹점 TOP, 전년 비교, 6개월 예측: 각 블록은 **확정 값이 있으면 확정 값에 `확정` 태그**, 없으면 **잠정 값에 `잠정` 태그와 이유**(`2025년 미마감`, `마감 0개월`). 태그는 회색 테두리 작은 글자이고 잠정 값 본문은 `prov` 색이다.
- `마감한 월이 없습니다` 빈 화면은 없앤다. 그 연도에 **거래 자체가 없을 때만** `이 연도에는 거래가 없습니다`를 보여준다.

**확정과 잠정의 정의**

- 확정 집계의 입력 = 그 연도의 `closed` 월. 전년 비교의 확정 = 올해 마감 월과 같은 번호의 전년 월이 **모두** `closed`일 때 (현재 `previousComparable` 규칙 유지).
- 잠정 집계의 입력 = 그 연도의 **끝난 월 전부**(마감 여부 무관, 진행 중인 달 제외). 전년 비교의 잠정 = 같은 번호의 전년 끝난 월 전부.
- 6개월 예측: 확정은 마감 월 평균, 잠정은 끝난 월 평균. 시작 잔액 기준 월 표시는 그대로.
- 진행 중인 달은 어느 집계에도 넣지 않는다. 그래프와 표에만 `진행 중`으로 보인다.
- 마감된 0원 월은 확정 집계에서 0으로 센다(기존 규칙 유지). 미마감 월의 거래 없음은 잠정 집계에서도 0이 아니라 "값 없음"으로 두고 표에는 `–`로 보인다.

### 3.4 상태 칩 · 하나의 어휘

`MonthStatusLabel`을 확장해 월 단위 화면(홈·내역·예산·월말 리뷰·통계)의 **h1 바로 옆**에 같은 형태로 둔다. 색은 네 가지 뜻만 쓴다.

| 변형 | 예 | 색 | 쓰는 곳 |
| --- | --- | --- | --- |
| 진행 중 | `2026년 9월 · 진행 중 · 9일 경과 / 30일` | amber | 홈, 내역·예산(이번 달) |
| 미마감 | `2026년 8월 · 미마감 · 잠정` | amber | 내역·예산·월말 리뷰(끝난 달) |
| 재확인 필요 | `2026년 4월 · 재확인 필요 · 마감 뒤 내역 변경` | red | 내역·예산 |
| 마감 | `2026년 5월 · 마감 · 6/2 확정` | green | 내역·예산 |
| 연 요약 | `2026년 · 마감 5개월 · 잠정 3개월` | green | 통계 |
| 예정 | `2026년 11월 · 예정` | faint | 통계 스트립 |

설계 그림에 있던 `수정 N건`은 쓰지 않는다. `ledger_months`는 변경 횟수(`revision`)만 알고 바뀐 거래 수는 모르기 때문이다. 마감 칩의 날짜는 `closed_at`.

칩에는 `title` 속성으로 한 줄 설명을 단다. 잠정: `마감 전이라 통계의 평균·비교에는 들어가지 않습니다.` 마감: `이 달의 숫자는 통계에서 확정 값으로 계산됩니다.`

삭제할 문장 (파일 · 현재 문구):

- `src/app/dashboard/page.tsx`: 눈썹 `이번 달 · 잠정`, `홈의 금액·비교·추이는 미마감 내역을 포함한 실시간 집계입니다. 확정된 월은 통계에서 확인하세요.`, `{year}년 {month}월 · N일 경과 / M일 · 모든 수치는 월 단위 · 지난 달은 내역, 다른 해는 통계에서`
- `src/app/budgets/page.tsx`: `실제 사용액은 마감 전 내역도 포함합니다. 예산의 평균·제안에는 잠정 내역이 포함될 수 있습니다.`
- `src/app/budgets/review/page.tsx`: `예산 제안은 미마감 내역도 포함한 실시간 기준입니다. 다음 달 예산 작성과 이번 달 마감은 별개입니다.`
- `src/app/report/page.tsx`: `{year}년 · 마감 N개월 · 미마감 M개월 · … 기준 · 월평균은 마감 월 기준` (칩으로 대체), 빈 상태 섹션 전체
- `src/app/ledger/page.tsx`: AI 진단 탭의 `잠정 내역 기준 진단 · …은 아직 확정 통계에 포함되지 않습니다.`는 칩이 이미 잠정임을 말하므로 삭제. 진단 패널 안의 `잠정 내역 기준 진단` 표기는 `2026-09-09-monthly-close-design.md` §4가 정한 것이라 유지.

내역 h1에는 칩을 새로 넣는다(현재는 컨트롤 줄에만 있음). 쌓기 결정에 따라 컨트롤 줄의 상태 표시도 남는다.

## 4. 읽기 모델 변경

`src/features/analytics/stats-report.ts`의 `getStatsReportData`:

- `eligibleMonths`(마감·끝난 월)는 `closedMonths`로 이름을 바꾼다. `endedMonths`(끝난 월 전부)와 월별 `state`를 함께 반환한다.
- `monthly`: 12개월 전부 `monthlySummaries`로 계산하고 각 행에 `state: 'closed' | 'open' | 'needs_review' | 'current' | 'future'`를 붙인다. `active`는 `state !== 'future'`.
- `report`: `buildAnnualReport`를 두 번 호출한다. `official = buildAnnualReport({ eligibleMonths: closedMonths, previousComparable })`, `provisional = buildAnnualReport({ eligibleMonths: endedMonths, previousComparable: previousEndedComparable })`. 반환은 `{ official, provisional, closedMonths, endedMonths }`. 화면은 블록마다 `official`의 입력 월이 0개면 `provisional`을 회색으로 쓴다.
- `details[flow]`: `closedMonths`(평균 분모), `endedMonths`(표시 열), `monthRevisions`(마감 월만), `states`. `divisor = closedMonths.length`. 0이면 화면이 `provisionalAverage`(끝난 월 평균)를 회색으로 쓸 수 있게 `provisionalDivisor = endedMonths.length`도 준다.
- `accountMonthly` 시리즈는 미마감 월을 `null`로 지우지 않는다. 미래 월만 `null`.
- `stats-monthly.ts`의 `monthEligible`은 "표시 대상"(끝난 월 + 진행 중)과 "확정 대상"(마감 월)을 구분하는 두 함수로 나눈다. `StatsMonthlyModel`에 `monthStates`를 추가하고 `eligibleMonths` 는 표시 대상을 뜻하게 한다. 차트 시리즈는 표시 대상 값을 모두 담고 미래만 `null`.
- `series-chart.tsx`, `annual-flow-overview.tsx`: 시리즈에 월별 `provisional` 플래그를 넘겨 막대는 빗금(`Chart.js` `backgroundColor`에 `CanvasPattern`), 선은 `segment.borderDash`로 그린다. 패턴과 대시 규칙은 `chart-js.ts`에 `provisionalPattern(palette)`, `PROVISIONAL_DASH`로 한 곳에 둔다.
- `/api/cell-tx`: 변경 없음. 통계 화면이 미마감 월에는 `scope=live`로 부른다. `StaleClosedMonthError` 처리는 그대로.

홈·내역·예산·자산의 로더는 바꾸지 않는다. 마감 서비스(`closeMonth`, `reopenMonth`), 트리거, `ledger_months`, RLS도 바꾸지 않는다. 마이그레이션은 없다.

## 5. 구현 경계

- `src/features/month-close/wrap-up.ts` (신규, 순수): `wrapUpSteps`. `month-wrap-up.tsx` (신규, 서버 컴포넌트): 체크리스트 블록. `month-status-label.tsx`: 변형 확장과 `title`.
- `src/app/ledger/page.tsx`: h1 칩, 체크리스트 삽입, AI 탭 문장 삭제, 컨트롤 문구 수정.
- `src/features/analytics/home-todos.ts`: `close` 종류와 상태 조회. `src/app/dashboard/page.tsx`: KPI 두 칸, 섹션 제거, 헤더 칩.
- `src/features/analytics/stats-report.ts`, `report.ts`, `stats-monthly.ts`, `stats-monthly-section.tsx`, `series-chart.tsx`, `annual-flow-overview.tsx`, `chart-js.ts`, `src/app/report/page.tsx`: §3.3·§4.
- `src/app/budgets/page.tsx`, `src/app/budgets/review/page.tsx`: 문장 삭제, 칩 위치를 h1 옆으로.
- 삭제 후보: `src/features/analytics/net-worth.ts`, `home-trend-charts.tsx`의 `CashflowWaterfall`(`SavingsRateChart`는 남음).
- `revalidateFinance`: `monthClose` 도메인의 읽기 화면 목록은 이미 홈·내역·통계·예산·월말 리뷰를 포함하므로 변경 없음.

## 6. 기존 스펙 개정

`2026-09-09-monthly-close-design.md`에서 이 문서가 대체하는 부분:

- §1 "`/report`는 마감한 월만 집계한다" → 마감 월은 확정 집계, 나머지 끝난 월은 잠정 표시.
- §4 표의 `통계 /report` 행 → §3.3.
- "통계의 빈 월과 부분 연도": "미마감/재확인 월은 `—`로 표시하고 차트 데이터는 `null`" → 잠정 표시. "마감 월이 하나도 없으면 `마감한 월이 없습니다`" → 삭제. "미마감 셀은 제외·호버 거래 조회 대상이 아니다" → 대상이다(`scope=live`).
- "비교와 예측": 확정 규칙은 유지하고, 확정이 불가능한 칸에 잠정 값을 회색으로 보이는 규칙을 추가.
- §6 `/api/cell-tx` "통계 호출은 마감 전용 scope" → 마감 월만 `closed`, 미마감 월은 `live`.
- §7 "처음에는 통계가 비어 있을 수 있고" → 처음부터 잠정 값으로 채워진다. 일괄 마감 UI는 여전히 범위 밖.

원본 문서 상단에 이 문서로의 포인터를 한 줄 추가한다. 나머지 절(상태·동작·데이터·동시성)은 그대로 유효하다.

## 7. 비범위

- 월 내비게이터 공용 컴포넌트, `text-[Npx]` lint 규칙, 모바일 카드 행, 내역 탭 순서·AI 진단 탭의 Mac 연결 상태 표시, 통계 셀 제외 저장, 재무 건강 카드 위치. 각각 별도 바운디드 작업.
- 일괄 마감, 자동 마감, 급여일 기준 월 경계.
- 저축 목표 금액화 카드. 홈 KPI 세 번째 칸은 비워 둔다.

## 8. 검증 기준

- 단위: `wrapUpSteps`(세 건수 조합, 접힘, 진행 중·마감·재확인에서 비표시), `buildHomeTodos`의 `close` 우선순위·제목·복수 월, `MonthStatusLabel` 변형, `stats-monthly` 표시/확정 마스크 분리, 마감 0개월의 잠정 평균, `provisional` 시리즈 플래그, `buildAnnualReport` 확정·잠정 두 결과가 같은 입력에서 일관.
- 통합(`tests/integration`): `getStatsReportData`가 `1월 마감 / 2월 미마감 / 3월 마감`에서 확정 평균은 1·3월, 잠정 평균은 1·2·3월, 2월 셀은 회색 값이며 0이 아님. 전년 전부 미마감이면 전년 비교가 잠정으로 나옴. `home-dashboard.test.ts`의 `getNetWorthSeries` 검증 제거, `fixedExpense/variableExpense` 검증 유지. `getHomeTodos`가 지난 달 `open`이면 `close`를 맨 위에 둠.
- E2E(`tests/e2e/month-close.spec.ts`): `마감한 월이 없습니다` 헤딩 확인을 **잠정 태그·빗금 범례 확인**으로 교체. 미마감 8월에서 내역 체크리스트 → 미분류 링크 → 마감 → 체크리스트 사라짐 → 통계에서 8월이 실선·확정으로 바뀜. 홈 할 일 맨 위의 `8월 마무리하기` 가 마감 후 사라짐. 미마감 셀 호버가 `scope=live`로 동작. 홈에 `자산이 늘고 있나`·`순자산 추이`·`이번 달 돈의 흐름`이 없음.
- 최종: `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm e2e`.

## 9. 승인 기록

2026-09-09 사용자가 갈림길 여섯 개를 순서대로 결정했고("ㄴ", "2′ 오케이", "3", "쌓기", 홈 제거 세 건), 설계 그림 A~D를 "다 확정"으로 승인했다. 구현 계획은 `docs/superpowers/plans/2026-09-09-month-close-ux.md`에 작성한다. 운영 반영·main 병합·배포는 별도 요청 후 진행한다.

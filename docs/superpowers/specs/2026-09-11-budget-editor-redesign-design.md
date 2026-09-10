# 예산 편집기 개편 · 참고 목록 선택 설계

상태: 2026-09-11 브레인스토밍에서 결정 완료(C2안). 구현은 외부 개발자(ChatGPT/Codex)에게 위임한다. 이 문서와 `docs/design/budget-editor/`의 목업이 유일한 기준이다.

관련 문서
- 승인된 AI 예산 원칙: `docs/superpowers/specs/2026-09-10-ai-budget-planning-design.md` (§4.4의 체크박스 인터랙션은 이 문서가 대체한다. 아래 §11)
- 월 마감 UX: `docs/superpowers/specs/2026-09-09-month-close-ux-design.md` (헤더 칩, 예산 로더 불변)
- 디자인 토큰: `src/app/globals.css` (Swiss Ledger: ink #18181b, muted #71717a, faint #a1a1aa, hairline #e4e4e7, track #f4f4f5, panel #fafafa, blue #2563eb, red #dc2626, green #16a34a, amber #d97706, violet #7c3aed, violet-tint #f5f3ff, 모서리 0, IBM Plex Sans KR, 컨트롤 34px)

## 1. 왜 바꾸나

지금 `/budgets` 편집기에는 예산을 채우는 출처가 여섯 가지 섞여 있다. 지난달 예산 채우기, 월평균(연초부터) 채우기, 리뷰 규칙(6개월 중앙값) 채우기, 변동비 감축률, 절약 시뮬레이션, AI 추천. 채우기는 미리보기 패널을 거치고, AI는 요청 패널 → 추천안 검토 구역 → 행별 체크박스 → 선택한 추천 가져오기의 네 단계다. 값을 비교하려면 지난달 돌아보기 표를 따로 펼쳐야 한다. 절차가 길고 한눈에 들어오지 않는다.

새 편집기는 **항목마다 참고 값 네 줄을 보여주고, 줄을 누르면 그 금액이 예산에 들어간다.** 저장은 표 위 한 줄의 저장 버튼 하나다.

## 2. 결정 기록

| 질문 | 결정 |
|---|---|
| 출처 범위 | **지난달 예산 · 지난달 실적 · 3개월 평균 · AI 추천** 넷과 직접 입력. 나머지 도구(월평균 채우기, 리뷰 규칙, 감축률, 시뮬레이션, 돌아보기 표)는 삭제 |
| 이름 | 이력 묶음은 **실적**. 줄 이름 `지난달 예산` `지난달 실적` `3개월 평균` `AI 추천` |
| 표 구조 | **`항목 | 예산 | 참고`** 세 열. 참고 안에 네 줄이 세로로, AI 줄 아래 근거 한 줄. (사용자 제안) |
| 고르는 방식 | **줄 자체를 누른다(C2).** 줄마다 `반영` 버튼(B)과 라디오(B′)는 과해서 기각. 한 줄 타일(C1)은 세로 목록보다 덜 읽혀 기각. A안 출처 열 표는 항목 옆에 라벨이 없어 기각 |
| 출처 지우기 | **없다.** 다른 출처 줄을 고르면 AI 출처가 지워진다. 직접 고치면 `AI 추천 …에서 조정` 캡션만 남는다 |
| AI 요청 UI | 표 위 도구 줄의 버튼 하나. 참고 메모·예정 지출은 **작은 대화상자**에서 입력. 요청 패널은 삭제 |
| 상한 구역 | 슬라이더와 네 칸을 **한 줄로 압축해 표 위에 고정.** 저축률은 숫자를 눌러 팝오버에서 조정 |
| 모바일 | **같은 목록 구조.** 항목·예산 줄 아래 참고 네 줄이 좁게 내려온다. 별도 카드·칩 없음 |
| 선택 표시 | 세션 중에는 **누른 줄**이 선택. 화면을 처음 열면 AI 출처가 있으면 AI 줄, 아니면 저장액과 같은 **첫** 줄, 없으면 아무 줄도 아님(직접 입력) |
| 3개월 평균 | **끝난 최근 3개월**의 월평균. 마감 여부 무관, 미마감 달이 섞이면 캡션에 `잠정` |
| 지난달이 진행 중일 때 | 값은 그대로 보이고 지난달 실적 줄 캡션에 `9월 27일까지 · 진행 중` |
| 미래 월의 KPI 세 칸 | 숨긴다. 상한 줄이 같은 숫자를 들고 있다 |

## 3. 화면 구조

`/budgets?month=YYYY-MM` 한 페이지. 위에서 아래로.

1. **헤더** 제목 `2026년 10월 예산` + `MonthStatusLabel` heading 변형 칩(현재 코드 그대로). 오른쪽에 월 이동기. `다음 달 예산 만들기 →` CTA는 유지하되 이미 다음 달을 보고 있을 때는 숨긴다.
2. **KPI 세 칸** (목표 지출 상한 · 이번 달 사용 · 더 쓸 수 있는 돈) 대상 월이 이번 달이거나 지난 달일 때만. 미래 월에는 숨긴다.
3. **페이스 경고** 이번 달일 때만. 현재 코드 그대로.
4. **상한 줄** 표 위에 고정(sticky). §6.
5. **도구 줄** 왼쪽 `전체 채우기` + 버튼 넷(지난달 예산 · 지난달 실적 · 3개월 평균 · AI 추천, 30px 외곽선). 오른쪽 AI 상태 한 줄과 동작 링크. §5.
6. **편집 목록** 고정비 / 변동비 / 비정기 세 묶음. §4.
7. **표 아래** 안내 한 줄 `저장 전에는 바뀌지 않습니다.`와 `최근 변경 실행 취소`, 상한 초과 확인 체크박스(초과일 때만), 저장 결과 메시지, 충돌 비교 구역. 전부 현재 동작 유지.

## 4. 편집 목록

### 4.1 열

`항목 | 예산 (원) | 참고`. 그리드 `200px 200px minmax(0, 1fr)`, 간격 16px. 헤더는 `t-label` 회색, 아래 잉크 1px 선. 참고 헤더 아래 faint 캡션 `줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다`.

### 4.2 항목 행

- **항목** 대분류 이름(600). 대상 월이 이번 달이면 아래에 `사용 301,500 · 남은 78,500` 캡션.
- **예산** 숫자 입력(34px, 190px, 우측 정렬, 원 단위 정수) + `원`. 유효하지 않으면 지금과 같은 빨간 안내. 입력 아래 캡션은 셋 중 하나: 없음(선택된 줄이 있을 때) / `직접 입력`(회색) / `AI 추천 650,000에서 조정`(보라 600, 행에 AI 출처가 있고 금액이 다를 때). 저장된 AI 출처가 현재 완료 작업과 다른 이전 작업이면 날짜를 붙인다 `AI 추천 (9월 3일) 650,000에서 조정`.
- **참고** 네 줄. 각 줄은 `라벨 110px | 금액 110px | 캡션 | 체크 20px` 그리드, 높이 32px, 좌우 10px 패딩(줄 배경이 열 밖으로 10px 나간다). 줄 전체가 하나의 버튼(`<button type="button">` 또는 `role="option"`)이다.

| 줄 | 금액 | 캡션 |
|---|---|---|
| 지난달 예산 | 대상 월 −1의 유효 예산 | `9월` |
| 지난달 실적 | 대상 월 −1의 실제 지출 | 지난달 예산 대비 차이. 초과 `+11,700 초과` 빨강, 이하 `−63,700` 회색, 같으면 `예산과 같음`. 진행 중이면 앞에 `9월 27일까지 · 진행 중 ·` |
| 3개월 평균 | 끝난 최근 3개월 월평균 | `6·7·8월`, 잠정이면 ` · 잠정`. 비정기는 지출 달 수 `6·7·8월 · 7월 1회` |
| AI 추천 | 현재 완료 작업의 추천 금액 | 없음. 낡았으면 `다시 추천 필요` |

- 값이 없는 줄(0원, 자료 없음, 추천 없음)은 faint 취소선으로 그리고 누를 수 없다. 캡션에 이유 `지출 없음` / `추천 없음`.
- **AI 근거 줄** AI 추천 줄 아래, `AI 근거` 라벨(600) + `report.rows[].reason` 한 줄(넘치면 말줄임) + `더 보기` 링크(§5.4 팝오버). 추천이 없으면 줄 자체가 없다.
- 상태 색: 선택된 줄은 track 배경, 라벨 잉크 600, 금액 700, 오른쪽 끝 체크(SVG). AI 줄이 선택되면 violet-tint 배경, 라벨 보라, 보라 체크. hover는 panel 배경.

### 4.3 선택 표시 규칙

- 세션 중: 마지막에 누른 줄이 선택이다. 클라이언트 초안 행에 `source: 'previousBudget' | 'previousActual' | 'average3' | 'ai' | null`을 둔다(저장하지 않는다).
- 직접 타이핑: `source = null`. 모두 풀리고 캡션 `직접 입력`. 행에 `recommendationJobId`가 있으면 캡션은 `AI 추천 …에서 조정`.
- 화면을 열 때 초기 `source`: `recommendationJobId`가 현재 완료 작업과 같고 금액이 같으면 `ai`; 아니면 저장액과 같은 첫 줄(지난달 예산 → 지난달 실적 → 3개월 평균 순); 없으면 `null`. 주거처럼 지난달 예산과 실적이 같으면 위쪽 하나만 켜지고 실적 줄 캡션 `예산과 같음`이 남는다.
- AI 줄은 금액 일치로 켜지지 않는다. `recommendationJobId`가 현재 완료 작업의 ID와 같을 때만.

### 4.4 클릭 동작

- 참고 줄 클릭: 그 금액을 입력에 넣고 `source`를 그 줄로. 지난달 예산·실적·3개월 평균 줄은 `recommendationJobId = null`. AI 줄은 §5.5의 확인을 거친 뒤 `recommendationJobId = completed.id`.
- 직접 타이핑: 금액만 바뀐다. AI 출처는 유지되어 `…에서 조정`(승인 원칙 §8).
- **전체 채우기**(도구 줄 버튼): 값이 있는 모든 행에 그 출처의 금액을 넣는다. 세션 중 사용자가 손댄 행(초안이 저장값과 다른 행)이 하나라도 덮어써지면 먼저 확인 팝오버. 제목 `이미 고친 n개 항목이 바뀝니다`, 행마다 `식비 600,000 → 612,400`, 버튼 `모두 채우기` `고친 항목은 두기` `취소`. 손댄 행이 없으면 바로 채운다. AI는 §5.5의 확인을 먼저 거친다.
- 채운 뒤 표 아래에 `지난달 실적으로 8개 항목을 채웠습니다 · 실행 취소` 한 줄. 실행 취소는 현재 `undoRows` 방식(직전 변경 1회).
- 저장 버튼은 초안이 저장값과 다를 때만 활성(`변경사항 저장`), 같으면 `저장됨` 비활성. 저장 계약(`BudgetSaveRequest`)과 서버 저장 서비스는 바꾸지 않는다.

## 5. AI

### 5.1 요청

- 도구 줄 오른쪽 버튼 `AI 추천 받기`(추천이 없을 때). 완료 후에는 링크 `다시 추천`. 클릭하면 대화상자(`<dialog>`).
- 대화상자: 제목 `AI 예산 추천 요청 · 2026년 10월`, 기준 한 줄 `월평균 수입 6,115,000 · 목표 저축률 30% · 상한 4,280,500 · 지금 편집안을 참고합니다`, `참고 메모`(선택, 4,000자), `예정 지출`(선택, 최대 30개: 카테고리 · 금액 · 메모 · 삭제, 아래에 추가 행), 바닥에 `지난 요청의 프롬프트 보기` 링크(이전 작업이 있을 때), `취소` `추천 요청`. 마지막 줄 안내 `Mac에서 1~2분 걸립니다. 완료되면 참고의 AI 줄이 채워지고, 기다리는 동안 편집은 계속할 수 있습니다.`
- 입력 검증과 요청 흐름은 현재 `panel.tsx`의 것을 그대로 옮긴다: `prepareRequest`, `startBudgetRecommendation`, 애매한 실패 시 같은 requestId 재확인, `pollBudgetRecommendations`, `getBudgetRecommendations`. 이 로직은 `useBudgetRecommendation(month, ...)` 훅으로 빼고 UI만 대화상자와 도구 줄로 나눈다.

### 5.2 사용 가능 조건

현재 규칙 그대로. 이번 달·다음 달만, 기준 수입 > 0, 저축 목표가 저장된 상태(`targetDirty`가 아닐 때), 작업기 준비. 조건 미충족이면 버튼은 비활성이고 도구 줄에 이유 한 줄(§5.3).

### 5.3 도구 줄의 AI 상태

| 상태 | 상태 문구 | 동작 |
|---|---|---|
| 추천 없음 | `AI 추천 · 아직 없음 · 이번 달·다음 달에서만` | 버튼 `AI 추천 받기` |
| 조건 미충족 | `저축 목표를 먼저 저장해 주세요` / `기준 수입이 있어야 시작할 수 있어요` / `Mac AI 작업기가 연결되지 않았습니다` / `Mac의 AI 작업기 업데이트가 필요합니다` | 버튼 비활성 |
| 대기·분석 중 | `추천 대기 중` / `Mac에서 분석 중 · 보통 1~2분` / `Mac 연결 대기 · 연결되면 자동 시작` | 버튼 `분석 중…` 비활성 |
| 완료 | `AI 추천 · 9월 27일 14:02 · 합계 1,855,000 · 상한 안` (초과면 `상한 초과 +120,000` 빨강) | 링크 `요약` `다시 추천` |
| 낡음 (source_changed / budgets_changed) | 주황 `기록이 바뀌어 다시 추천이 필요합니다` / `예산이 바뀌어 다시 추천이 필요합니다` | 링크 `다시 추천`. 모든 행의 AI 줄은 faint 취소선, 누를 수 없음. 도구 줄의 `AI 추천` 채우기 버튼 비활성 |
| 실패 | 빨강, 현재 `JOB_ERROR_MESSAGES` 문구 | 링크 `다시 시도` |
| 새 지침 | 완료 문구 뒤에 보라 점 `이전 지침으로 만든 추천` | 완료와 같음 |

패널의 배너들은 전부 이 표로 흡수된다. 네트워크 오류는 빨강 문구와 `상태 다시 확인` 링크.

### 5.4 근거와 요약 팝오버

- **근거**(AI 근거 줄의 `더 보기`): 제목 `식비 · AI 추천 650,000원`, 완료 시각, `reason` 전체, `일회성 후보`(exceptional), `조정 후보`(reducible), 참조(references). 각 finding은 `기록 확인` / `사용자 제공` / `추정 · 확인 필요` 라벨을 앞에 둔다. 거래 참조는 내역 링크. 현재 `budget-row.tsx`의 `ReasonDetails`·`Reference` 로직을 팝오버 안으로 옮긴다. 바닥에 `닫기` `650,000원 넣기`(§5.5와 같은 확인).
- **요약**(도구 줄 링크): `report.summary`, 네 숫자(미분류 실제 지출, 미배정 정기 지출, 근거 제공 n/m, 처리 대기·미분류), `limitations`, `overCeilingReason`, `adjustments`(상한 조정 후보), `사용한 프롬프트` 링크(현재 `AiPromptViewer`를 팝오버 또는 대화상자로).
- 저장된 행의 AI 출처가 이전 작업이면 근거는 그 작업(`savedRecommendations`)의 것을 보인다. 그 작업을 찾을 수 없으면 캡션 `이 추천의 근거를 확인할 수 없습니다`(주황). 다른 출처 줄을 고르면 정리된다.

### 5.5 AI 값 넣기의 안전장치

- AI 줄 클릭, `전체 채우기 › AI 추천`, 근거 팝오버의 `넣기`는 먼저 `checkRecommendationForApply(month, jobId)`를 호출해 통과한 결과의 금액만 넣는다. 실패 코드별 문구는 현재 `budget-form.tsx`의 것을 쓴다.
- 넣은 행은 `recommendationJobId = completed.id`, `source = 'ai'`.
- 처음에 아무 행도 자동 선택·반영하지 않는다. 새 결과가 와도 기존 초안을 덮지 않는다.
- 자기 추천을 저장한 뒤의 `freshness: 'applied'` 표시와 이후 충돌 검사는 현재 서버 동작 그대로.

## 6. 상한 줄

- 위아래 잉크 1px 선, 높이 52px, 표 위에 `position: sticky; top: <앱 헤더 높이>`.
- 항목: `목표 저축률 30% ▾`(점선 밑줄, 클릭 시 팝오버) · `목표 지출 상한 4,280,500` · `편집안 합계 1,850,000` · `여유 2,430,500`(초록, 초과면 `초과 120,000` 빨강). 오른쪽 끝에 `아직 저장하지 않은 편집안`(주황, 초안이 다를 때) + 저장 버튼.
- 팝오버: 슬라이더(0~80, 정수), 큰 숫자 `30%`, 산식 `월평균 수입 6,115,000 × (1 − 30%) = 상한 4,280,500`, 기준 기간 `8개월 수입 기준 (2026-01 ~ 2026-08)`, `편집안대로면 예상 순저축률 69.9%`, 안내 `저축률 변경도 저장 버튼으로 함께 저장됩니다.`
- 계산은 현재 `spendingCeilingForTarget`, `savingsRate` 그대로. 저축률 변경은 `payload.targetChange`로 저장.
- 편집안 합계에 유효하지 않은 입력이 있으면 합계 자리에 `입력 확인 필요`(주황).

## 7. 모바일 (≤ 640px)

- 같은 컴포넌트가 좁게 내려온다. 헤더·칩·월 이동기는 세로로. KPI는 데스크톱 규칙과 같다.
- 상한 줄은 두 줄로 접는다: `상한 428만 · 합계 185만 · 여유 243만` / `목표 저축률 30% ▾`, 오른쪽에 `저장`(30px). 억·만 단위 축약은 `formatWonCompact`가 있으면 쓰고 없으면 만 단위 절사.
- 도구 줄은 왼쪽 AI 상태(짧게 `AI 추천 · 9월 27일 14:02 · 상한 안`)와 `요약`, 오른쪽 `전체 채우기 ▾` 메뉴(네 출처). 확인 규칙은 데스크톱과 같다.
- 항목 블록: 1줄 이름 + 입력(150px), 그 아래 캡션, 그 아래 참고 네 줄(`84px 84px 1fr 16px`, 높이 36px, 탭 목표 확보), 그 아래 AI 근거(줄바꿈 허용).
- 팝오버(근거·요약·저축률)는 모바일에서 바닥 시트여도 된다.

## 8. 데이터와 읽기 모델

### 8.1 서버 (`getBudgetPlanningData`)

행 하나의 읽기 모델을 새로 정의한다. 이름은 `BudgetPlanRow`, 위치는 `src/features/budgets/plan-sources.ts`(새 파일, 순수 계산은 `plan-calculations.ts`).

```ts
type BudgetPlanRow = {
  major: string
  group: 'fixed' | 'variable' | 'irregular'
  saved: { amount: number; recommendationJobId: string | null; version: string } // readBudgetBaselines
  actual: number                       // 대상 월 실제 지출 (이번 달 캡션용)
  previousBudget: number               // 대상 월 −1의 유효 예산 ('*' + 월 행)
  previousActual: {
    amount: number
    month: string                      // 'YYYY-MM'
    partial: { asOf: string } | null   // 그 달이 진행 중이면 KST 오늘 날짜
  }
  average3: {
    amount: number
    months: string[]                   // 끝난 최근 3개월 (대상 월보다 앞서고 currentMonth보다 앞선 달), 최근순
    monthsWithSpend: number            // 이 대분류 지출이 있었던 달 수 (비정기 캡션)
    provisional: boolean               // months 중 ledger_months.state !== 'closed'가 하나라도 있으면 true
  }
}
```

- `average3.amount` = 대상 대분류의 월 지출 합계를 `months`에 대해 평균. 분모는 **가구 거래가 하나라도 있는 달의 수**(자료가 없는 달을 0원 지출로 해석하지 않는다, AI 스펙 §5.1). 대분류에 지출이 없는 달은 0으로 센다. 끝난 달이 3개 미만이면 있는 달로 계산하고 `months`가 그 사실을 드러낸다. 반올림은 `roundLikePython`.
- `previousActual.partial`: `previousActual.month === currentMonthInKorea()`이면 `{ asOf: todayInKorea() }`.
- 마감 상태는 `src/features/month-close/queries.ts`의 기존 조회를 재사용한다. 마이그레이션은 없다.
- `readBudgetData`의 `rows[].average`(연초부터 평균), `previousBudget`, `actual`, `group`, `paceWarnings`, `spendCeiling`, `averageIncome`, `savingsTarget`은 그대로 두고 필요한 것만 `BudgetPlanRow`로 합친다. `readBudgetReviewData`(`review-queries.ts`)와 `review-calculations.ts`는 **바꾸지 않는다.** AI 스냅샷(`budget-recommendations/snapshot.ts`)이 `readBudgetReviewData`로 `previousActual`·`median`을 만들기 때문이다. `plan-sources.ts`는 그 결과의 `previousActual`을 재사용하거나 같은 조건으로 직접 조회한다. 화면은 `suggestion`·`median`·`groups`·리뷰 합계를 더 이상 쓰지 않는다.
- 모든 쿼리는 `householdId` 범위. 트랜잭션 격리는 현재 `getBudgetPlanningData`의 `repeatable read` 유지.

### 8.2 클라이언트 초안 (`draft.ts`)

- `BudgetDraftRow = { major, amount: string, recommendationJobId: string | null, source: 'previousBudget' | 'previousActual' | 'average3' | 'ai' | null }`. `source`는 표시용이며 저장 요청에 넣지 않는다. `selected`는 삭제.
- 액션: `edit`(source → null), `choose`(한 행에 금액·source·recommendationJobId), `fill`(여러 행, undo 스냅샷 저장), `undo`, `rebase`, `saved`. `apply`·`select`·`manual`은 삭제.
- 초기 `source`는 §4.3 규칙으로 `createBudgetDraft(baseline, plan, completedJobId)`가 계산한다.
- `draftBudgetChanges`, `draftBudgetAmounts`는 그대로(source 무시). 저장 계약 `save-contract.ts`와 `save-service.ts`는 바꾸지 않는다.

### 8.3 컴포넌트 경계

| 파일 | 역할 |
|---|---|
| `budget-form.tsx` | 폼·저장·충돌·상한 줄 상태. 300줄 안쪽으로: 아래 파일로 나눈다 |
| `ceiling-bar.tsx` (새) | 상한 줄 + 저축률 팝오버 |
| `plan-toolbar.tsx` (새) | 전체 채우기 버튼 넷 + AI 상태·동작. 모바일에서는 메뉴 |
| `plan-list.tsx` (새) | 헤더·묶음·항목 행, 전체 채우기의 확인 팝오버, 실행 취소 줄 |
| `plan-item.tsx` (`budget-row.tsx` 대체) | 항목 한 행: 입력, 캡션, 참고 네 줄, AI 근거 줄. 순수 계산 `initialSource(row, completedJobId)`와 `differenceCaption`은 `plan-calculations.ts`에 |
| `ai-request-dialog.tsx` (새) | 요청 대화상자 |
| `ai-evidence.tsx` (`budget-row.tsx`의 ReasonDetails·Reference 이동) | 근거 팝오버, 요약 팝오버 |
| `budget-recommendations/use-recommendation.ts` (새) | `panel.tsx`의 요청·복구·폴링 로직을 훅으로 |

## 9. 삭제

- 삭제: `src/features/budgets/simulator.tsx`, `simulator-calculations.ts`, `budget-reference.tsx`, `budget-row.tsx`(plan-item으로 대체). 유지: `review-redirect.ts`(구 `/budgets/review` 리다이렉트), `review-queries.ts`·`review-calculations.ts`(AI 스냅샷이 사용, §8.1).
- `src/features/budget-recommendations/panel.tsx` 삭제(훅 + 대화상자 + 도구 줄로 대체).
- `budget-form.tsx`에서 채우기 버튼 셋, 감축률 입력, 미리보기 구역, 추천안 검토 구역, 지출 상한 배분 구역, 시뮬레이션 details 삭제.
- `src/app/budgets/page.tsx`에서 `BudgetReference` 제거, 미래 월 KPI 숨김, 다음 달을 보고 있을 때 CTA 숨김.
- 삭제로 깨지는 테스트(`tests/finance/budget-review.test.ts`, `budget-recommendation-panel*.test.tsx`, `budget-draft.test.ts`의 select/apply)는 새 동작의 테스트로 교체한다.

## 10. 상태와 오류

- 저장 흐름(`saveBudgetPlan`, `BudgetActionState`, 충돌 비교 `budget_conflict`, `overage_confirmation_required`, 오류 문구)은 현재 그대로.
- 상한 초과 확인 체크박스는 여유가 음수이거나 서버가 요구할 때만 표 아래에.
- AI 상태는 §5.3. 실행 취소는 직전 1회.
- 대화상자를 연 채 월을 바꾸면 대화상자를 닫고 입력을 버린다(현재 패널의 월 변경 리셋과 동일).

## 11. 유지해야 하는 원칙

AI 예산 스펙에서 그대로 가져온다. 이 문서가 바꾸는 것은 §4.4의 "체크박스 선택 후 가져오기" 인터랙션(줄 클릭과 전체 채우기로 대체)과 "수동 초안으로 전환" 링크(다른 출처 선택으로 대체)다. 아래는 바뀌지 않는다.

- 어떤 채우기도 확인·저장 전에는 DB를 바꾸지 않는다. 손댄 행을 덮어쓸 때는 미리 보여준다.
- AI 값은 행에 `recommendationJobId`로 출처를 남긴다. 저장액과 추천액이 다르면 `…에서 조정`으로 표시하고, AI가 조정액을 추천했다고 표시하지 않는다.
- 지난달/실적/평균 줄로 명시적으로 바꾼 행에는 AI 출처를 붙이지 않는다. 직접 타이핑은 AI 출처를 유지한다.
- 새 추천이 와도 자동으로 행을 바꾸지 않는다. 낡은 추천은 넣을 수 없다. 클라이언트가 보낸 이유 문장을 서버가 신뢰하지 않는다(서버 저장 검증 그대로).
- 처음에는 아무 항목도 자동 반영하지 않는다(초기 `source` 표시는 저장된 값을 설명할 뿐 값을 바꾸지 않는다).
- 브라우저에 워커 토큰·서비스 키를 주지 않는다. 결과는 HTML 실행 없이 렌더링한다. 로그에 거래 본문·프롬프트를 남기지 않는다.
- 예산 저장은 월 마감과 무관하다. 헤더 칩은 그대로. 예산 로더의 기준 수입·상한·반올림은 `/budgets` 기존 계산이 정본.

## 12. 검증

- 단위(`tests/finance`): `average3` 계산(3개월 미만, 거래 없는 달 제외, 잠정 판정, 비정기 monthsWithSpend), `initialSource`(AI 우선, 첫 일치 줄, 없음), `differenceCaption`, 초안 리듀서(`choose`가 recommendationJobId를 지우거나 붙임, `edit`이 source를 null로, `fill` + undo 1회, select/apply 제거), 전체 채우기의 손댄 행 판정.
- 통합(`tests/integration`): `getBudgetPlanningData`가 시드 3개월(1개 미마감)에서 `average3.months`, `provisional`, `previousActual.partial`을 맞게 준다. 기존 `budget-save` 통합 테스트는 그대로 통과.
- E2E(`tests/e2e`): (1) 데스크톱에서 참고 줄 클릭 → 입력값 변경 → 선택 표시 → 직접 타이핑 → `직접 입력` 캡션 → 저장 → 새로고침 후 첫 일치 줄 표시, (2) `전체 채우기 › 지난달 실적` → 손댄 행 확인 팝오버 → `고친 항목은 두기` → 실행 취소, (3) AI 상태(추천 없음 → 대화상자 → 요청 후 대기 표시)와 낡은 추천에서 AI 줄 비활성(기존 `budget-recommendations.spec.ts`·`budget-recommendation-persistence.spec.ts`의 시나리오를 새 UI로 옮긴다), (4) 390px에서 참고 줄 탭과 `전체 채우기 ▾` 메뉴.
- 실행: `NODE_OPTIONS= pnpm exec tsc --noEmit`, `NODE_OPTIONS= pnpm lint`, `NODE_OPTIONS= pnpm test`, `NODE_OPTIONS= pnpm test:db`(로컬 Supabase), `NODE_OPTIONS= pnpm e2e`, `NODE_OPTIONS= pnpm build`.

## 13. 범위 밖

- 비정기 카테고리의 적립 잔액(sinking fund) 표시. 별도 설계.
- 예산 평균·제안 계산에 마감 월만 쓰는 변경(통계에만 적용된 원칙). 여기서는 `잠정` 캡션까지만.
- AI 프롬프트·워커·스냅샷 계약 변경. 없음.
- 마이그레이션. 없음.

## 14. 참고 자료

- 목업(정적 HTML, 브라우저로 열어 픽셀 값 확인): `docs/design/budget-editor/mockups/01-desktop-editor.html` 외 4개
- 렌더 PNG: `docs/design/budget-editor/01-desktop-editor.png` … `05-mobile-390.png`, 현재 화면 `00-as-is-desktop-budgets.png`
- 설명: `docs/design/budget-editor/README.md`
- 캔버스(편집 가능): https://claude.ai/code/artifact/fcdc7a6a-70cd-4bab-be0d-9ebe49637d1a (1페이지 확정안, 2페이지 탐색 A·B·타일)

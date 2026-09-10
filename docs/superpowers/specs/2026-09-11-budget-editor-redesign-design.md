# 예산 편집기 개편 · 출처 열 표 설계

상태: 2026-09-11 브레인스토밍에서 결정 완료. 구현은 외부 개발자(ChatGPT/Codex)에게 위임한다. 이 문서와 `docs/design/budget-editor/`의 목업이 유일한 기준이다.

관련 문서
- 승인된 AI 예산 원칙: `docs/superpowers/specs/2026-09-10-ai-budget-planning-design.md` (§1, §4.4, §8은 이 문서가 일부 대체한다. 아래 §11 참고)
- 월 마감 UX: `docs/superpowers/specs/2026-09-09-month-close-ux-design.md` (헤더 칩, 예산 로더 불변)
- 디자인 토큰: `src/app/globals.css` (Swiss Ledger: ink #18181b, muted #71717a, faint #a1a1aa, hairline #e4e4e7, track #f4f4f5, panel #fafafa, blue #2563eb, red #dc2626, green #16a34a, amber #d97706, violet #7c3aed, 모서리 0, IBM Plex Sans KR, 컨트롤 34px)

## 1. 왜 바꾸나

지금 `/budgets` 편집기에는 예산을 채우는 출처가 여섯 가지 섞여 있다. 지난달 예산 채우기, 월평균(연초부터) 채우기, 리뷰 규칙(6개월 중앙값) 채우기, 변동비 감축률, 절약 시뮬레이션, AI 추천. 채우기는 미리보기 패널을 거치고, AI는 요청 패널 → 추천안 검토 구역 → 행별 체크박스 → 선택한 추천 가져오기의 네 단계다. 값을 비교하려면 지난달 돌아보기 표를 따로 펼쳐야 한다. 절차가 길고 한눈에 들어오지 않는다.

새 편집기는 **한 표에서 항목별로 출처를 골라 넣는다.** 후보 금액이 열로 나란히 보이고, 누르면 그 값이 예산에 들어간다. 저장은 표 위 한 줄의 저장 버튼 하나다.

## 2. 결정 기록

| 질문 | 결정 |
|---|---|
| 출처 범위 | **지난달 예산 · 지난달 실적 · 3개월 평균 · AI 추천** 넷과 직접 입력. 나머지 도구(월평균 채우기, 리뷰 규칙, 감축률, 시뮬레이션, 돌아보기 표)는 삭제 |
| 이름 | 이력 묶음은 **실적**. 열 이름 `지난달 예산` `지난달 실적` `3개월 평균` `AI 추천` |
| 고르는 방식 | **A안 출처 열 표.** 행별 드롭다운(B), 단계형(C)은 비교가 안 되거나 클릭이 늘어 기각 |
| AI 요청 UI | 표의 AI 열 머리에 버튼 하나. 참고 메모·예정 지출은 **작은 대화상자**에서 입력. 요청 패널은 삭제 |
| 상한 구역 | 슬라이더와 네 칸을 **한 줄로 압축해 표 위에 고정.** 저축률은 숫자를 눌러 팝오버에서 조정 |
| 모바일 | 표 대신 **항목 카드 + 출처 칩** |
| 선택 표시 | 저장하지 않고 **금액 일치로 유도.** 입력값과 같은 출처 칸이 선택된 모양. AI만 예외로 작업 ID 기준 |
| 3개월 평균 | **끝난 최근 3개월**의 월평균. 마감 여부 무관, 미마감 달이 섞이면 캡션에 `잠정` |
| 지난달이 진행 중일 때 | 값은 그대로 보이고 열 머리에 `9월 27일까지 · 진행 중` |
| 미래 월의 KPI 세 칸 | 숨긴다. 상한 줄이 같은 숫자를 들고 있다 |

## 3. 화면 구조

`/budgets?month=YYYY-MM` 한 페이지. 위에서 아래로.

1. **헤더** 제목 `2026년 10월 예산` + `MonthStatusLabel` heading 변형 칩(현재 코드 그대로). 오른쪽에 월 이동기. `다음 달 예산 만들기 →` CTA는 유지하되 이미 다음 달을 보고 있을 때는 숨긴다.
2. **KPI 세 칸** (목표 지출 상한 · 이번 달 사용 · 더 쓸 수 있는 돈) 대상 월이 이번 달이거나 지난 달일 때만. 미래 월에는 숨긴다.
3. **페이스 경고** 이번 달일 때만. 현재 코드 그대로.
4. **상한 줄** 표 위에 고정(sticky). §6.
5. **편집표** 고정비 / 변동비 / 비정기 세 묶음. §4, §5.
6. **표 아래** 안내 한 줄과 `최근 변경 실행 취소`, 상한 초과 확인 체크박스(초과일 때만), 저장 결과 메시지, 충돌 비교 구역. 전부 현재 동작 유지.

## 4. 편집표

### 4.1 열

`항목 | 예산 (원) | 지난달 예산 | 지난달 실적 | 3개월 평균 | AI 추천`

그리드 폭(데스크톱 1440, 좌우 48px 여백): `minmax(150px, 1.1fr) 190px 160px 160px 160px 200px`, 간격 16px. 헤더는 `t-label` 회색, 아래 잉크 1px 선. 각 출처 열 머리는 세 줄이다.

| 열 | 1줄 | 2줄 (faint) | 3줄 (blue 링크) |
|---|---|---|---|
| 지난달 예산 | 지난달 예산 | `9월` | 이 열로 채우기 |
| 지난달 실적 | 지난달 실적 | `9월` 또는 `9월 27일까지 · 진행 중` | 이 열로 채우기 |
| 3개월 평균 | 3개월 평균 | `6·7·8월` (+ ` · 잠정`) | 이 열로 채우기 |
| AI 추천 | AI 추천 | 상태 한 줄 (§5.3) | 상태별 동작 (§5.3) |

### 4.2 행

- **항목** 대분류 이름(600). 대상 월이 이번 달이면 아래에 `사용 301,500 · 남은 78,500` 캡션.
- **예산** 숫자 입력(34px, 우측 정렬, 원 단위 정수) + `원`. 유효하지 않으면 지금과 같은 빨간 안내. 행에 AI 출처가 있으면 아래 캡션 `AI 추천 650,000` 또는 `AI 추천 650,000 → 조정`(보라 600) 과 `· 근거 · 출처 지우기` 링크.
- **출처 칸** 금액이 적힌 버튼(34px, 우측 정렬, 투명 테두리). hover는 panel 배경. 값이 0이거나 자료가 없으면 `—`로 비활성.
  - 지난달 실적 아래 캡션: 지난달 예산 대비 차이. 초과는 `+11,700 초과` 빨강, 이하는 `−63,700` 회색, 같으면 `예산과 같음`.
  - 3개월 평균 아래 캡션: 대상 월 `6·7·8월`. 비정기 묶음은 지출이 있었던 달 수를 덧붙인다 `6·7·8월 · 7월 1회`.
  - AI 칸 아래 캡션: `근거` 링크(§5.4). 추천이 없으면 캡션 없음.
- **묶음 머리** `고정비 조절이 어려운 비용` `변동비 생활하면서 조절할 비용` `비정기 여행·경조사 등 월 적립 예산`. 묶음 판정은 현재 `readBudgetData`의 group 규칙 그대로.

### 4.3 선택 표시

- 입력값이 어느 출처 칸의 금액과 같으면 그 칸을 선택 모양으로 그린다: track 배경, 600, hairline 테두리. 여러 칸이 같으면 모두.
- AI 칸은 금액 일치로 판단하지 않는다. `row.recommendationJobId`가 현재 완료 작업의 ID와 같을 때만 선택 모양(violet-tint 배경, #ddd6fe 테두리). 금액이 다르면 입력 아래 캡션이 `→ 조정`을 붙인다.
- 클라이언트 초안 상태에 출처 필드를 추가하지 않는다. 표시는 렌더 시 계산한다.

### 4.4 클릭 동작

- 출처 칸 클릭: 그 금액을 입력에 넣는다(초안만, 저장 전 DB 불변). 지난달 예산·실적·3개월 평균 칸은 `recommendationJobId`를 null로 지운다. AI 칸은 §5.5.
- 직접 타이핑: 금액만 바뀐다. AI 출처는 유지되어 `→ 조정`이 된다(승인 원칙 §8).
- `출처 지우기`: `recommendationJobId`를 null로. 금액은 그대로.
- **이 열로 채우기**: 값이 있는 모든 행에 그 열의 금액을 넣는다. 세션 중 사용자가 손댄 행(초안이 저장값과 다른 행)이 하나라도 덮어써지면 먼저 확인 팝오버를 띄운다. 제목 `이미 고친 n개 항목이 바뀝니다`, 행마다 `식비 600,000 → 612,400`, 버튼 `모두 채우기` `고친 항목은 두기` `취소`. 손댄 행이 없으면 바로 채운다.
- 채운 뒤 표 아래에 `지난달 실적으로 8개 항목을 채웠습니다 · 실행 취소` 한 줄. 실행 취소는 현재 `undoRows` 방식(직전 변경 1회).
- 저장 버튼은 초안이 저장값과 다를 때만 활성(`변경사항 저장`), 같으면 `저장됨` 비활성. 저장 계약(`BudgetSaveRequest`)과 서버 저장 서비스는 바꾸지 않는다.

## 5. AI 열

### 5.1 요청

- 열 머리 버튼 `AI 추천 받기`(추천이 없을 때) / `다시 추천`(완료 후, 3줄 링크로). 클릭하면 대화상자(`<dialog>`) 열림.
- 대화상자: 제목 `AI 예산 추천 요청 · 2026년 10월`, 기준 한 줄 `월평균 수입 6,115,000 · 목표 저축률 30% · 상한 4,280,500 · 지금 편집안을 참고합니다`, `참고 메모`(선택, 4,000자), `예정 지출`(선택, 최대 30개: 카테고리 · 금액 · 메모 · 삭제, 아래에 추가 행), 바닥에 `지난 요청의 프롬프트 보기` 링크(이전 작업이 있을 때), `취소` `추천 요청`. 마지막 줄 안내 `Mac에서 1~2분 걸립니다. 완료되면 표의 AI 열이 채워지고, 기다리는 동안 편집은 계속할 수 있습니다.`
- 입력 검증과 요청 흐름은 현재 `panel.tsx`의 것을 그대로 옮긴다: `prepareRequest`, `startBudgetRecommendation`, 애매한 실패 시 같은 requestId 재확인, `pollBudgetRecommendations`, `getBudgetRecommendations`. 이 로직은 `useBudgetRecommendation(month, ...)` 훅으로 빼고 UI만 대화상자와 열 머리로 나눈다.

### 5.2 사용 가능 조건

현재 규칙 그대로. 이번 달·다음 달만, 기준 수입 > 0, 저축 목표가 저장된 상태(`targetDirty`가 아닐 때), 작업기 준비. 조건 미충족이면 버튼은 비활성이고 열 머리 2줄에 이유 한 줄(§5.3).

### 5.3 열 머리 상태

| 상태 | 2줄 | 3줄 |
|---|---|---|
| 추천 없음 | `아직 추천 없음 · 이번 달·다음 달에서만` | 버튼 `AI 추천 받기` |
| 조건 미충족 | `저축 목표를 먼저 저장해 주세요` / `기준 수입이 있어야 시작할 수 있어요` / `Mac AI 작업기가 연결되지 않았습니다` / `Mac의 AI 작업기 업데이트가 필요합니다` | 버튼 비활성 |
| 대기·분석 중 | `추천 대기 중` / `Mac에서 분석 중 · 보통 1~2분` / `Mac 연결 대기 · 연결되면 자동 시작` | 버튼 `분석 중…` 비활성 |
| 완료 | `9월 27일 14:02 · 합계 1,855,000 · 상한 안` (초과면 `상한 초과 +120,000` 빨강) | `전체 반영 · 요약 · 다시 추천` |
| 낡음 (source_changed / budgets_changed) | 주황 `기록이 바뀌어 다시 추천이 필요합니다` / `예산이 바뀌어 다시 추천이 필요합니다` | `다시 추천`. 칸은 회색 취소선, 클릭 불가 |
| 실패 | 빨강, 현재 `JOB_ERROR_MESSAGES` 문구 | `다시 시도` |
| 새 지침 | 완료 상태에 보라 점 한 줄 `이전 지침으로 만든 추천입니다. 최신 지침은 다시 추천부터.` 추가 | 완료와 같음 |

패널의 배너들은 전부 이 표로 흡수된다. 네트워크 오류는 2줄에 빨강으로 쓰고 3줄에 `상태 다시 확인`.

### 5.4 근거와 요약 팝오버

- **근거**(칸 아래 링크): 제목 `식비 · AI 추천 650,000원`, 완료 시각, `reason`, `일회성 후보`(exceptional), `조정 후보`(reducible), 참조(references). 각 finding은 `기록 확인` / `사용자 제공` / `추정 · 확인 필요` 라벨을 앞에 둔다. 거래 참조는 내역 링크. 현재 `budget-row.tsx`의 `ReasonDetails`·`Reference` 로직을 팝오버 안으로 옮긴다. 바닥에 `닫기` `650,000원 넣기`.
- **요약**(열 머리 링크): `report.summary`, 네 숫자(미분류 실제 지출, 미배정 정기 지출, 근거 제공 n/m, 처리 대기·미분류), `limitations`, `overCeilingReason`, `adjustments`(상한 조정 후보), `사용한 프롬프트` 링크(현재 `AiPromptViewer`를 팝오버 또는 대화상자로).
- 저장된 행의 AI 출처가 현재 완료 작업과 다른 이전 작업이면(`savedRecommendations`), 입력 아래 캡션에 날짜를 붙인다 `AI 추천 (9월 3일) 650,000 → 조정 · 근거 · 출처 지우기`. 근거는 그 작업의 것을 보인다.

### 5.5 AI 값 넣기의 안전장치

- AI 칸 클릭과 `전체 반영`은 먼저 `checkRecommendationForApply(month, jobId)`를 호출해 통과한 결과의 금액만 넣는다. 실패 코드별 문구는 현재 `budget-form.tsx`의 것을 쓴다.
- 넣은 행은 `recommendationJobId = completed.id`. `전체 반영`은 §4.4의 손댄 행 확인 규칙을 따른다.
- 처음에 아무 행도 자동 선택·반영하지 않는다. 새 결과가 와도 기존 초안을 덮지 않는다.
- 자기 추천을 저장한 뒤의 `freshness: 'applied'` 표시와 이후 충돌 검사는 현재 서버 동작 그대로.

## 6. 상한 줄

- 위아래 잉크 1px 선, 높이 52px, 표 위에 `position: sticky; top: <앱 헤더 높이>`.
- 항목: `목표 저축률 30% ▾`(점선 밑줄, 클릭 시 팝오버) · `목표 지출 상한 4,280,500` · `편집안 합계 1,840,000` · `여유 2,440,500`(초록, 초과면 `초과 120,000` 빨강). 오른쪽 끝에 `아직 저장하지 않은 편집안`(주황, 초안이 다를 때) + 저장 버튼.
- 팝오버: 슬라이더(0~80, 정수), 큰 숫자 `30%`, 산식 `월평균 수입 6,115,000 × (1 − 30%) = 상한 4,280,500`, 기준 기간 `8개월 수입 기준 (2026-01 ~ 2026-08)`, `편집안대로면 예상 순저축률 69.9%`, 안내 `저축률 변경도 저장 버튼으로 함께 저장됩니다.`
- 계산은 현재 `spendingCeilingForTarget`, `savingsRate` 그대로. 저축률 변경은 `payload.targetChange`로 저장.
- 편집안 합계에 유효하지 않은 입력이 있으면 합계 자리에 `입력 확인 필요`(주황).

## 7. 모바일 (≤ 640px)

- 헤더·칩·월 이동기는 세로로. KPI는 데스크톱 규칙과 같다.
- 상한 줄은 두 줄로 접는다: `상한 428만 · 합계 184만 · 여유 244만` / `목표 저축률 30% ▾`, 오른쪽에 `저장`(30px). 억·만 단위 축약은 `formatWonCompact`가 있으면 쓰고 없으면 만 단위 절사.
- 묶음 머리 오른쪽에 `⋯` 메뉴: `변동비 묶음 채우기 › 지난달 예산으로 / 지난달 실적으로 / 3개월 평균으로 / AI 추천으로`. 데스크톱의 `이 열로 채우기`에 해당하며 같은 확인 규칙.
- 항목 카드: 1줄 이름 + 입력(150px). AI 출처 캡션은 그 아래. 다음 줄에 칩 네 개(32px, 줄바꿈 허용): `지난달 예산 380,000` `지난달 실적 380,000` `3개월 380,812` `AI 380,000 근거`. 선택 모양은 §4.3과 같다. `근거`는 칩 안의 링크로 팝오버(모바일에서는 바닥 시트여도 된다).
- 표 헤더의 열 머리 2줄(`9월 27일까지 · 진행 중`, `6·7·8월`)은 카드 묶음 위에 한 번만 캡션으로 보인다.

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

- `BudgetDraftRow = { major, amount: string, recommendationJobId: string | null }` 유지. `selected`는 삭제.
- 액션: `edit`, `fill`(`{ major, amount, recommendationJobId }[]`, undo 스냅샷 저장), `manual`, `undo`, `rebase`, `saved`. `apply`는 `fill`에 흡수, `select`는 삭제.
- `draftBudgetChanges`, `draftBudgetAmounts`는 그대로. 저장 계약 `save-contract.ts`와 `save-service.ts`는 바꾸지 않는다.

### 8.3 컴포넌트 경계

| 파일 | 역할 |
|---|---|
| `budget-form.tsx` | 폼·저장·충돌·상한 줄 상태. 800줄 넘지 않게: 상한 줄, 표, AI 열 머리를 아래 파일로 나눈다 |
| `ceiling-bar.tsx` (새) | 상한 줄 + 저축률 팝오버 |
| `plan-table.tsx` (새) | 헤더·묶음·행, 열 채우기와 확인 팝오버 |
| `plan-row.tsx` (`budget-row.tsx` 대체) | 행 하나. 선택 표시 계산은 순수 함수 `matchingSources(row, amount)`로 `plan-calculations.ts`에 |
| `plan-cards.tsx` (새) | 모바일 카드 + 묶음 메뉴 |
| `ai-column.tsx` (새) | AI 열 머리 상태, 요약 팝오버 |
| `ai-request-dialog.tsx` (새) | 요청 대화상자 |
| `ai-evidence.tsx` (`budget-row.tsx`의 ReasonDetails·Reference 이동) | 근거 팝오버 |
| `budget-recommendations/use-recommendation.ts` (새) | `panel.tsx`의 요청·복구·폴링 로직을 훅으로 |

## 9. 삭제

- 삭제: `src/features/budgets/simulator.tsx`, `simulator-calculations.ts`, `budget-reference.tsx`. 유지: `review-redirect.ts`(구 `/budgets/review` 리다이렉트), `review-queries.ts`·`review-calculations.ts`(AI 스냅샷이 사용, §8.1).
- `src/features/budget-recommendations/panel.tsx` 삭제(훅 + 대화상자 + 열 머리로 대체).
- `budget-form.tsx`에서 채우기 버튼 셋, 감축률 입력, 미리보기 구역, 추천안 검토 구역, 지출 상한 배분 구역, 시뮬레이션 details 삭제.
- `src/app/budgets/page.tsx`에서 `BudgetReference` 제거, 미래 월 KPI 숨김, 다음 달을 보고 있을 때 CTA 숨김.
- 삭제로 깨지는 테스트(`tests/finance/budget-review.test.ts`, `budget-recommendation-panel*.test.tsx`, `budget-draft.test.ts`의 select/apply)는 새 동작의 테스트로 교체한다.

## 10. 상태와 오류

- 저장 흐름(`saveBudgetPlan`, `BudgetActionState`, 충돌 비교 `budget_conflict`, `overage_confirmation_required`, 오류 문구)은 현재 그대로.
- 상한 초과 확인 체크박스는 여유가 음수이거나 서버가 요구할 때만 표 아래에.
- AI 상태는 §5.3. 실행 취소는 직전 1회.
- 대화상자를 연 채 월을 바꾸면 대화상자를 닫고 입력을 버린다(현재 패널의 월 변경 리셋과 동일).

## 11. 유지해야 하는 원칙

AI 예산 스펙에서 그대로 가져온다. 이 문서가 바꾸는 것은 §4.4의 "체크박스 선택 후 가져오기" 인터랙션만이다(칸 클릭과 열 반영으로 대체). 아래는 바뀌지 않는다.

- 어떤 채우기도 확인·저장 전에는 DB를 바꾸지 않는다. 손댄 행을 덮어쓸 때는 미리 보여준다.
- AI 값은 행에 `recommendationJobId`로 출처를 남긴다. 저장액과 추천액이 다르면 `→ 조정`으로 표시하고, AI가 조정액을 추천했다고 표시하지 않는다.
- 지난달/실적/평균으로 명시적으로 바꾼 행에는 AI 출처를 붙이지 않는다. 직접 타이핑은 AI 출처를 유지한다.
- 새 추천이 와도 자동으로 행을 바꾸지 않는다. 낡은 추천은 넣을 수 없다. 클라이언트가 보낸 이유 문장을 서버가 신뢰하지 않는다(서버 저장 검증 그대로).
- 처음에는 아무 항목도 선택하지 않는다.
- 브라우저에 워커 토큰·서비스 키를 주지 않는다. 결과는 HTML 실행 없이 렌더링한다. 로그에 거래 본문·프롬프트를 남기지 않는다.
- 예산 저장은 월 마감과 무관하다. 헤더 칩은 그대로. 예산 로더의 기준 수입·상한·반올림은 `/budgets` 기존 계산이 정본.

## 12. 검증

- 단위(`tests/finance`): `average3` 계산(3개월 미만, 거래 없는 달 제외, 잠정 판정, 비정기 monthsWithSpend), `matchingSources`(다중 일치, AI 제외), 초안 리듀서(fill이 recommendationJobId를 지우거나 붙임, undo 1회, select 제거), 열 채우기의 손댄 행 판정.
- 통합(`tests/integration`): `getBudgetPlanningData`가 시드 3개월(1개 미마감)에서 `average3.months`, `provisional`, `previousActual.partial`을 맞게 준다. 기존 `budget-save` 통합 테스트는 그대로 통과.
- E2E(`tests/e2e`): (1) 데스크톱에서 출처 칸 클릭 → 입력값 변경 → 선택 모양 → 저장 → 새로고침 후 유지, (2) `이 열로 채우기` → 손댄 행 확인 팝오버 → `고친 항목은 두기` → 실행 취소, (3) AI 열 머리 상태(추천 없음 → 대화상자 → 요청 후 대기 표시)와 낡은 추천에서 칸 비활성(기존 `budget-recommendations.spec.ts`·`budget-recommendation-persistence.spec.ts`의 시나리오를 새 UI로 옮긴다), (4) 390px에서 카드 칩 클릭과 묶음 메뉴.
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
- 캔버스(편집 가능): https://claude.ai/code/artifact/fcdc7a6a-70cd-4bab-be0d-9ebe49637d1a

# 개발 요청 — 통계(연간) 화면 개편

## 요청

`/report`(화면명 **통계**, 제목 "연간 통계")를 `docs/design/swiss-ledger/stats.html` 구성으로 재편한다.
지금은 11개 블록이 세로로 쌓여 있고 같은 12개월을 다섯 가지 모양(저축률 라인, 수입·지출 막대, 항목별 표, 결제수단 스택, 카테고리 라인)으로 다섯 번 그린다. 이걸 **4묶음**으로 줄이고, 월별 그래프는 **표와 같은 12개 열을 공유하는 하나**로 합친다.

정보구조 기획서 §7.5(연간 화면)의 구체화이고, 그 기획서 5단계 안에서 실행된다.

## 읽을 것 (순서대로)

1. `docs/design/swiss-ledger/stats.html` — 화면 전체 목업. 브라우저로 열 것. 마크업과 인라인 스타일이 곧 명세.
2. **동작 데모** — 라이브 캔버스 https://claude.ai/code/artifact/19387efa-0f62-42cd-8ff8-38162eb7a043 의 "통계 개편" 페이지, "수입·지출·저축 + 달마다 어떻게 달랐나 · 동작 데모" 아트보드. 클릭해 들어가면 실제로 동작한다. ②·③ 블록의 인터랙션은 이 데모가 정본이다.
3. `docs/design/swiss-ledger/stats-demo.dc.html` — 그 데모의 소스. 브라우저에서 단독 실행은 안 되지만(디자인 캔버스 런타임 필요) **로직 참고용**: 데이터 모델, 제외 규칙, 세 차트의 좌표 수식, 툴팁 판정 로직이 `renderVals()`에 그대로 있다. 구현은 이 수식을 따르면 된다.
4. `docs/design/swiss-ledger/foundation.html` + `chart-specs.html` — 시각·차트 규칙 (색, 굵기, 팔레트).

## 화면 구성 (위에서 아래로)

| # | 블록 | 내용 | 데이터 |
|---|---|---|---|
| ① | **올해 성적** | 저축률 링(목표 눈금) + 전년 대비 %p · 달성 개월 · 최고/최저 월 · 연 수입·지출·순저축 각각 전년 같은 기간 대비 ▲▼ | `getReportData` (annual, yoy, previous, bestMonth, worstMonth) · `getDashboardData.annual` |
| ② | **수입 · 지출 · 저축** | 월별 수입·지출·저축 납입 막대 3개 + 아래 순저축률 점(점선 = 목표 30%) · 오른쪽 끝에 연 저축률 | `dashboard.monthly` (income, expense, saving, savingsRate) |
| ③ | **달마다 어떻게 달랐나** | 위: 선택형 그래프 **[누적 막대 \| 선 \| 100% 누적 영역]** · 아래: 항목별 월별 표. 그래프와 표가 **같은 데이터·같은 색·같은 12개 열**. 토글 [지출 \| 수입 \| 저축] [카테고리 \| 결제수단] | `getCategoryDetails` (표) · `buildCategoryMonthly` / `buildAccountMonthly` (시리즈) |
| ④ | **어디에 썼나** | 카테고리 순위 막대(연 합계·비중·전년 대비) \| 가맹점 TOP 8(건수·올해·전년 대비) | `report.topExpenses` · `report.topMerchants` (전년 대비 열은 신규) |
| ⑤ | **전년 비교 표 \| 앞으로 6개월** | 수입·지출·순저축·저축납입·저축률의 2026 \| 2025 \| 변화 · 현금흐름 예측(현금성 자산·월평균 순흐름·6칸) | `report.yoy` · `report.cashflow` |

연도 선택기는 이 화면에만 있다 (기획서 §5.7).

## ③ 블록 상세 — 이 요청의 핵심

### 공유 열 그리드
```
grid-template-columns: 150px repeat(12, minmax(0, 1fr)) 110px 95px 90px
                       항목    1월 … 12월                   합계   월평균  추세
```
②의 막대·점, ③의 그래프, ③의 표가 **전부 이 그리드**를 쓴다. 그래프는 2~13열(12개월)에 걸치는 SVG 하나로, `viewBox="0 0 1200 220"` + `preserveAspectRatio="none"`으로 열 폭에 맞춘다. 선·면의 획은 `vector-effect="non-scaling-stroke"`. SVG 안에 글자를 넣지 않는다(축 라벨은 1열의 HTML, 월 라벨은 표 헤더가 겸한다).

### 시리즈
- 표의 대분류 행 = 그래프의 시리즈. 색은 `chart-theme.ts`의 `seriesColor(index, name)` (검증된 6색 + 그 외 회색). **표 행 앞에 같은 색 견본**.
- 시리즈가 7개 이상이면 데이터 층에서 상위 6 + "그 외"로 접힌다 (`account-monthly.ts` 폴딩 규칙, 이미 있음). 지출·카테고리 축에서 "그 외 N개 대분류" 행은 표에도 한 줄로 나온다.
- 수입·저축 흐름에서는 결제수단 축이 잠긴다(토글 흐리게).

### 세 가지 그래프 (좌표 수식은 `stats-demo.dc.html` `renderVals()` 참고)
- **누적 막대**: 월마다 시리즈를 아래서 위로 쌓음. 막대 x = `m*100+22`, 폭 56. 축 = 월 합계 최대값. 진행 중인 달은 opacity 0.6.
- **선**: 시리즈별 폴리라인, 점은 월 중심 `m*100+50`. 축 = 단일 값 최대값. 점 마커 없음(preserveAspectRatio none이라 원이 찌그러짐).
- **100% 누적 영역**: 월 합계를 1로 본 비중을 폴리곤으로 쌓음. 축 = 0/50/100%.
- 왼쪽 축 라벨 3개(최대·중간·0)는 종류에 따라 금액(`compactWon`)/%로.

### 상호작용
- **그래프 위 마우스 이동**: 열(월)은 x 비율로, 시리즈는 그래프 종류별로 판정(누적: y가 든 구간 · 선: y에 가장 가까운 선 · 영역: 비중이 든 띠) → 툴팁 **항목 · 월 · 금액 · 월 합계 대비 % · 전월 대비 ▲▼**. 툴팁은 해당 월 열 위에 뜨고 양 끝 달에서는 안쪽으로 밀린다. 그 시리즈만 남기고 나머지는 opacity 0.18, 표의 해당 행 배경 `finance-blue-tint`, 표 헤더의 그 월이 진해진다.
- **표 행에 마우스**: 그래프에서 그 시리즈만 남는다 (월은 없음 → 툴팁 없음).
- **셀 클릭 = 제외**: 그 행의 합계·월평균, 총계, **그리고 그래프**에서 빠진다(값 0 취급). 취소선. 다시 클릭하면 복원. 하단 캡션에 "제외된 셀 N개".
- **셀 호버**: 그 (항목, 월)의 거래 내역 툴팁 — `getCellTransactions` 그대로.
- **대분류 클릭**: 소분류 접기/펼치기. 소분류 행은 견본 없음(부모 색), 그래프 시리즈가 아니다.
- **8월(진행 중)**: 합계에는 넣고 월평균에서 뺀다. 그래프에서 흐리게. 표 헤더에 "8월·진행".
- **추세 열**: 행별 최근 6개월 스파크라인 80×20, 증가 red / 보합 muted / 감소 green (수입·저축 흐름에서는 반대).

### 상태
`chart`(stacked|line|area), `flow`, `axis`, `excluded`(셀 키 집합), `expanded`(대분류), `hoverSeries`, `hoverMonth`, `hoveredCell`. `chart`·`flow`·`axis`는 URL 쿼리에도 실어 새로고침·공유가 가능하게.

## 걷어내는 것

- 월별 순저축률 라인 차트 단독 블록 → ②에 흡수
- 월별 수입·지출 막대 단독 블록 → ②에 흡수
- `AccountMonthlyPanel` (결제수단별 누적 막대 + 합계표) → ③의 결제수단 축
- `CategoryMonthlyPanel` (카테고리별 라인 + 범례 토글) → ③의 선 그래프 + 표 행 견본
- 연 순저축률 3칸 블록 → ①에 흡수
- 지출 TOP의 하드코딩 팔레트는 이미 제거됨(단색 잉크 순위 막대 유지)

두 패널 컴포넌트는 다른 화면에서 안 쓰면 삭제한다(`grep -rn "AccountMonthlyPanel\|CategoryMonthlyPanel" src`로 확인).

## 신규로 필요한 것

1. **`report.topExpenses` / `topMerchants`에 전년 같은 기간 값** (`previous`, `delta`) — ④의 전년 대비 열. `getReportData`가 이미 전년 집계를 하니 대분류·가맹점 단위로 확장.
2. **선택형 차트 컴포넌트** `src/features/analytics/series-chart.tsx` ('use client'): props `{ series: Array<{ id, label, color, values: (number|null)[] }>, kind: 'stacked'|'line'|'area', currentMonthIndex, activeMonths, hoverSeries, hoverMonth, onHover(seriesId|null, month|null) }`. 그리드 열 폭에 맞추는 SVG(위 규칙). 툴팁은 부모가 그린다.
3. **표 + 그래프 상태 공유**: `category-detail-table.tsx`가 이미 셀 제외·호버·flow 토글을 갖고 있다. 이 컴포넌트를 ③ 블록의 부모로 확장해 그래프를 자식으로 두거나, 상태를 `stats-monthly-section.tsx`(신규)로 끌어올려 둘에 내려준다. 후자를 권한다. 기존 셀 제외·호버 동작과 테스트는 그대로 유지.
4. **행 견본 + 행 hover → 시리즈 강조**, **셀 제외 → 시리즈 값 0**.

## 지켜야 할 것

- 계산식 변경 금지 (저축률·완료월 평균·YoY·예측). 기존 테스트 전부 통과.
- 새 컴포넌트에 테스트: 세 그래프의 좌표(누적 합계, 100% 비중 합 = 1), 제외 시 값 0 반영, 시리즈 판정(누적 구간·최근접 선·비중 띠), 폴딩된 "그 외" 색.
- 파이·도넛 금지, 이중 y축 금지, SVG 안 텍스트 금지(찌그러짐).
- 모든 Drizzle 쿼리에 householdId. `pnpm lint` · `tsc --noEmit` · `pnpm test` · `pnpm build` 통과.
- 표는 `overflow-x-auto` 안에, 그래프도 같은 컨테이너 안에서 함께 스크롤(열이 어긋나면 안 된다).

## 진행 순서

① `series-chart.tsx` + 테스트 → ② `stats-monthly-section.tsx`로 표·그래프 상태 통합(기존 표 동작 유지) → ③ `/report` 페이지를 5블록으로 재배치, 두 패널 제거 → ④ 전년 대비 열 데이터 → ⑤ URL 상태·빈 상태·모바일(그래프+표 같은 스크롤 컨테이너).
①~③이 끝나면 실물을 보여주고 멈춘다.

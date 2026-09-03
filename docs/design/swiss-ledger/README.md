# Swiss Ledger — UI 디자인 확정안

2026-09-02 승인. finance-web 전체 UI가 따라야 할 시각 언어.

## 파일

| 파일 | 내용 |
|---|---|
| `foundation.html` | **구현 기준 시트** — 색 토큰, 타이포 스케일, 구조 규칙, 컴포넌트(버튼·배지·테이블·진행바) |
| `dashboard-v2.html` | **대시보드 개편안 (최신)** — 히어로 3분할(저축률 링·남은 돈·순자산), 순자산 추이, 돈의 흐름 워터폴, 예산 불릿, 카테고리 스파크라인 |
| `chart-specs.html` | **차트 명세** — 차트 타입 결정표, 새 컴포넌트 치수, 검증된 팔레트, 재무건강 기준선 대조 |
| `dashboard.html` | 대시보드 (현행 구조 리디자인) — v2 이전안. 항목별 월별 테이블의 셀 제외·호버 툴팁 표현은 여기가 정본 |
| `ledger.html` | 가계부 목업 — safe-to-spend 히어로, 월말 예측, 필터 칩, 거래 테이블 |
| `inbox.html` | 인박스 목업 — 업로드, 자동분류 일괄승인 밴드, 확인 필요 행(출처 배지) |

브라우저로 직접 열면 됩니다. 폰트는 Google Fonts(IBM Plex Sans KR)를 CDN에서 불러옵니다.
라이브 캔버스(팬/줌, PNG·PDF 내보내기): https://claude.ai/code/artifact/19387efa-0f62-42cd-8ff8-38162eb7a043

## 핵심 규칙 (요약 — 정본은 foundation.html)

**색**: 바탕과 구조는 흑백. 색은 **의미에만** 쓴다.
- ink `#18181b` 본문·지출바 / muted `#71717a` 보조 / faint `#a1a1aa` 캡션
- hairline `#e4e4e7` 구분선 / track `#f4f4f5` 바 트랙·행 hover
- **수입 `#2563eb`** · **지출 `#dc2626`** · **저축 `#16a34a`** · 주의 `#d97706` · AI `#7c3aed`
- 틴트(`#eff6ff` `#fef2f2` `#f0fdf4` `#fffbeb` `#f5f3ff`)는 **작은 배지 배경에만**. 카드 배경 틴트 금지.
- 링크·액티브 강조는 blue 하나로. accent와 semantic을 다른 색으로 쓰지 않는다.

**구조**
- 섹션 시작 = ink 1px 룰, 내부 구분 = hairline. **카드·그림자·라운드 없음** (radius 0).
- 페이지 여백 48px, 섹션 세로 패딩 24px, 그리드 갭 24/48px.
- 숫자는 항상 우측 정렬 + `tabular-nums`, 단위 '원'은 muted로 축소.
- 버튼·칩·배지는 `white-space: nowrap` (한 줄 고정).

**타이포** — IBM Plex Sans KR
- 페이지 제목 30/700 (화면당 1개) · KPI 값 26/600 · 섹션 제목 14/700
- 본문·테이블 13 · 보조 12 muted · 라벨 11/600 letter-spacing .1em

**알림**: 틴트 배너를 쌓지 않는다. 7px 사각 점 + 한 줄 텍스트 + 우측 액션 링크로 목록화.

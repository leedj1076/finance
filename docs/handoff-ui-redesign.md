# 개발 요청 — Swiss Ledger UI 적용

## 요청

finance-web의 UI를 `docs/design/swiss-ledger/`의 확정 디자인으로 전면 교체한다.
목표는 **Professional · Modern · Simple · Minimalist · 정렬이 딱 맞는 화면**이다.

기능 변경이 아니라 **시각 언어 교체**다. 데이터 로직, 서버 액션, 쿼리, 계산식은 건드리지 않는다.

## 1단계로 읽을 것 (순서대로)

1. `docs/design/swiss-ledger/README.md` — 규칙 요약
2. `docs/design/swiss-ledger/foundation.html` — **구현 기준 시트(정본)**. 색 토큰·타이포 스케일·구조 규칙·컴포넌트 스펙이 여기 다 있다. 브라우저로 열어서 볼 것.
3. `docs/design/swiss-ledger/dashboard.html`, `ledger.html`, `inbox.html` — 목업 3종. **마크업과 인라인 스타일이 곧 명세**다. 색·간격·폰트 크기는 목업에서 그대로 가져오고 4/8px 그리드로 반올림하지 말 것.

라이브 캔버스(팬/줌·PNG 내보내기): https://claude.ai/code/artifact/19387efa-0f62-42cd-8ff8-38162eb7a043

목업의 숫자는 전부 샘플이다. 실제 값은 기존 쿼리에서 온다.

## 지금 UI의 문제 (이 작업이 고칠 것)

1. **알림 배너 인플레이션** — 가계부/대시보드 상단에 amber·rose·orange 틴트 배너가 4~5장 쌓인다. 전부 색면으로 소리쳐서 급한 게 안 보인다. → 7px 사각 점 + 한 줄 텍스트 + 우측 액션 링크의 목록으로 교체.
2. **틴트 남용** — 인사이트 카드, 상태 박스, KPI까지 soft 배경이 깔려 위계가 색 면적에 묻힌다. → 카드 배경 틴트 전면 제거, 틴트는 작은 배지에만.
3. **색 역할 충돌** — 링크·강조가 emerald인데 수입은 blue-700, 저축은 emerald-700이라 accent와 semantic이 겹친다. → 링크·액티브는 blue 하나, 수입/지출/저축은 semantic 3색 고정.
4. **정렬 리듬 불일치** — `rounded-2xl`(9px)/`rounded-xl`(7px) 혼재, 카드마다 `shadow-sm`, 섹션 패딩 제각각. Notion풍 헤더와 Tailwind 기본풍 본문이 섞여 있다. → radius 0 + 헤어라인 룰 + 48/24px 리듬으로 통일.

## 작업 범위

`globals.css`의 토큰을 Swiss Ledger 팔레트로 재정의하고, 아래 화면을 목업 기준으로 교체한다:

- `src/app/dashboard/page.tsx` — 목업 있음. **단, 대시보드는 구성 자체를 바꾸는 별도 요청서(`docs/handoff-dashboard-v2.md`)가 있다.** 두 작업을 같이 한다면 v2 구성으로 바로 가고, UI만 먼저 한다면 `dashboard.html`(현행 구조)을 따른 뒤 나중에 v2를 얹는다
- `src/app/ledger/page.tsx` — 목업 있음
- `src/app/inbox/page.tsx` + `src/features/inbox/inbox-review-*.tsx` — 목업 있음
- `src/app/analysis`, `budgets`, `report`, `category`, `assets`, `recurring`, `manage`, `settings` — **목업 없음**. foundation.html의 규칙으로 같은 언어에 맞춰 정리한다. 새 레이아웃을 발명하지 말고 기존 정보 구조를 유지한 채 토큰·간격·색만 교체.
- `src/components/app-header-menu.tsx` + `globals.css`의 `.finance-*` 헤더 스타일 — 목업 헤더(56px, ink 1px 하단 룰, blue 2px 액티브 밑줄)에 맞춤
- `src/components/page-loading.tsx`, `src/app/error.tsx`, `not-found.tsx` — 스켈레톤·에러 화면도 같은 언어로
- `src/components/action-notice.tsx` — 토스트도 배지 규칙에 맞춤
- `src/features/analytics/*-chart.tsx` — 차트 색을 semantic으로(수입 blue, 지출 ink), 격자·축은 hairline/faint

## 지켜야 할 것

- **기존 테스트 162개는 전부 통과해야 한다.** 시각 작업이니 테스트가 깨지면 로직을 건드린 것이다.
- 데이터 함수, 서버 액션, 쿼리, 계산식(저축률·페이스·예측), 지문·분류 로직은 수정 금지.
- 반응형 유지: 넓은 테이블은 `overflow-x-auto` 안에 두고 페이지 본문은 가로 스크롤이 생기지 않게.
- 기존 aria-label·sr-only 유지. 아이콘 전용 버튼에 라벨 유지.
- 다크모드는 **이번에 함께 넣는다** (지금 미지원). 팔레트를 새로 정하는 참이라 같이 하는 게 맞다. `:root` 라이트 토큰 + `prefers-color-scheme: dark`에서 토큰만 재정의. semantic 3색은 다크에서 명도만 올린다.
- 검증: `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test` (162) · `pnpm build` 전부 통과.

## 진행 방식

화면 단위로 커밋한다. 순서: ① globals.css 토큰 + 헤더 → ② 대시보드 → ③ 가계부 → ④ 인박스 → ⑤ 나머지 화면 → ⑥ 차트·경계·토스트 → ⑦ 다크모드.
①이 끝나면 나머지 화면이 자동으로 절반은 따라오므로, ① 직후 한 번 전체를 훑어 회귀를 확인할 것.

## 이 저장소의 다른 대기 작업 (이번 요청 범위 아님, 충돌 인지용)

- `docs/superpowers/plans/2026-09-02-flask-parity.md` (9 태스크) — Flask 기능 이식. 대부분 이미 반영됨, 잔여분 확인 필요.
- `docs/superpowers/plans/2026-09-01-smart-classification.md` (11 태스크) — 머천트 사전 + OpenAI 폴백. 카드 업로드·2단 인박스는 이미 들어갔고 AI 폴백 잔여.

두 플랜 모두 인박스 화면을 건드린다. UI 작업과 동시에 진행하면 `inbox-review-*.tsx`에서 충돌하니, UI를 먼저 끝내는 것을 권한다.

## 환경

- `pnpm install` 후 로컬 Supabase 필요(Docker). `.env.local`에 `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 4개가 있어야 테스트가 돈다(`.env.example` 참고). 없으면 19개 테스트 파일이 실행조차 안 된다.
- `SUPABASE_SERVICE_ROLE_KEY`는 로컬·테스트 전용. Vercel에 넣지 말 것.

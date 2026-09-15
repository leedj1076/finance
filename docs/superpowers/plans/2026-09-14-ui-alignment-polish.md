# UI 정렬 다듬기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-09-14 전 화면 UI 점검에서 측정으로 확인된 정렬·중복·오독 문제를 고친다.

**Architecture:** 전부 표시 계층이다. 새 스키마·읽기 모델·서버 액션은 없다. 흩어진 markup 두 곳을 공용 단위로 끌어올리고(`MonthNav`, 탭 클래스), 나머지는 클래스·상수·문구 수정이다. 로직이 있는 두 곳(자산 배분 비중, 정기거래 후보 판정)만 순수 함수로 빼서 유닛 테스트를 붙인다. 태스크 사이 의존은 없으므로 어느 순서로도 실행할 수 있다.

**Tech Stack:** Next.js 15 App Router, Tailwind v4, Chart.js 4 + react-chartjs-2, Vitest(`pnpm test` 유닛 / `pnpm test:db` 통합), Playwright(`pnpm e2e`).

**Spec:** 이 플랜은 별도 스펙 문서 없이 2026-09-14 세션의 측정 결과를 근거로 삼는다. 근거가 되는 수치는 각 태스크의 "왜" 문단에 브라우저 측정값으로 적혀 있다. 선행 플랜 `docs/superpowers/plans/2026-09-10-ui-polish.md`는 12개 태스크 전부 미실행 상태이며, 이 플랜이 그중 살아 있는 항목을 흡수하고 나머지는 아래 "선행 플랜 처리"에 적은 이유로 버린다.

## Global Constraints

- 색은 토큰만: ink `#18181b`, muted `#71717a`, faint `#a1a1aa`, hairline `#e4e4e7`, track `#f4f4f5`, panel `#fafafa`, blue `#2563eb`, red `#dc2626`, green `#16a34a`, amber `#d97706`. Tailwind 클래스는 `text-finance-*` / `bg-finance-*` / `border-finance-*`.
- **버튼 규칙**: 채운 검정(`bg-finance-ink text-white`) = 주 버튼. 채운 초록은 월 마감 컨트롤 두 곳만 — `src/features/month-close/month-close-control.tsx`의 `월 전체 마감`(확정)과, `allClear`일 때만 초록이 되어 색으로 상태를 나르는 `월 마감` 트리거. 채운 파랑 버튼은 없다. 비활성은 `disabled:opacity-40`, 색을 바꾸지 않는다.
- **색 의미**: 빨강 = 초과·음수·오류. 초록 = 저축·달성·확정. 파랑 = 수입·링크. 주황 = 경고·잠정.
- **내역 표의 빨간 `지출` 칩은 그대로 둔다.** 사용자가 2026-09-14에 유지하기로 결정했다. 선행 플랜 Task 3의 칩 제거는 실행하지 않는다.
- **금액은 `formatWon` 그대로.** 억·만 축약(`formatWonCompact`)은 도입하지 않는다. 사용자가 2026-09-14에 "그냥 숫자가 낫다"로 결정했다. 선행 플랜 Task 1·8의 축약 부분은 실행하지 않는다.
- **컨트롤 높이는 34px 하나.** 새로 쓰는 버튼·입력·링크형 버튼은 `h-[34px]`.
- 원시 `text-[Npx]`를 새로 쓰지 않는다. `t-*` 타입 스케일(`t-page-title` `t-kpi` `t-kpi-sm` `t-section` `t-body` `t-body-strong` `t-caption` `t-label` `t-badge`)을 쓴다. 브라우저 기본 스타일이 크기를 바꾸는 태그(`<small>` `<big>`)도 금지 — `t-*` 클래스를 쓴 `<span>`으로 바꾼다.
- 모든 node·pnpm 명령 앞에 `NODE_OPTIONS=` 를 붙인다. 이 환경의 cmux preload 때문이며 빼면 실패한다.
- 각 태스크 끝에 `NODE_OPTIONS= pnpm exec tsc --noEmit`, `NODE_OPTIONS= pnpm lint`, 해당 테스트 통과 후 커밋. 태스크 단위 커밋, 메시지는 `style(scope): …` / `fix(scope): …` / `feat(scope): …`.
- `git add`는 플랜에 적힌 경로만. 다른 세션의 untracked 파일은 절대 포함하지 않는다. `git add -A` 금지.
- 측정이 필요한 태스크는 `pnpm dev`를 띄우고 그 태스크에 적힌 측정 스크립트를 돌려 숫자로 확인한다. 로그인 계정은 `dev@finance.local` / `devdev1234`.
- **`pnpm build`와 `pnpm dev`를 동시에 돌리지 않는다.** `.next`가 깨져 로그인 페이지 JS가 404난다. 빌드가 필요하면 dev 서버를 먼저 죽인다.

## 범위에서 뺀 것

- **정기거래 행 접기.** 화면이 5,229px인 두 원인 중 후보 과다(Task 14)만 고친다. 규칙 행 자체를 읽기 전용 목록으로 접는 것은 `recurring-manager.tsx`의 그리드 키보드 이동·붙여넣기 처리와 정면으로 부딪히는 UX 재설계라, 폴리시 플랜이 아니라 별도 brainstorming이 필요하다.
- **홈에서 이번 달이 비면 지난달을 보여주기.** 새 데이터 경로가 필요한 제품 변경이다. 이 플랜은 빈 달에 같은 빈 막대 여섯 줄을 그리지 않는 것까지만 한다(Task 9).
- **선행 플랜 Task 4**(예산 진행 막대 검정). 예산 편집기 개편 때 그 막대가 사라져 고칠 대상이 없다.
- **선행 플랜 Task 1·3·8의 축약·칩 부분.** 위 Global Constraints에 적은 사용자 결정에 따라 버린다.

## File Structure

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `src/components/month-nav.tsx` (신규) | 세 화면이 공유하는 월 이동 컨트롤 | 1 |
| `src/app/ledger/page.tsx` | 월 네비 사용, 탭 클래스, 주 버튼 색, 입력 폼 토글 자리 | 1·2·3·5 |
| `src/app/budgets/page.tsx` | 월 네비 사용, 주 버튼 색 | 1·3 |
| `src/app/assets/page.tsx` | 월 네비 사용, 두 밴드 격자, 배분 막대 | 1·6·7 |
| `src/app/globals.css` | 공용 탭 클래스 `.app-tab` | 2 |
| `src/features/inbox/inbox-tabs.tsx` | 탭 클래스 적용, 모바일 라벨 | 2·13 |
| `src/components/settings-nav.tsx` | 탭 클래스 적용, 원시 px 제거 | 2 |
| `src/features/budgets/plan-list.tsx` | 머리글의 `<small>` 제거 | 4 |
| `src/features/ledger/transaction-form.tsx` | 스스로 접히는 입력 폼 | 5 |
| `src/features/assets/composition.ts` (신규) | `compositionShares` 순수 함수 | 7 |
| `tests/finance/asset-composition.test.ts` (신규) | 비중 계산 테스트 | 7 |
| `src/features/assets/net-worth-chart.tsx` | 순자산 한 선, 툴팁, 범례 제거 | 8·15 |
| `src/app/dashboard/page.tsx` | 예산 막대, 빈 달, 두 차트 격자 | 9·10 |
| `src/features/analytics/chart-js.ts` | `provisionalPattern` 삭제, `CHART_ANIMATIONS` 추가 | 11·15 |
| `src/features/analytics/series-chart.tsx` | 잠정 막대 반투명 | 11·15 |
| `src/features/analytics/annual-flow-overview.tsx` | 잠정 막대 반투명 | 11·15 |
| `src/app/report/page.tsx` | 잠정 배지 하나로 | 12 |
| `src/features/analytics/stats-monthly-section.tsx` | 안내 문장 하나, 누적 막대 범례 | 12 |
| `src/features/inbox/inbox-review-*.tsx`, `upload-form.tsx` | 검은 띠, 중복 문구, 버튼, 한국어 파일 선택 | 13 |
| `src/features/recurring/calculations.ts` | 후보 판정 조건 | 14 |
| 차트 9곳 | 가로 애니메이션 끄기 | 15 |

---

## Task 1: 월 네비를 컴포넌트 하나로

**왜:** 같은 월 이동 컨트롤이 세 화면에 각각 손으로 쓰여 있고 서로 다르게 자랐다. 브라우저 측정값으로 내역은 날짜 입력 124x**32**·보기 버튼 48x**32**, 예산과 자산은 162x**34**·47x**34**이다. 테두리도 내역은 `border-finance-ink` 한 덩어리, 나머지는 `border-finance-hairline` 낱개다. 호버도 내역만 `hover:bg-finance-blue`, 나머지는 `hover:opacity-80`.

**Files:**
- Create: `src/components/month-nav.tsx`
- Modify: `src/app/ledger/page.tsx:141-154`
- Modify: `src/app/budgets/page.tsx:96-127`
- Modify: `src/app/assets/page.tsx:67-72`

**Interfaces:**
- Produces: `MonthNav({ action, label, month, previousHref, nextHref, max, hidden })` — `action`은 폼이 GET으로 보낼 경로, `label`은 날짜 입력의 `aria-label`(E2E가 이 문자열로 찾으므로 화면마다 기존 값을 그대로 넘긴다), `hidden`은 폼과 함께 보낼 `<input type="hidden">`들(`ReactNode`, 없으면 생략).
- E2E가 의존하는 접근성 이름은 그대로 유지된다: `조회 월`(내역), `예산 월`(예산), `자산 기준 월`(자산), `이전 달`, `다음 달`, 버튼 텍스트 `보기`.

- [ ] **Step 1: 컴포넌트 작성** — `src/components/month-nav.tsx` 신규

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SubmitButton } from '@/components/submit-button'

type MonthNavProps = {
  action: string
  label: string
  month: string
  previousHref: string
  nextHref: string
  max?: string
  hidden?: ReactNode
}

/**
 * Three pages hand-rolled this control and drifted apart: the ledger's sat at
 * 32px in a single ink-bordered block, assets and budgets at 34px as separate
 * hairline boxes. One segmented control at the 34px token height now.
 */
export function MonthNav({ action, label, month, previousHref, nextHref, max, hidden }: MonthNavProps) {
  return (
    <div className="flex items-center border border-finance-ink">
      <Link
        aria-label="이전 달"
        className="grid h-[34px] w-[34px] place-items-center border-r border-finance-ink t-body hover:bg-finance-track"
        href={previousHref}
      >
        ←
      </Link>
      <form action={action} className="flex h-[34px] items-center">
        {hidden}
        <input
          aria-label={label}
          className="h-[34px] w-[124px] border-0 bg-white px-2 text-center t-body-strong text-finance-ink outline-none"
          defaultValue={month}
          key={month}
          max={max}
          name="month"
          type="month"
        />
        <SubmitButton
          className="h-[34px] border-l border-finance-ink bg-finance-ink px-3 t-body-strong text-white hover:bg-finance-blue"
          pendingLabel="불러오는 중…"
          type="submit"
        >
          보기
        </SubmitButton>
      </form>
      <Link
        aria-label="다음 달"
        className="grid h-[34px] w-[34px] place-items-center border-l border-finance-ink t-body hover:bg-finance-track"
        href={nextHref}
      >
        →
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: 내역에 적용** — `src/app/ledger/page.tsx`. 141-154행의 `<div className="flex items-center border border-finance-ink">…</div>` 전체를 다음으로 바꾼다.

```tsx
            <MonthNav
              action="/ledger"
              hidden={<>
                <input name="tab" type="hidden" value={tab} />
                {filters.sort && <input name="sort" type="hidden" value={filters.sort} />}
                {filters.account && <input name="account" type="hidden" value={filters.account} />}
                {filters.flow && <input name="flow" type="hidden" value={filters.flow} />}
                {filters.major && <input name="major" type="hidden" value={filters.major} />}
                {filters.q && <input name="q" type="hidden" value={filters.q} />}
              </>}
              label="조회 월"
              max={shell.latestMonth}
              month={shell.month}
              nextHref={ledgerUrl(shell.nextMonth, filters, { tab })}
              previousHref={ledgerUrl(shell.previousMonth, filters, { tab })}
            />
```

import에 `import { MonthNav } from '@/components/month-nav'` 추가.

- [ ] **Step 3: 예산에 적용** — `src/app/budgets/page.tsx`. 96-127행의 `←` Link, `<form action="/budgets">…</form>`, `→` Link 세 덩어리를 다음 하나로 바꾼다. 그 위의 `다음 달 예산 만들기 →` Link는 Task 3에서 다루므로 여기서는 건드리지 않는다.

```tsx
            <MonthNav
              action="/budgets"
              label="예산 월"
              month={data.month}
              nextHref={`/budgets?month=${data.nextMonth}`}
              previousHref={`/budgets?month=${data.previousMonth}`}
            />
```

import에 `import { MonthNav } from '@/components/month-nav'` 추가.

- [ ] **Step 4: 자산에 적용** — `src/app/assets/page.tsx`. 67-72행의 `←` Link, `<form action="/assets">…</form>`, `→` Link를 다음 하나로 바꾼다. 66행의 `자산 계정 설정` Link는 그대로 둔다.

```tsx
            <MonthNav
              action="/assets"
              label="자산 기준 월"
              month={data.month}
              nextHref={`/assets?month=${data.nextMonth}`}
              previousHref={`/assets?month=${data.previousMonth}`}
            />
```

import에 `import { MonthNav } from '@/components/month-nav'` 추가. `SubmitButton` import는 70행 외에도 쓰이는지 확인하고, 안 쓰이면 지운다.

- [ ] **Step 5: 세 화면이 같은 크기인지 측정**

`pnpm dev`를 띄우고 아래를 `/tmp/monthnav.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
for (const [route, label] of [['/ledger', '조회 월'], ['/budgets', '예산 월'], ['/assets', '자산 기준 월']]) {
  await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' })
  const r = await page.getByLabel(label).boundingBox()
  const v = await page.getByRole('button', { name: '보기', exact: true }).boundingBox()
  console.log(`${route} 입력 ${Math.round(r.width)}x${Math.round(r.height)} 보기 ${Math.round(v.width)}x${Math.round(v.height)}`)
}
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/monthnav.mjs`
Expected: 세 줄 모두 `입력 124x34 보기 47x34`. 높이가 34가 아닌 줄이 하나라도 있으면 그 화면의 교체가 덜 된 것이다.

- [ ] **Step 6: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

dev 서버를 죽이고 E2E를 돌린다. 이 셋이 월 네비를 쓴다.
Run: `NODE_OPTIONS= pnpm e2e tests/e2e/period-sorting-charts.spec.ts tests/e2e/auth.spec.ts tests/e2e/month-close.spec.ts`
Expected: PASS. 실패하면 `getByLabel` 문자열이 바뀐 것이므로 Step 2-4의 `label` prop을 다시 본다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/month-nav.tsx src/app/ledger/page.tsx src/app/budgets/page.tsx src/app/assets/page.tsx
git commit -m "style: one month nav control at the 34px token height"
```

---

## Task 2: 탭 줄을 하나로

**왜:** 탭 스트립이 네 군데 있고 높이가 다 다르다. 측정값으로 내역의 요약·목록이 41px, 관리·설정의 좌측 레일이 44px, 가져오기의 검토 대기·파일 업로드가 46px다. 원인은 `py-2.5` 대 `py-3`과 테두리 두께 차이다. `settings-nav.tsx`는 `text-[11px]`·`text-[13px]` 원시 크기까지 쓴다.

**Files:**
- Modify: `src/app/globals.css` (앵커: `.t-badge { font-size: 10px;` 줄 다음)
- Modify: `src/app/ledger/page.tsx:186`
- Modify: `src/features/inbox/inbox-tabs.tsx:33`
- Modify: `src/components/settings-nav.tsx:18,23`

**Interfaces:**
- Produces: CSS 클래스 `.app-tab` — 패딩과 글자만 정한다. 선택 상태의 색과 테두리 방향은 각 호출부가 유틸리티로 덧붙인다.

- [ ] **Step 1: 공용 클래스** — `src/app/globals.css`의 `.t-badge { … }` 줄 바로 다음에 넣는다.

```css
/* Tab strips drifted to 41px, 44px and 46px on three screens. One padding. */
.app-tab { padding: 7px 16px; font-size: 13px; font-weight: 600; line-height: 1.5; white-space: nowrap; }
```

7px + 19.5px + 7px = 33.5px에 테두리 1px을 더해 34px가 된다. 좌측 레일은 세로 테두리라 34px 그대로다.

- [ ] **Step 2: 내역 탭** — `src/app/ledger/page.tsx:186`의 `className` 안 `px-3 py-2.5 sm:px-5 t-body-strong`를 `app-tab`으로 바꾼다. 결과:

```tsx
            <Link aria-current={tab === item.key ? 'page' : undefined} className={`shrink-0 border-x border-t app-tab first:border-l ${tab === item.key ? 'border-finance-ink bg-finance-ink text-white' : 'border-finance-hairline bg-white text-finance-muted hover:text-finance-ink'}`} href={ledgerUrl(shell.month, filters, { tab: item.key })} key={item.key}>{item.label}</Link>
```

- [ ] **Step 3: 가져오기 탭** — `src/features/inbox/inbox-tabs.tsx:33`의 `px-4 py-3 t-body-strong`를 `app-tab`으로.

```tsx
          className={`shrink-0 border-b-2 app-tab ${tab === item.key ? 'border-finance-blue text-finance-blue' : 'border-transparent text-finance-muted hover:text-finance-ink'}`}
```

- [ ] **Step 4: 설정 레일** — `src/components/settings-nav.tsx`. 18행의 `text-[11px] font-semibold uppercase tracking-[0.12em] text-finance-muted`를 `t-label uppercase text-finance-muted`로. 23행의 `px-4 py-3 text-[13px] font-semibold`를 `app-tab`으로.

```tsx
      <p className="mb-3 t-label uppercase text-finance-muted">설정</p>
```

```tsx
            className={`block border-b-2 app-tab lg:border-b-0 lg:border-l-2 ${active === item.key ? 'border-finance-blue bg-finance-blue-tint text-finance-blue lg:-ml-px' : 'border-transparent text-finance-muted hover:text-finance-ink'}`}
```

- [ ] **Step 5: 네 스트립 높이 측정**

`pnpm dev`를 띄우고 `/tmp/tabs.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
for (const [route, name] of [['/ledger', '요약'], ['/inbox', '파일 업로드'], ['/manage', '카테고리'], ['/settings', '자산 계정']]) {
  await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' })
  const box = await page.getByRole('link', { name, exact: true }).first().boundingBox()
  console.log(`${route} ${name} ${Math.round(box.height)}px`)
}
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/tabs.mjs`
Expected: 네 줄 모두 `34px`. 레일이 34가 아니면 `lg:border-b-0`이 안 먹은 것이므로 4단계를 다시 본다.

- [ ] **Step 6: 원시 px가 남았는지 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && git grep -n 'text-\[1[0-9]px\]' -- src/components/settings-nav.tsx src/features/inbox/inbox-tabs.tsx`
Expected: 0 errors, grep 결과 없음.

dev 서버를 죽이고:
Run: `NODE_OPTIONS= pnpm e2e tests/e2e/diagnosis.spec.ts tests/e2e/import-progress.spec.ts`
Expected: PASS. `diagnosis.spec.ts:57`이 내역 탭 텍스트 다섯 개를, `import-progress.spec.ts:95`가 가져오기 탭의 `검토 대기1`을 확인한다. 라벨은 바뀌지 않았으므로 통과해야 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/app/globals.css src/app/ledger/page.tsx src/features/inbox/inbox-tabs.tsx src/components/settings-nav.tsx
git commit -m "style: one tab height across the four strips"
```

---

## Task 3: 주 버튼을 검정 하나로

**왜:** 내역의 `거래 추가`는 채운 파랑, 예산의 `다음 달 예산 만들기`는 채운 초록이다. Global Constraints의 버튼 규칙상 채운 초록은 월 마감 확정 한 곳뿐이고 채운 파랑은 없다.

**Files:**
- Modify: `src/app/ledger/page.tsx:140`
- Modify: `src/app/budgets/page.tsx:89-94`

- [ ] **Step 1: 내역 거래 추가** — `src/app/ledger/page.tsx:140`의 클래스 `h-[34px] bg-finance-blue px-4 py-2 t-body-strong text-white hover:opacity-80`를 다음으로.

```tsx
            {tab !== 'list' && <Link className="h-[34px] bg-finance-ink px-4 py-2 t-body-strong text-white hover:bg-finance-blue" href={`${ledgerUrl(shell.month, filters, { tab: 'list' })}#transaction-form`}>거래 추가</Link>}
```

- [ ] **Step 2: 예산 CTA** — `src/app/budgets/page.tsx:89-94`의 클래스 `h-[34px] whitespace-nowrap border border-finance-green bg-finance-green px-3 py-2 t-body-strong text-white hover:opacity-80`를 다음으로.

```tsx
            {!viewingNextMonth && <Link
              className="h-[34px] whitespace-nowrap bg-finance-ink px-3 py-2 t-body-strong text-white hover:bg-finance-blue"
              href={`/budgets?month=${data.nextMonth}`}
            >
              다음 달 예산 만들기 →
            </Link>}
```

- [ ] **Step 3: 남은 채운 초록·파랑 버튼 확인**

Run: `git grep -n "bg-finance-green px\|bg-finance-blue px" -- 'src/**/*.tsx'`
Expected: `src/features/month-close/month-close-control.tsx`의 `월 전체 마감` 한 줄만 나온다. 다른 줄이 나오면 그 파일도 이 태스크에서 같이 검정으로 바꾸고 `git add`에 더한다.

- [ ] **Step 4: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

- [ ] **Step 5: 커밋**

```bash
git add src/app/ledger/page.tsx src/app/budgets/page.tsx
git commit -m "style: one primary button colour outside the month close"
```

---

## Task 4: 예산 머리글의 8.8px 글자

**왜:** 측정으로 예산 화면에 8.8px 글자가 두 줄 있다. 원인은 `<small>`이다. `t-label`이 11px를 주고 브라우저 기본 스타일의 `small { font-size: 0.8em }`이 곱해져 8.8px가 됐다. 타입 스케일 밖이고 읽히지 않는다.

**Files:**
- Modify: `src/features/budgets/plan-list.tsx:120-121`

- [ ] **Step 1: `<small>` 제거** — 120-121행을 다음으로 바꾼다.

```tsx
        <span className="t-label">참고 <span className="font-normal normal-case tracking-normal text-finance-faint">줄을 누르면 그 금액이 예산에 들어갑니다 · 직접 고치면 선택이 풀립니다</span></span>
        <span className="t-label">추이 <span className="font-normal normal-case tracking-normal text-finance-faint">최근 3개월 실제 지출 · 칸에 올리면 거래 목록</span></span>
```

`t-label`의 `font-weight: 600`, 대문자 변환, `letter-spacing: 0.1em`을 설명문에서 되돌려 머리글 낱말과 설명이 구분되게 한다. 크기는 `t-label`의 11px를 상속한다.

- [ ] **Step 2: 10px 미만 글자가 남았는지 측정**

`pnpm dev`를 띄우고 `/tmp/tiny.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
for (const route of ['/', '/ledger', '/budgets', '/assets', '/report', '/inbox', '/recurring', '/manage', '/settings']) {
  await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle' })
  const hits = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('main *')) {
      if (parseFloat(getComputedStyle(el).fontSize) >= 10) continue
      if (!el.textContent?.trim() || !el.getBoundingClientRect().width) continue
      out.push(getComputedStyle(el).fontSize + ' "' + el.textContent.trim().slice(0, 24) + '"')
    }
    return out
  })
  console.log(route + ': ' + (hits.length ? hits.join(' | ') : 'ok'))
}
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/tiny.mjs`
Expected: 아홉 줄 모두 `ok`. 남는 줄이 있으면 그 텍스트를 찾아 같은 방식으로 `<small>`을 `<span className="t-*">`으로 바꾼다.

- [ ] **Step 3: `<small>`이 다른 데 더 있는지**

Run: `git grep -n '<small' -- src`
Expected: 결과 없음.

- [ ] **Step 4: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

- [ ] **Step 5: 커밋**

```bash
git add src/features/budgets/plan-list.tsx
git commit -m "fix(budgets): the UA small tag was shrinking header hints to 8.8px"
```

---

## Task 5: 내역의 직접 입력 폼을 접는다

**왜:** 내역 화면에서 첫 거래 행까지 1,100px를 내려가야 한다. 눈썹·제목·설명·마무리 네 줄·월 상태 줄·월 알약 열둘·정기거래 줄·탭·필터·합계를 지난 뒤 `거래 직접 입력` 폼 전체가 목록 앞을 막고 있다. 자주 쓰는 기능이 아니므로 접는다.

**Files:**
- Modify: `src/features/ledger/transaction-form.tsx:70-91`
- Modify: `tests/e2e/auth.spec.ts:161-163`
- Modify: `tests/e2e/period-sorting-charts.spec.ts:181,184,288`
- Modify: `tests/e2e/parity.spec.ts:233`
- Modify: `tests/e2e/month-close.spec.ts:355`

**Interfaces:**
- `<article>`이 `<details>`가 된다. `id="transaction-form"`은 `src/app/ledger/page.tsx:206`의 감싸는 `<div>`에 그대로 남으므로 기존 셀렉터의 위치는 바뀌지 않는다. 닫힌 `<details>`의 내용은 `display: none`이라 Playwright의 `fill()`이 실패하므로, 폼을 건드리는 E2E는 먼저 `summary`를 눌러야 한다.
- 거래를 수정할 때(`editing !== null`)는 항상 열린 채로 렌더된다.

- [ ] **Step 1: 폼을 `<details>`로** — `src/features/ledger/transaction-form.tsx`의 70-91행. `<article>` 여는 태그부터 머리글 `</div>`까지를 다음으로 바꾼다.

```tsx
  return (
    <details
      className={`mt-6 border-t ${
        editing ? 'border-finance-amber' : 'border-finance-ink'
      }`}
      open={editing !== null || hashRequestedOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between border-b border-finance-border py-4">
        <div>
          <h2 className="t-section text-finance-ink">
            {editing ? '거래 수정' : '거래 직접 입력'}
          </h2>
          <p className="mt-1 t-caption text-finance-muted">
            {editing ? '선택한 거래를 수정하고 있습니다.' : '은행 가져오기 외 거래를 직접 기록합니다.'}
          </p>
        </div>
        {editing
          ? <Link className="t-caption font-semibold text-finance-blue hover:text-finance-ink" href={ledgerUrl(month, filters)}>수정 취소</Link>
          : <span aria-hidden className="t-caption text-finance-muted group-open:rotate-180">열기 ⌄</span>}
      </summary>
```

닫는 태그도 바꾼다. 파일 끝의 `</article>`를 `</details>`로.

- [ ] **Step 2: 해시로 열기** — 같은 파일. `거래 추가` 링크가 `#transaction-form`으로 보내므로 그 경우 열린 채로 나와야 한다. 68행의 `useState` 두 줄 다음에 넣는다.

```tsx
  // The "거래 추가" link on the other tabs jumps to #transaction-form; a closed
  // <details> would swallow it, so open on that hash.
  const [hashRequestedOpen, setHashRequestedOpen] = useState(false)
  useEffect(() => {
    if (window.location.hash === '#transaction-form') setHashRequestedOpen(true)
  }, [])
```

4행의 import를 `import { useActionState, useEffect, useState } from 'react'`로 바꾼다.

- [ ] **Step 3: E2E가 폼을 열도록** — 폼을 건드리는 네 스펙 전부. 아래가 전체 목록이며 빠뜨리면 그 스펙이 타임아웃으로 실패한다.

`tests/e2e/auth.spec.ts` — 161-163행의 `transactionForm` 선언 앞에 한 줄 넣는다.

```ts
    await page.locator('#transaction-form summary').click()
    const transactionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: '거래 추가' }),
    })
```

`tests/e2e/period-sorting-charts.spec.ts` — 181행 앞에 한 줄.

```ts
  await page.locator('#transaction-form summary').click()
  await page.locator('#transaction-form input[name="date"]').fill('2026-07-21')
```

184행은 `toHaveValue`만 하므로 열려 있어야 한다. 182행의 월 알약 클릭이 페이지를 다시 그리므로 184행 앞에도 한 줄 넣는다.

```ts
  await page.locator('#transaction-form summary').click()
  await expect(page.locator('#transaction-form input[name="date"]')).toHaveValue('2026-06-01')
```

288행의 `draft` 선언 다음에 한 줄.

```ts
  const draft = page.locator('#transaction-form')
  await draft.locator('summary').click()
  await draft.locator('input[name="memo"]').fill('대상 수동 추가')
```

`tests/e2e/parity.spec.ts` — 233행 앞에 한 줄.

```ts
    await page.locator('#transaction-form summary').click()
    const draft = page.locator('#transaction-form input[name="memo"]')
```

`tests/e2e/month-close.spec.ts` — 355행 앞에 한 줄.

```ts
  await page.locator('#transaction-form summary').click()
  const draft = page.locator('#transaction-form input[name="memo"]')
```

- [ ] **Step 4: 유닛 테스트가 깨지지 않는지**

`tests/finance/diagnosis-ledger-page.test.ts:55`가 AI 탭에서 `id="transaction-form"`이 **없음**을 확인한다. 그 id는 `ledger/page.tsx:206`의 감싸는 `<div>`에 남고 `tab === 'list'`일 때만 렌더되므로 그대로 통과해야 한다.

Run: `NODE_OPTIONS= pnpm test`
Expected: PASS.

- [ ] **Step 5: 첫 거래 행이 얼마나 올라왔는지 측정**

`pnpm dev`를 띄우고 `/tmp/firstrow.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
await page.goto('http://localhost:3000/ledger?tab=list', { waitUntil: 'networkidle' })
const row = await page.getByRole('row').nth(1).boundingBox()
console.log('첫 거래 행 y = ' + Math.round(row.y + (await page.evaluate(() => window.scrollY))))
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/firstrow.mjs`
Expected: 1,100 아래가 아니라 800 언저리. 폼 높이만큼 줄어든다.

- [ ] **Step 6: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

dev 서버를 죽이고:
Run: `NODE_OPTIONS= pnpm e2e tests/e2e/auth.spec.ts tests/e2e/period-sorting-charts.spec.ts tests/e2e/parity.spec.ts tests/e2e/month-close.spec.ts`
Expected: PASS 전부.

- [ ] **Step 7: 커밋**

```bash
git add src/features/ledger/transaction-form.tsx tests/e2e/auth.spec.ts tests/e2e/period-sorting-charts.spec.ts tests/e2e/parity.spec.ts tests/e2e/month-close.spec.ts
git commit -m "style(ledger): fold the manual entry form so the list starts higher"
```

---

## Task 6: 자산의 두 밴드를 같은 격자로

**왜:** 위아래로 붙은 두 밴드의 네 열이 서로 어긋난다. 측정한 카드 좌측은 KPI 밴드가 48 / 384 / 720 / 1056(간격 336), 비율 밴드가 48 / 390 / 732 / 1074(간격 342)다. 원인은 CSS다. 위 밴드는 `divide-x`로 간격 없이 4등분하고, 아래 밴드는 `gap-6`을 줘 24px 세 칸만큼 좁아진 열을 쓴다. 2·3·4번 열이 각각 6px, 12px, 18px 밀린다.

**Files:**
- Modify: `src/app/assets/page.tsx:90`

- [ ] **Step 1: 아래 밴드에서 gap 제거** — 90행의 `<section>` 여는 태그와 그 안 `<article>` 클래스를 다음으로.

```tsx
        <section className="mt-6 grid border-y border-finance-hairline py-5 sm:grid-cols-2 xl:grid-cols-4">
```

그리고 97행의 `<article className={`border-l-2 pl-4 ${tone}`} key={item.key}>`를:

```tsx
              <article className={`border-l-2 pl-4 pr-6 ${tone}`} key={item.key}>
```

`gap-6`이 만들던 24px 간격을 카드 안쪽 `pr-6`으로 옮긴다. 열 간격이 336으로 위 밴드와 같아지고, 색 막대가 위 밴드의 카드 경계와 같은 x에 선다.

- [ ] **Step 2: 두 밴드의 열이 맞는지 측정**

`pnpm dev`를 띄우고 `/tmp/bands.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
await page.goto('http://localhost:3000/assets', { waitUntil: 'networkidle' })
const bands = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('main section')) {
    const kids = Array.from(el.children).filter(c => c.getBoundingClientRect().width > 100)
    if (kids.length !== 4) continue
    out.push(kids.map(c => Math.round(c.getBoundingClientRect().left)))
  }
  return out
})
console.log(JSON.stringify(bands))
console.log(bands.length === 2 && String(bands[0]) === String(bands[1]) ? '맞음' : '어긋남')
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/bands.mjs`
Expected: `[[48,384,720,1056],[48,384,720,1056]]` 그리고 `맞음`. `어긋남`이 나오면 `gap-6`이 남아 있거나 `sm:grid-cols-2`가 xl에서 이기고 있는 것이다.

- [ ] **Step 3: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add src/app/assets/page.tsx
git commit -m "style(assets): stack the two KPI bands on the same four columns"
```

---

## Task 7: 자산 배분 막대를 합계 기준으로

**왜:** `assets/page.tsx:124`가 막대 폭을 `item.amount / maxComposition`으로 잡는다. 분모가 합계가 아니라 가장 큰 항목이라, 1등 항목은 언제나 꽉 찬 막대로 그려진다. 캡션은 `그룹별 비중`이라고 말하는데 80%인지 100%인지 구분되지 않는다. 실제 데이터에서 저축·투자 226,002,181원과 현금 54,677,597원의 합은 280,679,778원이므로 첫 막대는 80.5%여야 한다.

**Files:**
- Create: `src/features/assets/composition.ts`
- Create: `tests/finance/asset-composition.test.ts`
- Modify: `src/app/assets/page.tsx:53,116-127`

**Interfaces:**
- Produces: `compositionShares<T extends { amount: number }>(rows: T[]): Array<T & { share: number }>` — `share`는 0에서 100 사이의 백분율. 합계가 0 이하면 모든 `share`가 0. 음수 금액은 합계와 자기 몫 모두에서 0으로 본다(부채 계정이 배분 목록에 끼어도 막대가 뒤집히지 않게).

- [ ] **Step 1: 실패하는 테스트** — `tests/finance/asset-composition.test.ts` 신규

```ts
import { expect, test } from 'vitest'

import { compositionShares } from '@/features/assets/composition'

test('share is a percentage of the total, not of the largest row', () => {
  const rows = [{ major: '저축·투자', amount: 226_002_181 }, { major: '현금', amount: 54_677_597 }]
  const shares = compositionShares(rows).map((row) => Number(row.share.toFixed(1)))
  expect(shares).toEqual([80.5, 19.5])
})

test('shares add up to 100 across many rows', () => {
  const rows = [{ amount: 100 }, { amount: 300 }, { amount: 600 }]
  expect(compositionShares(rows).map((row) => row.share)).toEqual([10, 30, 60])
})

test('an empty or non-positive total yields zero shares instead of NaN', () => {
  expect(compositionShares([])).toEqual([])
  expect(compositionShares([{ amount: 0 }, { amount: 0 }]).map((row) => row.share)).toEqual([0, 0])
})

test('negative amounts count as nothing rather than flipping the bar', () => {
  const shares = compositionShares([{ amount: 75 }, { amount: -25 }]).map((row) => row.share)
  expect(shares).toEqual([100, 0])
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/asset-composition.test.ts`
Expected: FAIL — `Cannot find module '@/features/assets/composition'`

- [ ] **Step 3: 구현** — `src/features/assets/composition.ts` 신규

```ts
/**
 * The allocation bars used to divide by the largest row, so the top group was
 * always a full bar and "비중" meant nothing. Divide by the total instead.
 */
export function compositionShares<T extends { amount: number }>(rows: T[]): Array<T & { share: number }> {
  const positive = (amount: number) => (amount > 0 ? amount : 0)
  const total = rows.reduce((sum, row) => sum + positive(row.amount), 0)
  return rows.map((row) => ({ ...row, share: total > 0 ? (positive(row.amount) / total) * 100 : 0 }))
}
```

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/asset-composition.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 화면에 적용** — `src/app/assets/page.tsx`. 53행의 `const maxComposition = data.composition[0]?.amount ?? 1`을 지우고 다음으로 바꾼다.

```tsx
  const composition = compositionShares(data.composition)
```

116-127행의 `{data.composition.map((item) => (` 블록을 다음으로.

```tsx
              {composition.map((item) => (
                <div key={item.major}>
                  <div className="flex items-center justify-between gap-3 t-body">
                    <span className="text-finance-ink">{item.major}</span>
                    <span className="font-medium text-finance-ink">{formatWon(item.amount)}원 <span className="text-finance-muted">{item.share.toFixed(1)}%</span></span>
                  </div>
                  <div className="mt-2 h-[5px] overflow-hidden bg-finance-track">
                    <div className="h-full bg-finance-blue" style={{ width: `${item.share}%` }} />
                  </div>
                </div>
              ))}
              {composition.length === 0 && <p className="py-12 text-center t-body text-finance-muted">입력된 자산이 없습니다.</p>}
```

막대 옆에 퍼센트를 같이 적는다. 막대만으로는 80.5인지 78인지 읽히지 않는다. import에 `import { compositionShares } from '@/features/assets/composition'` 추가.

- [ ] **Step 6: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS.

`pnpm dev`로 `/assets`를 열어 저축·투자 막대가 꽉 차지 않고 `80.5%`가 적히는지 눈으로 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add src/features/assets/composition.ts tests/finance/asset-composition.test.ts src/app/assets/page.tsx
git commit -m "fix(assets): allocation bars are a share of the total, not of the largest row"
```

---

## Task 8: 자산 추이는 순자산 한 선

**왜:** 12개월 축에 점이 두 개(6월·7월)뿐인데 계열 셋과 범례를 얹어 340px를 쓴다. 선이 가운데 짧게 걸치고 위쪽 절반이 빈다. 게다가 총자산 계열은 `borderDash: [5, 4]`로 점선인데 범례 견본(`chart-legend.tsx:16`)은 모든 항목을 단색 사각형으로 그려 서로 맞지 않는다. 선 하나로 줄이면 범례가 필요 없어져 둘 다 사라진다.

**Files:**
- Modify: `src/features/assets/net-worth-chart.tsx:3,7-19,29-33,37-83,85-92`

**Interfaces:**
- Consumes: `TrendPoint { month, assets, debt, netWorth, active }` — 그대로. props는 바꾸지 않는다.

- [ ] **Step 1: 데이터셋을 하나로** — 37-72행의 `chartData` useMemo를 교체

```tsx
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: data.map((row, index) => monthLabel(row.month, index)),
    datasets: [
      {
        label: '순자산',
        data: data.map((row) => row.active ? row.netWorth : null),
        borderColor: palette.green,
        backgroundColor: palette.green,
        borderWidth: CHART_LINE_WIDTH,
        pointRadius: CHART_POINT_RADIUS,
        pointHoverRadius: CHART_POINT_RADIUS_ACTIVE,
        tension: 0.22,
      },
    ],
  }), [data, palette])
```

- [ ] **Step 2: 총자산·부채를 툴팁으로** — 73-83행의 `options` useMemo에서 `tooltip` 줄을 다음으로.

```tsx
      tooltip: {
        ...financeTooltip(palette),
        callbacks: {
          label: wonTooltipLabel,
          afterBody: (items: TooltipItem<'line'>[]) => {
            const row = data[items[0]?.dataIndex ?? -1]
            return row ? [`총자산 ${formatWon(row.assets)}원`, `부채 ${formatWon(row.debt)}원`] : []
          },
        },
      },
```

`useMemo` 의존성을 `[data, palette]`로 바꾼다. 3행의 type import를 `import type { ChartData, ChartOptions, TooltipItem } from 'chart.js'`로, 그리고 `import { formatWon } from '@/lib/finance'`를 추가한다.

- [ ] **Step 3: 범례 제거** — 29-33행의 `LEGEND` 상수를 지우고, 87행의 `<ChartLegend items={LEGEND} />` 줄을 지운다. 18행의 `import { ChartLegend } from '@/features/analytics/chart-legend'`와 19행 import에서 `ROLE`를 지운다(`monthLabel`은 남는다).

```tsx
import { monthLabel } from '@/features/analytics/chart-theme'
```

`return` 문이 이렇게 된다.

```tsx
  return (
    <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
      <Line aria-label="월별 순자산 추이" data={chartData} options={options} role="img" />
    </div>
  )
```

- [ ] **Step 4: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

`pnpm dev`로 `/assets`를 열어 선이 하나이고, 점에 올리면 툴팁에 순자산·총자산·부채 세 줄이 나오는지 확인한다. y축은 `financeScales(palette, { beginAtZero: false })`가 이미 있어 값 범위로 잡히므로 축 코드는 건드리지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add src/features/assets/net-worth-chart.tsx
git commit -m "style(assets): plot net worth alone so the trend is legible"
```

---

## Task 9: 홈 예산 막대 · 예산 없는 행과 빈 달

**왜:** 두 가지가 겹쳐 있다. 첫째, `BudgetBullet`의 `scale`은 `Math.max(actual, budget, 1) * 1.06`이라 예산이 0이고 지출이 있으면 검은 막대가 94%까지 차 초과처럼 읽힌다. 둘째, 이번 달에 지출이 없으면 `0% · 여유`라고 적힌 똑같은 빈 막대가 여섯 줄 깔린다. 9월 초 화면이 늘 이 상태다.

**Files:**
- Modify: `src/app/dashboard/page.tsx:38-56`
- Modify: `src/app/dashboard/page.tsx` (앵커: `<h2 className="t-section text-finance-ink">예산 대비 지출</h2>`가 있는 section)

**Interfaces:**
- Consumes: `BudgetBullet({ major, actual, budget, pacePercent, isFast })` — 시그니처는 바꾸지 않는다.

- [ ] **Step 1: 예산 없는 행은 회색** — 47-50행의 막대 세 줄을 다음으로.

```tsx
      <div className="relative h-[22px] bg-finance-panel">
        {budget > 0 && <span className="absolute inset-y-0 left-0 bg-finance-track" style={{ width: `${paceWidth}%` }} />}
        <span className={`absolute left-0 top-[5px] h-3 ${exceeded ? 'bg-finance-red' : budget > 0 ? 'bg-finance-ink' : 'bg-finance-faint'}`} style={{ width: `${actualPercent}%` }} />
        {budget > 0 && <span className="absolute -top-[3px] h-7 w-0.5 bg-finance-ink" style={{ left: `${budgetPercent}%` }} />}
      </div>
```

예산이 없으면 페이스 트랙도 예산 세로선도 그리지 않는다. 비교할 기준이 없는데 기준선을 그리면 거짓말이다.

- [ ] **Step 2: 빈 달은 한 줄로** — `예산 대비 지출` section 안에서 `BudgetBullet`을 그리는 `.map(...)` 호출을 찾아, 그 앞에 합계를 계산하고 분기한다. `budgetRows`는 그 map이 도는 배열 이름으로 바꾼다.

```tsx
          {budgetRows.every((row) => row.actual === 0) ? (
            <p className="mt-5 grid min-h-16 place-items-center border-y border-finance-border t-body text-finance-muted">
              이번 달 지출이 아직 없습니다 · 대분류 예산 {formatWon(budgetTotal)}원
            </p>
          ) : (
            <div className="mt-5 grid gap-2.5">
              {budgetRows.map((row) => <BudgetBullet key={row.major} {...row} />)}
            </div>
          )}
```

기존 map이 감싸던 컨테이너 클래스와 `BudgetBullet`에 넘기던 props는 그대로 옮긴다. `budgetTotal`은 그 section의 캡션이 이미 쓰고 있는 `대분류 예산 합계` 값을 재사용한다. 이름이 다르면 그 이름을 쓴다.

- [ ] **Step 3: 카테고리별 추세 빈 상자 줄이기** — 194행의 빈 상태를 다음으로. 200px 상자 안에 한 문장만 있어 화면이 비어 보인다.

```tsx
            <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">이번 달 카테고리 지출이 없습니다.</p>
```

- [ ] **Step 4: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

`pnpm dev`로 `/`를 열어 지출이 없는 달에 빈 막대 여섯 줄 대신 한 줄이 나오는지 확인한다. 지출이 있는 달을 보려면 `/ledger`에서 과거 달로 이동해 데이터가 있는 달을 확인한 뒤, 홈은 항상 이번 달만 그리므로 예산 없는 행의 회색 막대는 `budget === 0`인 대분류가 있는 달에서만 보인다. 없으면 이 확인은 건너뛰고 Step 1의 코드 검토로 갈음한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/dashboard/page.tsx
git commit -m "style(home): grey bar without a budget, one line for an empty month"
```

---

## Task 10: 홈의 두 차트를 같은 선에 맞춘다

**왜:** 제목은 둘 다 y=1088로 맞는데 그림 영역은 왼쪽 y=1178, 오른쪽 y=1144로 34px 어긋난다. 원인 둘이다. 감싸는 `div`가 왼쪽 `mt-5`, 오른쪽 `mt-4`로 4px 다르고, 왼쪽 차트에만 범례 한 줄이 있어 30px를 더 먹는다. 게다가 두 차트가 똑같이 1월부터 12월을 그리는데 격자가 `1.35fr` 대 `0.8fr`이라 폭이 819px와 444px다. 같은 5월이 화면의 다른 x에 선다.

**Files:**
- Modify: `src/app/dashboard/page.tsx:198,202,207`
- Modify: `src/features/analytics/home-trend-charts.tsx` (앵커: `SavingsRateChart`의 `return`)

- [ ] **Step 1: 격자를 반반으로** — 198행을 다음으로.

```tsx
        <section className="grid gap-10 py-7 xl:grid-cols-2">
```

두 차트가 같은 폭이 되어 월 눈금이 세로로 맞는다.

- [ ] **Step 2: 위쪽 여백 통일** — 207행의 `<div className="mt-4 min-w-0">`를 `<div className="mt-5 min-w-0">`로. 202행은 이미 `mt-5`라 그대로 둔다.

- [ ] **Step 3: 오른쪽 차트에도 범례** — `src/features/analytics/home-trend-charts.tsx`의 `SavingsRateChart` 컴포넌트. 76행의 `<div className="relative w-full" style={{ height: CHART_HEIGHT }}>`를 감싸 다음으로 바꾼다.

```tsx
    <div>
      <ChartLegend items={[{ name: '저축률', color: palette.green }, { name: `목표 ${formatRate(target)}%`, color: palette.faint }]} />
      <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
```

닫는 태그도 `</div>` 하나를 더한다. import에 `import { ChartLegend } from '@/features/analytics/chart-legend'`를 추가하고, `formatRate`가 이미 import돼 있지 않으면 `@/lib/finance`에서 가져온다. `palette`와 `target`은 그 컴포넌트가 이미 갖고 있는 값이며, 이름이 다르면 그 이름을 쓴다.

왼쪽 차트의 범례를 지우는 대신 오른쪽에 붙인다. 오른쪽 차트는 실선과 점선 목표선 둘을 그리므로 범례가 원래 필요했다.

- [ ] **Step 4: 두 캔버스가 맞는지 측정**

`pnpm dev`를 띄우고 `/tmp/homecharts.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' })
const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('main canvas'))
  .map(c => { const r = c.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width) } }))
console.log(JSON.stringify(boxes))
const [a, c] = boxes.slice(-2)
console.log(a.top === c.top ? '윗선 맞음' : `윗선 ${Math.abs(a.top - c.top)}px 어긋남`)
console.log(Math.abs(a.w - c.w) <= 2 ? '폭 맞음' : `폭 ${Math.abs(a.w - c.w)}px 차이`)
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/homecharts.mjs`
Expected: `윗선 맞음`과 `폭 맞음`. 윗선이 어긋나면 Step 2나 3이 덜 된 것이고, 폭이 다르면 Step 1이 안 먹은 것이다.

- [ ] **Step 5: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/page.tsx src/features/analytics/home-trend-charts.tsx
git commit -m "style(home): align the two trend charts on one baseline and width"
```

---

## Task 11: 잠정 막대를 회색 빗금 대신 반투명 색으로

**왜:** 지금은 마감하지 않은 달의 막대를 회색 대각선 빗금으로 그린다. 모든 달이 미마감인 현재 상태에서는 항목별 색이 통째로 사라져, "색 = 항목 비중"이라는 안내 문장이 화면에서 거짓이 된다. 사용자가 2026-09-14에 "빗금보다 투명도 높은 색이 낫다"고 결정했다. `chart-js.ts:150`의 `alpha(color, opacity)`가 이미 있고 `series-chart.tsx:170`이 흐린 계열에 쓰고 있으므로 같은 함수를 쓴다.

**Files:**
- Modify: `src/features/analytics/chart-js.ts:255-271`
- Modify: `src/features/analytics/series-chart.tsx:154,170`
- Modify: `src/features/analytics/annual-flow-overview.tsx:60,65`

**Interfaces:**
- Consumes: `alpha(color: string, opacity: number): string` (`chart-js.ts:150`) — 이미 있다.
- Removes: `provisionalPattern(palette)` — 호출부 두 곳이 사라진 뒤 함수도 지운다. `PROVISIONAL_DASH`는 선 차트가 따로 쓰므로 남긴다.

- [ ] **Step 1: series-chart** — 154행의 `const hatch = provisionalPattern(palette)`를 지우고, 170행의 `backgroundColor`를 다음으로.

```tsx
          backgroundColor: values.map((_, month) => alpha(color, provisional(month) ? (dimmed ? 0.10 : 0.34) : (dimmed ? 0.16 : 1))),
```

`borderColor`(171행)의 `provisional(month) ? palette.faint : palette.background`는 그대로 둔다. 옅어진 채움에 옅은 테두리가 남아야 잠정이라는 것이 읽힌다. import에서 `provisionalPattern`을 지우고 `alpha`가 없으면 더한다.

- [ ] **Step 2: annual-flow-overview** — 60행의 `const hatch = provisionalPattern(palette)`를 지우고, 65행을 다음으로.

```tsx
        backgroundColor: monthly.map(row => row.state === 'closed' ? color : alpha(color, 0.34)),
```

66행의 `borderColor`는 그대로 둔다. import에서 `provisionalPattern`을 지우고 `alpha`를 더한다.

- [ ] **Step 3: 패턴 함수 삭제** — `src/features/analytics/chart-js.ts`의 255-271행, 주석 `/** A repeating diagonal hatch; … */`부터 `provisionalPattern` 함수 끝까지를 지운다. 253행의 `export const PROVISIONAL_DASH = [5, 4]`는 남긴다.

- [ ] **Step 4: 남은 참조 확인**

Run: `git grep -n "provisionalPattern" -- src`
Expected: 결과 없음.

- [ ] **Step 5: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS.

`pnpm dev`로 `/report`를 열어 `달마다 어떻게 달랐나`의 누적 막대가 회색 빗금이 아니라 항목 색의 옅은 버전으로 나오는지, 그리고 마감된 달과 구분되는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/analytics/chart-js.ts src/features/analytics/series-chart.tsx src/features/analytics/annual-flow-overview.tsx
git commit -m "style(charts): provisional months keep their colour at low opacity"
```

---

## Task 12: 통계의 잠정 배지 하나로, 안내 문장 하나로, 누적 막대에 범례

**왜:** 세 가지가 한 화면에 있다. `StatusTag`가 `report/page.tsx`에서 10곳에 쓰이고 그중 둘(177-178행, 212-213행)은 제목과 바로 아랫줄에 잇달아 나온다. 실제로 한 페이지에 열둘 남짓 그려진다. 같은 사실을 열두 번 말한다. 안내 문장은 `달마다 어떻게 달랐나` 제목 아래 한 줄, `chartHint` 한 줄, `그래프를 클릭해 상세 항목 선택` 한 줄이 겹친다. 그리고 누적 막대에는 범례가 없어 어느 색이 어느 항목인지 표를 봐야 안다.

**Files:**
- Modify: `src/app/report/page.tsx:134,152,177-178,212-213,265`
- Modify: `src/features/analytics/stats-monthly-section.tsx:451-456,462,558-561`

**Interfaces:**
- Consumes: `ChartLegend({ items: { name, color }[] })` (`chart-legend.tsx:11`), `resolveChartColor(color, palette)`와 `useFinanceChartPalette()` (`chart-js.ts`), `model.series[].{ id, label, color }` (stats-monthly-section 안에 이미 있다).
- `StatusTag`는 남는다. 전년 비교처럼 페이지 기준과 다른 데이터셋을 가리키는 자리에서는 계속 쓴다.

- [ ] **Step 1: 페이지 머리에 잠정 안내 한 줄** — `src/app/report/page.tsx`. 제목 `<h1>`이 있는 header 블록 바로 다음에 넣는다.

```tsx
        {dataIsProvisional && (
          <p className="mt-4 border-l-2 border-finance-amber py-2 pl-3 t-caption text-finance-muted">
            마감된 달이 없어 이 페이지의 모든 값은 마감 전 내역을 포함한 <strong className="text-finance-ink">잠정</strong>입니다. 전년 비교만 따로 표시합니다.
          </p>
        )}
```

- [ ] **Step 2: 페이지 기준 배지 여섯 개 제거** — 아래 여섯 자리의 `<StatusTag provisional={dataIsProvisional} … />`와 홀로 선 `<StatusTag provisional reason={comparisonReason} />` 두 줄을 지운다. 페이지 머리 안내가 같은 말을 하므로 중복이다.

134행: `<p className="t-label text-finance-muted">올해 순저축률<StatusTag provisional={dataIsProvisional} reason={dataIsProvisional ? '마감 0개월' : undefined} /></p>` → `<p className="t-label text-finance-muted">올해 순저축률</p>`

152행: `<p className="t-label text-finance-muted">{item.label}<StatusTag … /></p>` → `<p className="t-label text-finance-muted">{item.label}</p>`

177행: `어디에 썼나<StatusTag provisional={dataIsProvisional} reason="마감 0개월" />` → `어디에 썼나`

178행: `{comparison.hasPrevious && comparisonIsProvisional && <StatusTag provisional reason={comparisonReason} />}` 줄 전체 삭제

212행: `가맹점 TOP<StatusTag provisional={dataIsProvisional} reason="마감 0개월" />` → `가맹점 TOP`

213행: `{comparison.hasPrevious && comparisonIsProvisional && <StatusTag provisional reason={comparisonReason} />}` 줄 전체 삭제

265행: `앞으로 6개월<StatusTag provisional={forecastIsProvisional} reason="마감 0개월" />` → `앞으로 6개월`

139행·155행·240행의 `StatusTag`는 **남긴다**. 전년 비교라는 다른 데이터셋의 기준을 말하므로 페이지 안내로 대체되지 않는다.

- [ ] **Step 3: 남은 개수 확인**

Run: `git grep -c "StatusTag" -- src/app/report/page.tsx`
Expected: `4` (정의 1 + 호출 3).

- [ ] **Step 4: 안내 문장 하나로** — `src/features/analytics/stats-monthly-section.tsx`. 462행을 줄인다.

```tsx
          <p className="mt-1 t-caption text-finance-faint">그래프나 표의 항목을 클릭하면 상세 · 셀 클릭은 합계에서 제외</p>
```

558-561행의 `chartHint`를 그리는 `div`를 통째로 지운다.

```tsx
              <div className="col-span-3 self-end pb-1 t-caption text-finance-muted">
                <p>{chartHint}</p>
                <p className="mt-1 font-semibold text-finance-ink">그래프를 클릭해 상세 항목 선택</p>
              </div>
```

451-456행의 `const chartHint = …` 상수도 지운다. 쓰이는 곳이 없어진다.

- [ ] **Step 5: 누적 막대 범례** — 같은 파일. Step 4에서 지운 `div`가 있던 grid의 다음 행에 넣는다. `GRID_COLUMNS`는 `'150px repeat(12, minmax(0, 1fr)) 110px 95px 90px'` 16열이므로, 축 칸을 비우고 열두 달 폭에 맞춘다.

```tsx
              <div className="col-span-12 col-start-2 pt-2">
                <ChartLegend items={model.series.map((item) => ({ name: item.label, color: resolveChartColor(item.color, palette) }))} />
              </div>
```

import에 `import { ChartLegend } from './chart-legend'`를 더하고, `resolveChartColor`와 `useFinanceChartPalette`가 `./chart-js`에서 이미 들어와 있지 않으면 더한다. 컴포넌트 상단에 `const palette = useFinanceChartPalette()`가 없으면 추가한다. 항목이 여덟을 넘으면 `ChartLegend`의 `flex-wrap`이 두 줄로 접는다.

표 아래 각주(마감 기준을 설명하는 문장)와 빈 상태 박스(`그래프에서 확인할 항목을 선택하세요.`)는 남긴다. 각각 데이터 규칙과 선택 전 자리 채움이라 필요하다.

- [ ] **Step 6: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS.

`pnpm dev`로 `/report`를 열어 `잠정` 배지가 페이지 머리 한 줄과 전년 비교 자리에만 남았는지, 누적 막대 아래 범례가 표의 색 견본과 같은 색인지 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add src/app/report/page.tsx src/features/analytics/stats-monthly-section.tsx
git commit -m "style(stats): one provisional notice, one hint, a legend for the stacked chart"
```

---

## Task 13: 가져오기 다섯 가지

**왜:** 한 화면에 다섯 가지가 겹친다. 월 그룹 행이 검은 띠로 칠해져 표 안에서 제일 무겁고, `분류 확인`과 `확인 대기 133건` 두 제목 아래 거의 같은 문장이 둘 있고, 건수가 빨강이라 오류처럼 읽히고, 채운 초록 버튼이 위아래로 두 번 나오고, 파일 선택 버튼이 브라우저 기본 영어(`Choose Files / No file chosen`)다. 모바일에서는 `미분류 거래` 탭이 잘린다.

**Files:**
- Modify: `src/features/inbox/inbox-review-month-group.tsx:42-66`
- Modify: `src/features/inbox/inbox-review-form.tsx:249`
- Modify: `src/features/inbox/inbox-review-shared.tsx:77`
- Modify: `src/features/inbox/inbox-review-item-row.tsx:198`
- Modify: `src/app/inbox/page.tsx:63-66`
- Modify: `src/features/inbox/upload-form.tsx:50-62,183-200`
- Modify: `src/features/inbox/inbox-tabs.tsx` (앵커: `{item.label}{item.count !== undefined &&`)

- [ ] **Step 1: 월 그룹 헤더** — `inbox-review-month-group.tsx` 42행부터의 `<tr>`를 다음으로.

```tsx
        <tr className="bg-finance-panel">
          <th className="p-0" colSpan={8}>
            <div className="flex min-h-12 items-center gap-3 px-4 py-2.5">
```

그 안의 `text-finance-faint` 세 곳(▸ 아이콘, 건수 배지, 우측 요약)을 `text-finance-muted`로. 건수 배지의 `bg-white/10 px-2 py-0.5 text-[10px] font-semibold`를 `border border-finance-hairline px-2 py-0.5 t-label`로. `<span className="font-bold">`을 `<span className="t-body-strong text-finance-ink">`로. 포커스 링 `focus-visible:ring-white`를 `focus-visible:ring-finance-blue`로. `<tbody className="border-t border-finance-ink first:border-t-0">`는 그대로 둔다. 월 경계는 검은 헤어라인으로 남긴다.

- [ ] **Step 2: 중복 제목 제거** — `src/app/inbox/page.tsx` 63-66행에서 `분류 확인` 제목 블록을 지운다. 바로 아래 `InboxReviewForm`이 `확인 대기 N건` 제목을 이미 그린다.

```tsx
          <section className="mt-6">
            {data.truncated && <p className="mb-3 border-l-2 border-finance-amber py-2 pl-3 t-body text-finance-muted">대기 거래가 많아 최근 500건만 표시합니다. 먼저 반영하거나 제외하면 나머지가 이어서 표시됩니다.</p>}
            <InboxReviewForm accounts={data.accounts} categories={data.categories} highItems={data.highItems} reviewItems={data.reviewItems} />
          </section>
```

- [ ] **Step 3: 남은 제목에 설명을 옮기고 건수 색을 뺀다** — `inbox-review-form.tsx` 249행을 다음으로. Step 2에서 지운 설명 문장이 여기로 온다.

```tsx
            <div className="border-t border-finance-ink pt-4">
              <h3 className="t-section text-finance-ink">확인 대기 <span className="text-finance-muted">{items.length}건</span></h3>
              <p className="mt-1 t-caption text-finance-muted">자동 분류를 포함한 모든 거래를 수정할 수 있습니다. 한 건씩 반영하거나 그룹을 선택해 한 번에 처리하세요.</p>
            </div>
```

기존 249행이 감싸여 있던 요소와 형제 관계가 맞는지 확인하고, 감싸는 `div`가 이미 있으면 중복해서 만들지 않는다.

- [ ] **Step 4: 버튼** — `inbox-review-shared.tsx` 77행의 클래스를 다음으로.

```tsx
        className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:bg-finance-blue disabled:opacity-40"
```

`inbox-review-item-row.tsx` 198행의 클래스를 다음으로. 행 안의 보조 동작이라 테두리형으로 둔다.

```tsx
          className="inline-flex h-[30px] w-full items-center justify-center gap-1 border border-finance-ink bg-white px-2 t-caption font-semibold text-finance-ink hover:bg-finance-ink hover:text-white disabled:cursor-wait disabled:opacity-40"
```

- [ ] **Step 5: 뱅크샐러드 파일 선택** — `upload-form.tsx`. 브라우저 기본 파일 입력은 `file:` 가상 요소로 글자를 바꿀 수 없다. 입력을 `sr-only`로 숨기고 우리 글자를 그린다. 컴포넌트에 `const [fileNames, setFileNames] = useState<string[]>([])`를 더하고, 44-46행의 초기화(`if (files) files.value = ''`) 옆에 `setFileNames([])`를 넣는다. 50-62행의 `<label>` 내용을 다음으로.

```tsx
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        DJ·YJ 뱅크샐러드 파일
        <span className="flex h-[34px] items-stretch border border-dashed border-finance-border bg-white focus-within:border-finance-blue">
          <span className="flex items-center bg-finance-track px-3 t-body font-semibold normal-case tracking-normal text-finance-ink">파일 선택</span>
          <span className="flex min-w-0 flex-1 items-center truncate px-3 t-body font-normal normal-case tracking-normal text-finance-muted">{fileNames.length > 0 ? fileNames.join(', ') : '선택된 파일 없음'}</span>
        </span>
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={controller.isProcessing}
          multiple
          name="files"
          onChange={(event) => setFileNames(Array.from(event.target.files ?? []).map((file) => file.name))}
          required
          type="file"
        />
        <span className="font-normal normal-case tracking-normal text-finance-faint">.xlsx · 최대 2개 · 파일당 2MB</span>
      </label>
```

- [ ] **Step 6: 카드 파일 선택** — 같은 파일 183-200행의 `<label>`도 같은 꼴로 바꾼다. 이미 있는 `fileName` 상태를 표시에 쓴다(`{fileName || '선택된 파일 없음'}`), `className`을 `sr-only`로, 기존 `onChange`는 유지한다. `setInputFiles`를 쓰는 E2E(`parity.spec.ts`, `import-progress.spec.ts`)는 `input[name="files"]` / `input[name="file"]`을 직접 찾으므로 `sr-only`여도 동작한다.

- [ ] **Step 7: 모바일 탭 라벨** — `inbox-tabs.tsx`의 링크 안 `{item.label}`을 다음으로. 390px에서 네 번째 탭이 `미분류 거`로 잘린다.

```tsx
          {item.key === 'unclassified' ? <><span className="sm:hidden">미분류</span><span className="hidden sm:inline">미분류 거래</span></> : item.label}
```

`app-tab` 클래스(Task 2)의 좌우 여백 16px은 그대로 두고 라벨만 줄인다.

- [ ] **Step 8: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && git grep -n 'file:mr-3' -- src && git grep -n 'bg-finance-green px' -- src/features/inbox`
Expected: 0 errors, 두 grep 모두 결과 없음(`git grep`이 못 찾으면 exit 1이므로 `&&` 체인이 거기서 멈춘다. 멈추면 성공이다).

dev 서버를 죽이고:
Run: `NODE_OPTIONS= pnpm e2e tests/e2e/parity.spec.ts tests/e2e/import-progress.spec.ts`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add src/features/inbox/inbox-review-month-group.tsx src/features/inbox/inbox-review-form.tsx src/features/inbox/inbox-review-shared.tsx src/features/inbox/inbox-review-item-row.tsx src/app/inbox/page.tsx src/features/inbox/upload-form.tsx src/features/inbox/inbox-tabs.tsx
git commit -m "style(inbox): hairline month groups, one heading, a Korean file picker"
```

---

## Task 14: 정기거래 후보는 달에 한 번, 비슷한 날, 비슷한 금액

**왜:** 정기거래 화면이 5,229px다. 규칙이 스물다섯 개나 올라와 있는데, 후보 판정이 "석 달 이상 등장"과 "발생 건수 ≤ 월 수 × 1.8"만 본다. 한 달에 두 번 가는 가게도 고정비 후보가 된다.

**Files:**
- Modify: `src/features/recurring/calculations.ts:34-62`
- Test: `tests/finance/recurring.test.ts`

**Interfaces:**
- Produces: `detectRecurringCandidates(rows, knownNames = [], minimumMonths = 3, options: RecurringDetectionOptions = { maxDaySpread: 4, maxVariation: 0.35 })`
- Produces: `export type RecurringDetectionOptions = { maxDaySpread: number; maxVariation: number }`
- 세 조건을 모두 만족해야 후보다. **달에 한 번**(발생 건수 ≤ 월 수 × 1.2, 기존 1.8을 조인다), **비슷한 날**(결제일 표준편차 ≤ `maxDaySpread`일), **비슷한 금액**(변동계수 ≤ `maxVariation`). 금액만 보면 관리비·전기요금처럼 계절 따라 20~30% 흔들리는 진짜 고정비가 빠지고, 날짜·빈도만 보면 매달 한 번 가는 미용실이 들어온다. 셋을 같이 본다.
- 기존 호출부 `src/features/recurring/queries.ts`는 인자 둘만 넘기므로 기본값으로 동작한다.

- [ ] **Step 1: 실패하는 테스트** — `tests/finance/recurring.test.ts`의 첫 테스트 뒤에 추가

```ts
  test('keeps once-a-month same-day bills, seasonal swing included, and drops scattered habits', () => {
    const rows = [
      { date: '2026-01-25', amount: 200_000, merchant: '관리비' },
      { date: '2026-02-25', amount: 262_000, merchant: '관리비' },
      { date: '2026-03-26', amount: 231_000, merchant: '관리비' },
      { date: '2026-01-03', amount: 30_000, merchant: '버거킹 강남' },
      { date: '2026-01-19', amount: 12_000, merchant: '버거킹 강남' },
      { date: '2026-02-11', amount: 60_000, merchant: '버거킹 강남' },
      { date: '2026-03-27', amount: 45_000, merchant: '버거킹 강남' },
      { date: '2026-01-02', amount: 38_000, merchant: '헤어살롱' },
      { date: '2026-02-21', amount: 38_000, merchant: '헤어살롱' },
      { date: '2026-03-13', amount: 38_000, merchant: '헤어살롱' },
    ]
    expect(detectRecurringCandidates(rows).map((candidate) => candidate.name)).toEqual(['관리비'])
    expect(detectRecurringCandidates(rows, [], 3, { maxDaySpread: 31, maxVariation: 1 }).map((candidate) => candidate.name)).toEqual(['관리비', '헤어살롱'])
  })
```

관리비는 금액이 ±13% 흔들려도 25~26일에 한 번이라 남고, 버거킹은 달에 두 번씩 아무 날에 오니 빠지고, 헤어살롱은 금액이 같아도 날짜가 흩어져 빠진다. 둘째 줄은 날짜·금액 조건을 풀면 헤어살롱만 살아나고 버거킹은 빈도 조건에 걸려 여전히 빠짐을 확인한다.

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/recurring.test.ts`
Expected: FAIL — 첫 기대값에 `'헤어살롱'`이 포함됨

- [ ] **Step 3: 구현** — `src/features/recurring/calculations.ts`. 34행의 `export function detectRecurringCandidates(` 앞에 타입과 헬퍼를 넣고 시그니처를 바꾼다.

```ts
export type RecurringDetectionOptions = { maxDaySpread: number; maxVariation: number }

const DEFAULT_DETECTION: RecurringDetectionOptions = { maxDaySpread: 4, maxVariation: 0.35 }

function spread(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { mean, deviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }
}

export function detectRecurringCandidates(
  rows: RecurringCandidateRow[],
  knownNames: string[] = [],
  minimumMonths = 3,
  options: RecurringDetectionOptions = DEFAULT_DETECTION,
) {
```

루프 안의 `if (occurrences.length > months.length * 1.8) continue`를 다음으로 바꾼다.

```ts
    // A bill posts once a month; a habit posts whenever. Two a month is a habit.
    if (occurrences.length > months.length * 1.2) continue
```

`if (monthlyGaps < minimumMonths - 1) continue` 다음에 넣는다.

```ts
    // Bills land on the same day and cost about the same. Utilities swing with
    // the season, so the amount test is loose and the day test does the work.
    const day = spread(occurrences.map((row) => Number(row.date.slice(8, 10))))
    if (day.deviation > options.maxDaySpread) continue
    const amount = spread(occurrences.map((row) => row.amount))
    if (amount.mean <= 0 || amount.deviation / amount.mean > options.maxVariation) continue
```

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit tests/finance/recurring.test.ts`
Expected: PASS. 기존 첫 테스트의 넷플릭스(매달 10일, 10,000·11,000·12,000)는 세 조건을 모두 만족해 그대로 통과한다.

- [ ] **Step 5: 화면이 얼마나 짧아졌는지**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS.

`pnpm dev`로 `/recurring`을 열어 후보 목록이 줄었는지 확인한다. 확정된 규칙 자체는 이 태스크가 건드리지 않으므로 페이지 높이가 크게 줄지 않을 수 있다. 그 경우 후보 개수만 기록하고 넘어간다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/recurring/calculations.ts tests/finance/recurring.test.ts
git commit -m "feat(recurring): candidates must post once a month, on a steady day, at a steady amount"
```

---

## Task 15: 차트의 가로 애니메이션 끄기

**왜:** Chart.js는 새 요소의 x를 0에서 시작해 애니메이션한다. 차가운 첫 페인트에서 모든 막대가 왼쪽에서 쓸려 들어온다. 막대와 점은 세로로만 움직이면 된다.

**Files:**
- Modify: `src/features/analytics/chart-js.ts` (앵커: `export const CHART_ANIMATION = { duration: 400 }`)
- Modify: `src/features/assets/net-worth-chart.tsx:76`
- Modify: `src/features/analytics/flow-trend-chart.tsx:46`
- Modify: `src/features/analytics/annual-flow-overview.tsx:75,137`
- Modify: `src/features/analytics/account-monthly-chart.tsx:48`
- Modify: `src/features/analytics/monthly-cashflow-chart.tsx:43`
- Modify: `src/features/analytics/category-monthly-chart.tsx:69`
- Modify: `src/features/analytics/home-trend-charts.tsx:61`
- Modify: `src/features/analytics/series-chart.tsx:215`

**Interfaces:**
- Produces: `export const CHART_ANIMATIONS = { x: { duration: 0 } }` — Chart.js의 `animations` 옵션(복수형)이며 `animation`(단수)과 별개다. 둘 다 넘긴다.

- [ ] **Step 1: 상수** — `chart-js.ts:44`의 `export const CHART_ANIMATION = { duration: 400 }` 아래에 넣는다.

```ts
/**
 * Chart.js animates a new element's x from 0, so a cold first paint sweeps
 * every bar in from the left. Bars and points only ever move vertically.
 */
export const CHART_ANIMATIONS = { x: { duration: 0 } }
```

- [ ] **Step 2: 여덟 곳에 적용** — 위 Files에 적은 `animation: CHART_ANIMATION,` 여덟 줄 각각의 바로 다음 줄에 넣고, 각 파일의 `@/features/analytics/chart-js` import에 `CHART_ANIMATIONS`를 더한다.

```ts
    animations: CHART_ANIMATIONS,
```

`annual-flow-overview.tsx`는 75행과 137행 두 군데다. 한 곳만 고치지 않는다.

- [ ] **Step 3: series-chart** — `series-chart.tsx:215`의 `animation: { duration: 300 },` 다음 줄에 같은 줄을 넣고 import에 `CHART_ANIMATIONS`를 더한다.

- [ ] **Step 4: 아홉 곳 다 됐는지 확인**

Run: `git grep -c "animations: CHART_ANIMATIONS" -- src | awk -F: '{ sum += $2 } END { print "총", sum }'`
Expected: `총 9`. 8이 나오면 `annual-flow-overview.tsx`의 둘째 옵션을 빠뜨린 것이다.

- [ ] **Step 5: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`
Expected: 0 errors.

`pnpm dev`로 `/report`를 개발자 도구의 Disable cache를 켠 채 새로고침해 막대가 왼쪽에서 쓸려 들어오지 않는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/analytics/chart-js.ts src/features/analytics/account-monthly-chart.tsx src/features/analytics/annual-flow-overview.tsx src/features/analytics/category-monthly-chart.tsx src/features/analytics/flow-trend-chart.tsx src/features/analytics/home-trend-charts.tsx src/features/analytics/monthly-cashflow-chart.tsx src/features/analytics/series-chart.tsx src/features/assets/net-worth-chart.tsx
git commit -m "fix(charts): animate bars vertically only"
```

---

## 마지막 확인

모든 태스크가 끝난 뒤 한 번 돌린다.

- [ ] **전체 검사**

dev 서버를 죽이고:

```bash
NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm build
```

Expected: 0 errors, 유닛 PASS, 빌드 성공.

```bash
NODE_OPTIONS= pnpm e2e
```

Expected: 전부 PASS.

- [ ] **정렬 재측정** — Task 1·2·4·6·10의 측정 스크립트를 한 번씩 다시 돌려 숫자가 그대로인지 본다. 나중 태스크가 앞 태스크의 결과를 되돌리지 않았는지 확인하는 절차다.

---

## 선행 플랜 처리

`docs/superpowers/plans/2026-09-10-ui-polish.md`의 12개 태스크를 이 플랜이 어떻게 처리하는지.

| 선행 태스크 | 이 플랜 |
| --- | --- |
| 1 `formatWonCompact`와 자산 KPI 억·만 | 버림. 사용자가 숫자 그대로를 선택 |
| 2 자산 추이 순자산 한 선 | Task 8 |
| 3 내역 표 칩 → 글자 | 버림. 사용자가 빨간 칩 유지를 선택 |
| 4 예산 진행 막대 검정 | 버림. 예산 편집기 개편으로 막대가 사라짐 |
| 5 가져오기 검은 띠·건수·버튼 | Task 13 |
| 6 정기거래 후보 조건 | Task 14 |
| 6-1 한국어 파일 선택 | Task 13 |
| 6-2 모바일 탭 잘림 | Task 13 |
| 7 주 버튼 검정 | Task 3 |
| 8 연 KPI 억·만 / 범례 / 안내 문장 | 억·만은 버림, 범례와 안내 문장은 Task 12 |
| 9 홈 예산 없는 행 회색 막대 | Task 9 |
| 10 차트 x 애니메이션 | Task 15 |

이 플랜이 새로 더한 것: Task 1(월 네비), Task 2(탭 높이), Task 4(8.8px), Task 5(입력 폼 접기), Task 6(자산 두 밴드), Task 7(배분 막대 분모), Task 10(홈 두 차트), Task 11(잠정 막대 반투명), Task 12의 잠정 배지 부분, Task 9의 빈 달 부분.

이 플랜을 main에 넣은 뒤 `docs/superpowers/plans/2026-09-10-ui-polish.md`를 지운다. 남겨 두면 다음 세션이 억·만 표기와 칩 제거를 다시 실행한다.

---

## Self-Review

**1. 근거 대비 태스크 커버리지**

2026-09-14 점검에서 나온 항목과 태스크 대응.

- 측정된 정렬 다섯: 자산 두 밴드 → Task 6. 월 네비 크기 → Task 1. 탭 높이 → Task 2. 8.8px → Task 4. 홈 두 차트 → Task 10. 전부 있다.
- 코드로 확인된 둘: 배분 막대 분모 → Task 7. 점선 대 단색 범례 → Task 8(범례를 없애서 해소).
- 화면으로 본 것: 홈 상단 밴드의 왼쪽이 링 때문에 아래로 내려간 것 → **태스크 없음**. 도넛 링과 오른쪽 KPI를 한 밴드로 맞추려면 링의 세로 정렬이나 밴드 구조를 바꿔야 하는데, 측정 없이 markup만 보고 고칠 수 있는 종류가 아니다. 다음 점검으로 넘긴다.
- 사용자 결정 넷: 빨간색 유지 → Global Constraints에 명시. 토글 → Task 5. 숫자 그대로 → Global Constraints에 명시. 반투명 색 → Task 11.
- 일곱 묶음 나머지: 통계 배지 반복 → Task 12. 정기거래 → Task 14(행 접기는 범위 밖으로 명시). 가져오기 → Task 13. 전역 버튼 색 → Task 3. 차트 애니메이션 → Task 15. 홈 예산 막대 → Task 9.

**2. 플레이스홀더 점검**

"적절히", "필요하면", "TBD" 없음. 코드가 필요한 단계마다 코드 블록이 있다. 다만 세 곳에 조건부 지시가 있다.
- Task 9 Step 2의 `budgetRows` / `budgetTotal`: 실제 변수명이 다를 수 있어 "이름이 다르면 그 이름을 쓴다"로 적었다. 그 map은 `dashboard/page.tsx`의 `예산 대비 지출` section 안에 하나뿐이라 찾는 데 모호함이 없다.
- Task 10 Step 3의 `palette` / `target`: `SavingsRateChart` 안에 이미 있는 값이며 같은 이유로 조건부로 적었다.
- Task 12 Step 5의 `palette` 선언: 이미 있으면 더하지 않는다.
이 셋은 "무엇을 할지 안 적음"이 아니라 "그 파일의 지역 변수명을 확인하라"이므로 플랜 실패가 아니다.

**3. 타입 일관성**

- `MonthNav({ action, label, month, previousHref, nextHref, max, hidden })` — Task 1에서 정의하고 Task 1 Step 2·3·4에서만 쓴다.
- `compositionShares<T extends { amount: number }>(rows: T[]): Array<T & { share: number }>` — Task 7에서 정의, Task 7 Step 5에서 사용. `share`는 백분율(0~100)이고 Step 5가 `width: ${item.share}%`로 그대로 쓴다. 일치한다.
- `RecurringDetectionOptions = { maxDaySpread: number; maxVariation: number }` — Task 14에서 정의·사용. 기존 호출부는 인자 둘만 넘겨 기본값으로 동작한다.
- `CHART_ANIMATIONS = { x: { duration: 0 } }` — Task 15에서 정의·사용.
- `alpha(color, opacity)` — 기존 함수. Task 11이 소비만 한다.
- `ChartLegend({ items: { name, color }[] })` — 기존 컴포넌트. Task 10과 Task 12가 소비, Task 8이 사용처 하나를 제거한다. Task 8이 `chart-legend.tsx`를 지우지 않으므로 충돌 없다.
- `.app-tab` — Task 2에서 정의, Task 2의 세 호출부에서 사용. Task 13 Step 7이 `inbox-tabs.tsx`를 다시 건드리지만 라벨만 바꾸고 클래스는 그대로 두므로 순서 의존이 없다.

**4. 태스크 간 충돌**

같은 파일을 여러 태스크가 건드리는 곳을 점검했다.

| 파일 | 태스크 | 충돌? |
| --- | --- | --- |
| `src/app/ledger/page.tsx` | 1(141-154행), 2(186행), 3(140행) | 없음. 서로 다른 줄 |
| `src/app/budgets/page.tsx` | 1(96-127행), 3(89-94행) | 없음. Task 1 Step 3이 "89-94행은 건드리지 않는다"고 명시 |
| `src/app/assets/page.tsx` | 1(67-72행), 6(90·97행), 7(53·116-127행) | 없음. 서로 다른 줄 |
| `src/features/inbox/inbox-tabs.tsx` | 2(33행 클래스), 13(라벨) | 없음 |
| `src/features/analytics/chart-js.ts` | 11(255-271행 삭제), 15(44행 다음 추가) | 없음 |
| `src/features/analytics/series-chart.tsx` | 11(154·170행), 15(215행) | 없음 |
| `src/features/analytics/annual-flow-overview.tsx` | 11(60·65행), 15(75·137행) | 없음 |
| `src/features/assets/net-worth-chart.tsx` | 8(전면), 15(76행) | **있음.** Task 8이 `options` useMemo를 다시 쓰므로 Task 15의 76행 앵커가 움직인다. Task 8을 Task 15보다 먼저 실행하면 문제없고, 반대 순서면 Task 8이 `animations: CHART_ANIMATIONS,` 줄을 보존해야 한다. 번호 순서대로 실행하면 안전하다 |
| `src/features/analytics/home-trend-charts.tsx` | 10(SavingsRateChart return), 15(61행) | 없음. 서로 다른 줄 |
| `src/app/dashboard/page.tsx` | 9(38-56행·예산 section·194행), 10(198·202·207행) | 없음 |

`net-worth-chart.tsx` 한 건만 순서 의존이 있고, 번호 순서로 실행하면 발생하지 않는다. Task 8의 Step 1-3 코드에는 `animations` 줄이 없으므로, Task 15를 먼저 실행한 경우에는 Task 8 구현자가 `options` useMemo를 다시 쓸 때 `animations: CHART_ANIMATIONS,` 줄을 유지해야 한다.

**5. E2E 영향 점검**

markup을 바꾸는 태스크가 어떤 스펙을 건드리는지 전수 확인했다.

- Task 1: `getByLabel('조회 월' / '예산 월' / '자산 기준 월')`, `getByRole('button', { name: '보기' })`, `getByLabel('이전 달' / '다음 달')` — 전부 `MonthNav`가 같은 이름으로 유지. `period-sorting-charts.spec.ts`, `auth.spec.ts`, `month-close.spec.ts`가 쓴다.
- Task 2: 탭 텍스트는 안 바뀜. `diagnosis.spec.ts:57`, `import-progress.spec.ts:95` 통과해야 한다.
- Task 5: `#transaction-form`을 쓰는 스펙 전수 — `auth.spec.ts:161-163`, `period-sorting-charts.spec.ts:181·184·288`, `parity.spec.ts:233`, `month-close.spec.ts:355`, 그리고 유닛 `tests/finance/diagnosis-ledger-page.test.ts:55`. 여섯 자리를 Step 3·4에서 전부 다룬다.
- Task 13: `setInputFiles`가 `input[name="files"]` / `input[name="file"]`을 직접 찾으므로 `sr-only`여도 동작한다. `parity.spec.ts`, `import-progress.spec.ts`.
- Task 3·4·6·7·8·9·10·11·12·14·15: 텍스트와 접근성 이름을 바꾸지 않는다. Task 7만 배분 줄에 퍼센트를 덧붙이는데, `git grep -n "자산 배분" -- tests` 결과가 없음을 이 플랜을 쓰면서 확인했다. 건드릴 스펙이 없다.

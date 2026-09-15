# UI 정렬 후속 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앞선 브랜치(`ui-alignment-polish`, main `229e28c`)가 보류로 남긴 결함을 전부 닫는다.

**Architecture:** 여섯 개의 독립된 결함이다. 둘은 CSS 격자·테두리, 하나는 화면에 적용된 적 없는 타입 유틸리티 스윕, 하나는 포커스 링 제어 기전, 하나는 포인터 이벤트 버그, 하나는 그 버그가 막고 있던 범례다. 새 읽기 모델·스키마·서버 액션은 없다.

**Tech Stack:** Next.js 15 App Router, Tailwind v4, Chart.js 4, Vitest(`pnpm test`), Playwright(`pnpm e2e`).

**Spec:** 없음. 근거는 `ui-alignment-polish` 브랜치의 SDD 원장과 그 브랜치 최종 리뷰의 보류 분류다. 각 태스크의 "왜" 문단이 그 측정값을 담는다.

## 앞선 브랜치에서 배운 것 — 전부 읽고 시작할 것

이 항목들은 앞 브랜치에서 여덟 번의 잘못된 단언과 세 번의 사고를 낳은 것들이다.

1. **레이어 밖 CSS가 Tailwind를 이긴다.** `globals.css:1`이 `@import "tailwindcss"`라 모든 유틸리티가 `@layer utilities` 안에 있고, 그 아래 프로젝트 규칙은 전부 레이어 밖이다. **tsc·lint·Tailwind 컴파일러 어느 것도 이걸 보고하지 않는다.** 특히 `globals.css:173-178`의 `button, input, select, textarea { max-width: 100%; font: inherit; }`은 `font` 단축이라 **크기와 굵기를 모두** 가져간다 — form 요소 위의 `text-[Npx]`와 `font-*`는 죽는다. `t-*` 클래스는 클래스 특이도로 이긴다.
2. **`font: inherit`은 *부모*에서 상속한다.** 같은 행의 컨트롤이라도 부모가 `<label>`이냐 `<div>`냐에 따라 11px과 16px로 갈린다. 부모 체인을 확인하지 않고 렌더를 예측하지 말 것.
3. **`t-*`는 완전한 타입 리셋이 아니다.** 각각 `globals.css:743-752`에 적힌 속성만 선언한다. `t-caption`은 굵기를 선언하지 않는다.
4. **arbitrary `text-[Npx]`는 font-size만 설정한다.** line-height는 상속되며 Tailwind preflight가 `html`에 1.5를 건다.
5. **측정할 때 도구가 거짓말하는지 먼저 의심할 것.** dev 서버 둘이 `.next`를 공유하면 스타일시트 없는 페이지를 내놓아 모든 색 판독이 가짜가 된다. 색을 읽기 전에 스타일시트 로드를 확인할 것.
6. **합성색은 계산하지 말고 측정할 것.** `alpha(ink, 0.34)`는 track이 아니라 `--background` 위에 합성된다. 앞 브랜치에서 산술로 구했으면 스위트가 빨갰다.
7. **`git commit --amend`를 쓰지 말 것.** 다른 태스크의 커밋이 위에 올라오면 그것을 덮어쓴다. 앞 브랜치에서 실제로 일어났다.
8. **구현자를 병렬로 돌리지 않는다.** dev 서버 충돌과 amend 사고의 원인이었다.

## Global Constraints

- 색은 토큰만: ink `#18181b`, muted `#71717a`, faint `#a1a1aa`, hairline/border `#e4e4e7`, track `#f4f4f5`, panel `#fafafa`, blue `#2563eb`, red `#dc2626`, green `#16a34a`, amber `#d97706`, violet `#7c3aed`.
- **색 의미**: 빨강 = 초과·음수·오류. 초록 = 저축·달성·확정. 파랑 = 수입·링크. 주황 = 경고·잠정.
- **버튼 규칙**: 채운 검정 = 주 버튼. 채운 초록은 월 마감 컨트롤 두 곳(`month-close-control.tsx`의 `월 전체 마감`과 `allClear`일 때의 `월 마감` 트리거)만. 채운 파랑 버튼은 없다. 비활성은 `disabled:opacity-40`.
- **컨트롤 높이는 34px 하나.** 행 안 보조 컨트롤은 30px.
- **금액은 `formatWon` 그대로.** 억·만 축약은 값에 쓰지 않는다(축 눈금은 예외, 척도 표시이지 값이 아니다).
- 원시 `text-[Npx]`를 새로 쓰지 않는다. `t-*` 스케일을 쓴다. `<small>` 금지.
- **모든 node·pnpm 명령 앞에 `NODE_OPTIONS=`.** 빼면 실패한다.
- **`pnpm build`와 `pnpm dev`를 동시에 돌리지 않는다.** 측정 후 dev 서버를 죽인다.
- `git add`는 플랜에 적힌 경로만. **`git add -A` 금지.**
- **모든 태스크가 `pnpm e2e` 전체를 게이트로 돌린다.** 앞 브랜치는 한 태스크의 브리프에 E2E 게이트가 없어 최종 실행에서야 파손이 드러났다. 스크린샷 픽셀을 대조하는 스펙이 있어 시각 변경은 유닛으로 잡히지 않는다.
- `pnpm e2e`는 `docs/design/budget-editor/result/`의 추적 중인 PNG 여섯 개를 다시 쓴다. **복원하고 스테이징하지 말 것.**
- 측정용 로그인 계정: `dev@finance.local` / `devdev1234`. `.env.local`이 워크트리에 없으면 main 워크트리에서 복사한다(gitignore돼 있어 커밋되지 않는다).

## File Structure

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `src/app/globals.css` | 예산 편집기 격자 반응형, 포커스 인셋 클래스 | 1·4 |
| `src/app/assets/page.tsx` | KPI 밴드 구분선 스코프 | 2 |
| form 요소 20줄 / 10개 파일 | 적용되지 않는 타입 유틸리티 | 3 |
| 포커스 오버라이드 5개 파일 | 죽은 `focus-visible:outline-*` | 4 |
| `src/features/analytics/cell-transactions.ts` | 스크롤 유발 호버가 포커스 요청을 지우는 것 | 5 |
| `src/features/analytics/stats-monthly-section.tsx` | 누적 막대 범례 | 6 |

---

## Task 1: 예산 편집기가 태블릿 폭에서 무너진다

**왜:** `globals.css:947`의 `.plan-item` 격자가 `200px 200px minmax(0, 1fr) 360px`에 `gap: 16px`다. 고정 폭 합계가 760px, 간격 셋이 48px이므로 **콘텐츠 폭 808px에서 세 번째 열이 0이 된다.** 앞 브랜치에서 실측: 641~1000px 구간에서 참고 열이 `colW: 0`이 되고 글자가 한 글자씩 줄바꿈되며, 그 구간의 헤더 높이가 486px까지 커진다. 태블릿에서 예산 편집기를 쓸 수 없다. 앞 브랜치의 검증이 1440px에서만 돌아 잡히지 않았다.

**Files:**
- Modify: `src/app/globals.css` (앵커: `.plan-item {` 블록의 `grid-template-columns`, 그리고 같은 파일에 이미 있는 `.plan-item` 관련 미디어쿼리가 있으면 그 옆)

- [ ] **Step 1: 현재 붕괴를 재현한다**

먼저 고장을 눈으로 본다. `pnpm dev`를 띄우고 아래를 `/tmp/planwidth.mjs`로 저장해 돌린다.

```js
import { chromium } from '/Users/leedj/workspace/Personal/finance-web/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/login')
await page.fill('input[type="email"]', 'dev@finance.local')
await page.fill('input[type="password"]', 'devdev1234')
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 })
for (const w of [1440, 1100, 1000, 900, 800, 768, 700, 641, 600, 500, 390]) {
  await page.setViewportSize({ width: w, height: 900 })
  await page.goto('http://localhost:3000/budgets', { waitUntil: 'networkidle' })
  const m = await page.evaluate(() => {
    const item = document.querySelector('.plan-item')
    if (!item) return null
    const cols = getComputedStyle(item).gridTemplateColumns.split(' ').map(v => Math.round(parseFloat(v)))
    const header = document.querySelector('.plan-list__header')
    return { cols, itemH: Math.round(item.getBoundingClientRect().height), headerH: header ? Math.round(header.getBoundingClientRect().height) : null, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }
  })
  console.log(w + 'px', JSON.stringify(m))
}
await b.close()
```

Run: `NODE_OPTIONS= node /tmp/planwidth.mjs`
Expected (수정 전): 1000px 아래부터 `cols`의 세 번째 값이 한 자릿수나 0으로 떨어지고 `itemH`가 치솟는다. **이 출력을 보고서에 그대로 붙인다** — 수정 후와 대조할 기준이다.

- [ ] **Step 2: 좁은 폭에서 격자를 바꾼다** — `globals.css`의 `.plan-item` 규칙 다음에 추가한다.

```css
/* 200+200+360 fixed plus three 16px gaps needs 808px before the 참고 column
   gets anything at all. Below that the four columns become two rows. */
@media (max-width: 1023px) {
  .plan-list__header, .plan-item { grid-template-columns: minmax(0, 1fr) 200px; }
  .plan-list__header { display: none; }
  .plan-item__major { grid-column: 1; grid-row: 1; }
  .plan-item__amount { grid-column: 2; grid-row: 1; }
  .plan-item__sources { grid-column: 1 / -1; grid-row: 2; }
  .plan-item__trend { grid-column: 1 / -1; grid-row: 3; }
}
```

**정확한 자식 클래스 이름을 먼저 읽고 쓸 것.** 위 이름들(`__major`, `__amount`, `__sources`, `__trend`)은 `globals.css:969-972` 부근과 `src/features/budgets/plan-item.tsx`에서 확인한 것이어야 한다. 실제 이름이 다르면 실제 이름을 쓴다. `grid-row`를 명시하는 이유는 `.plan-item`이 `grid-template-rows: min-content 1fr`을 갖고 `.plan-item__topline`이 `display: contents`이기 때문이다 — 그 상호작용을 확인하고 필요하면 `grid-template-rows`도 좁은 폭에서 `auto`로 푼다.

머리글을 `display: none`으로 감추는 이유: 네 열의 이름을 두 행 배치 위에 얹으면 어느 열도 안 가리킨다. 각 셀이 자기 라벨을 갖는지 확인하고, 안 갖는 셀이 있으면 감추는 대신 좁은 폭용 라벨을 셀 안에 넣는다.

- [ ] **Step 3: 재측정**

Step 1의 스크립트를 다시 돌린다.
Expected: 모든 폭에서 세 번째 열 값이 0이 아니거나 두 행 배치로 바뀌어 있고, `scrollW == clientW`(가로 넘침 없음)이며, `itemH`가 어느 폭에서도 폭발하지 않는다. **1024px 이상에서는 Step 1과 동일해야 한다** — 넓은 화면은 건드리지 않는 변경이다.

- [ ] **Step 4: 확인**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 0 errors, 유닛 PASS.

dev 서버를 죽이고: `NODE_OPTIONS= pnpm e2e`
Expected: 94 passed. **`budget-save-lifecycle.spec.ts`와 `period-sorting-charts.spec.ts`가 예산 화면을 구동하므로 이 게이트는 필수다.**

- [ ] **Step 5: 커밋**

```bash
git add src/app/globals.css
git commit -m "fix(budgets): stack the plan editor's columns before they collapse"
```

---

## Task 2: 자산 KPI 밴드가 태블릿에서 떠도는 헤어라인을 남긴다

**왜:** `assets/page.tsx:84`가 `sm:grid-cols-2 sm:divide-x sm:divide-finance-hairline xl:grid-cols-4`다. Tailwind의 `divide-x`는 `:where(& > :not(:last-child))`에 `border-inline-end`를 건다. 4열에서는 카드 1·2·3이 내부 구분선을 갖지만, **2열에서는 카드 2가 행의 끝인데도 `:not(:last-child)`라 오른쪽 테두리를 얻어 컨테이너 콘텐츠 가장자리에 헤어라인이 떠돈다.** 카드 4에는 없어 좌우가 비대칭이다. 앞 브랜치 리뷰가 768px에서 관측했다.

**Files:**
- Modify: `src/app/assets/page.tsx:84`

- [ ] **Step 1: 떠도는 테두리를 재현한다**

`pnpm dev`를 띄우고 768px에서 네 카드의 `borderInlineEndWidth`를 읽는다.

```js
const widths = await page.evaluate(() => Array.from(document.querySelectorAll('main section:nth-of-type(1) > article'))
  .map(a => getComputedStyle(a).borderInlineEndWidth))
```

Expected (수정 전): 768px에서 `['1px','1px','1px','0px']` — 카드 2가 행 끝인데 테두리를 갖는다.

- [ ] **Step 2: 구분선을 4열 배치에만 건다** — 84행의 `sm:divide-x sm:divide-finance-hairline`을 `xl:divide-x xl:divide-finance-hairline`으로 바꾼다.

```tsx
        <section className="mt-6 grid border-y border-finance-ink sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-finance-hairline">
```

2열 배치에서는 구분선이 사라진다. 카드가 위아래로도 붙으므로 세로 구분이 필요한지 눈으로 확인하고, 필요하면 `sm:max-xl:divide-y`를 더한다 — 다만 **`divide-y`도 같은 `:not(:last-child)` 문제를 2열에서 갖는지 먼저 확인할 것.**

- [ ] **Step 3: 재측정**

Expected: 768px에서 네 값 모두 `0px`, 1440px에서 `['1px','1px','1px','0px']`.

- [ ] **Step 4: 확인·커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, 그리고 dev 서버를 죽이고 `NODE_OPTIONS= pnpm e2e`.
Expected: 0 errors, 유닛 PASS, 94 passed.

```bash
git add src/app/assets/page.tsx
git commit -m "style(assets): draw the KPI dividers only where there are four columns"
```

---

## Task 3: form 요소 위의 적용되지 않는 타입 유틸리티

**왜:** `globals.css:173-178`의 레이어 밖 `button, input, select, textarea { max-width: 100%; font: inherit; }`이 그 네 요소 위의 모든 Tailwind 크기·굵기 유틸리티를 이긴다. `font`가 단축이라 크기까지 가져간다. 앞 브랜치에서 실측된 사례: 한 보조 버튼이 13px/600 대신 **16px/400**으로 렌더돼 옆의 주 버튼보다 컸고, 다른 버튼은 12px/600 대신 **12px/400**이었다. **마크업이 주장하는 것과 화면이 다르다.**

**Files (전수, 10개 파일 20줄):**
- Modify: `src/app/manage/page.tsx:97`
- Modify: `src/features/ai-settings/settings-form.tsx:126,147,148,159,160`
- Modify: `src/features/analytics/stats-monthly-section.tsx:567`
- Modify: `src/features/assets/asset-accounts-manager.tsx:36,44,45,51,52`
- Modify: `src/features/assets/asset-form.tsx:137`
- Modify: `src/features/budgets/ai-evidence.tsx:202,278`
- Modify: `src/features/inbox/history-list.tsx:106,163`
- Modify: `src/features/ledger/ledger-filter-form.tsx:42`
- Modify: `src/features/manage/categories-manager.tsx:117`
- Modify: `src/features/month-close/month-close-control.tsx:57`

**줄 번호는 참고용이다. 게이트로 대상을 다시 찾을 것:**

```bash
git grep -nE "<(button|input|select|textarea)" -- 'src/**/*.tsx' | grep -E "t-caption font-|t-body font-|t-label font-|text-\[1[0-9]px\]"
```

- [ ] **Step 1: 대상마다 지금 무엇이 렌더되는지 잰다**

각 줄에서 **실제 form 요소**를 찾는다. 위 grep은 같은 줄에 있는 `<label>`이나 `<div>`도 잡으므로, 유틸리티가 실제로 `button`/`input`/`select`/`textarea` 위에 있는지 확인한다 — `<label className="… t-caption font-medium">` 안에 `<select className={inputClass}>`가 있는 형태라면 라벨의 유틸리티는 **살아 있고** 대상이 아니다.

진짜 대상마다 브라우저에서 계산된 `font-size`·`font-weight`를 읽어 마크업이 주장하는 값과 대조하고, 표로 보고한다. **차이가 없는 줄은 대상이 아니다** — 조상 체인이 마침 같은 값을 주고 있을 수 있다(교훈 2).

- [ ] **Step 2: 각 대상을 실제로 적용되는 클래스로 바꾼다**

원칙: **마크업이 주장하던 렌더를 유지한다.** 이 태스크는 외양을 바꾸는 것이 아니라 코드가 화면과 일치하게 만드는 것이다.

- `text-[13px] font-semibold` → `t-body-strong` (13px/600)
- `t-caption font-semibold` → 12px/600을 내는 클래스가 필요하다. `t-*` 스케일에 없으므로 **`globals.css`의 타입 스케일 옆에 `.t-caption-strong { font-size: 12px; font-weight: 600; line-height: 1.5; }`를 추가하고** 그것을 쓴다. 스케일에 없는 값을 각 호출부에서 지어내지 말 것.
- `text-[11px] font-semibold` → `t-label`이 11px/600이지만 `letter-spacing: 0.1em`도 더한다. 그 자간이 원치 않는 자리면 위와 같은 방식으로 `.t-label-tight`를 만들지 말고, **자간이 실제로 보기 나쁜지 먼저 재고** 보고한다 — 새 클래스를 늘리는 것보다 기존 스케일에 맞추는 편이 낫다.
- `text-[12px]`·`text-[10px]` 등 굵기 없는 크기만 있는 경우 → 각각 `t-caption`·`t-badge`.

**어떤 경우에도 `!` 수식어를 쓰지 말 것.** 그것을 꺼내게 되면 프로젝트 클래스가 그 속성을 소유하지 말아야 한다는 뜻이다.

- [ ] **Step 3: 재측정하고 대조한다**

Step 1의 표를 다시 만든다.
Expected: 모든 대상이 마크업이 주장하는 값으로 렌더된다. **어느 줄이든 시각적으로 크게 달라지면(예: 16px → 12px) 보고서에 그 줄을 따로 적는다** — 그건 회귀가 아니라 수정이지만, 나중에 스크린샷을 보는 사람이 파손으로 읽지 않게 해야 한다.

- [ ] **Step 4: 게이트가 비는지 확인**

Run: `git grep -nE "<(button|input|select|textarea)" -- 'src/**/*.tsx' | grep -E "t-caption font-|t-body font-|t-label font-|text-\[1[0-9]px\]"`
Expected: 결과 없음, 또는 남은 줄마다 Step 1에서 "대상 아님"으로 판정한 이유가 보고서에 있다.

- [ ] **Step 5: 확인·커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, dev 서버를 죽이고 `NODE_OPTIONS= pnpm e2e`.
Expected: 0 errors, 유닛 PASS, 94 passed. **E2E가 필수다 — `ai-settings.spec.ts`, `parity.spec.ts`, `month-close.spec.ts`가 이 파일들의 화면을 구동한다.**

```bash
git add <Step 1에서 실제로 바꾼 경로들> src/app/globals.css
git commit -m "fix(ui): give form controls type classes that actually apply"
```

---

## Task 4: 컴포넌트가 포커스 링을 제어하려는 시도가 전부 죽어 있다

**왜:** `globals.css:240`의 `:focus-visible { outline: 2px solid var(--finance-blue); outline-offset: 2px; }`은 레이어 밖이라 모든 Tailwind `focus-visible:outline-*` 유틸리티를 이긴다. 다섯 파일이 그것을 덮으려 시도하고 전부 실패한다. **전역 규칙 자체는 좋다** — 모든 포커스 가능 요소에 링을 보장한다. 문제는 (a) 죽은 클래스가 제어권을 가진 척한다는 것과 (b) 조밀한 표에서는 `+2px` 바깥 링이 이웃을 덮어 `category-detail-table.tsx:296`이 `-2px` 인셋을 원했다는 것이다.

**전역 규칙을 없애지 않는다.** 없애면 아무것도 대신하지 않는 자리에서 포커스 링이 사라진다 — 위 (a) 때문에 컴포넌트 클래스는 어차피 안 듣는다.

**Files:**
- Modify: `src/app/globals.css` (앵커: `:focus-visible {` 블록 다음)
- Modify: `src/features/analytics/category-detail-table.tsx` (죽은 `focus-visible:outline-*` 2곳)
- Modify: `src/features/inbox/inbox-review-month-group.tsx`, `inbox-review-owner-group.tsx`, `inbox-review-source-group.tsx` (각 1곳)

- [ ] **Step 1: 대상 전수와 각각의 의도를 파악한다**

Run: `git grep -n "focus-visible:" -- 'src/**/*.tsx'`

각 자리에서 **무엇을 하려던 것인지** 적는다. 인셋 링인지(조밀한 표), 색만 바꾸려던 것인지(전역과 같은 파랑이면 무의미), 링을 없애려던 것인지. 계산된 `outline-offset`을 브라우저에서 읽어 전역의 `2px`가 이기고 있음을 실측으로 확인한다.

- [ ] **Step 2: 인셋 링이 필요한 자리를 위한 클래스를 만든다** — `globals.css`의 `:focus-visible` 블록 다음에 추가

```css
/* Tailwind's focus-visible: utilities are layered and lose to the rule above,
   so a dense table that needs its ring inside its own box asks for it here. */
.focus-inset:focus-visible { outline-offset: -2px; }
```

- [ ] **Step 3: 죽은 클래스를 지우고, 인셋이 필요한 자리에만 새 클래스를 단다**

Step 1에서 "전역과 같은 것을 하려던" 자리는 클래스를 **삭제**한다 — 전역 규칙이 이미 그것을 한다. "인셋을 원하던" 자리는 죽은 유틸리티를 지우고 `focus-inset`을 단다.

- [ ] **Step 4: 실측으로 확인한다**

각 대상에 키보드로 포커스를 주고 계산된 `outline-offset`을 읽는다.
Expected: `focus-inset`을 단 자리는 `-2px`, 나머지는 `2px`. **그리고 모든 대상에 링이 실제로 보인다** — 이 태스크가 포커스 링을 없애는 일이 되어서는 안 된다.

- [ ] **Step 5: 확인·커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, dev 서버를 죽이고 `NODE_OPTIONS= pnpm e2e`.
Expected: 0 errors, 유닛 PASS, 94 passed. **`parity.spec.ts`가 키보드 포커스 동작을 여러 곳에서 단언하므로 필수다.**

```bash
git add src/app/globals.css src/features/analytics/category-detail-table.tsx src/features/inbox/inbox-review-month-group.tsx src/features/inbox/inbox-review-owner-group.tsx src/features/inbox/inbox-review-source-group.tsx
git commit -m "fix(ui): let components ask for an inset focus ring instead of pretending to"
```

---

## Task 5: 스크롤이 만든 호버가 포커스된 셀의 요청을 지운다

**왜:** `cell-transactions.ts:74-76`의 `open()`이 `clearTimer()`와 `abort()`로 시작한다. 한 번에 하나의 툴팁만 뜨는 모델에서는 옳다. 그러나 **키보드로 셀에 포커스하면 브라우저가 스크롤하고, 그 스크롤이 마우스 포인터 아래로 다른 셀을 끌어오며, 그 셀의 `mouseenter`가 `open()`을 불러 포커스가 예약한 요청을 지운다.** 사용자는 마우스를 움직인 적이 없다. 앞 브랜치에서 세 번 관측됐고(`month-close`에서 18px, `parity`에서 94px 접힘선 초과), 매번 90초 `waitForResponse` 타임아웃으로 나타나 레이아웃 문제처럼 보이지 않았다.

**스크롤 시 취소는 건드리지 않는다.** `parity.spec.ts:1066`이 그것을 **의도된 동작으로 단언**한다. 고치는 것은 *사용자가 마우스를 움직이지 않았는데* 호버가 발화하는 경우뿐이다.

**Files:**
- Modify: `src/features/analytics/cell-transactions.ts`
- Test: `tests/finance/` 에 새 유닛 테스트, 또는 기존 셀 툴팁 테스트 파일

- [ ] **Step 1: 실패하는 테스트를 쓴다**

포인터가 움직이지 않은 채 발화한 `mouseenter`가 **대기 중인 포커스 요청을 지우지 않는다**는 것을 단언한다. 훅을 직접 시험할 수 있으면 그렇게 하고, 아니면 `open()`의 우선순위 규칙을 순수 함수로 빼서 시험한다. **테스트가 조건을 실제로 고정하는지 변이로 확인할 것** — 새 가드를 지웠을 때 그 테스트만 실패해야 한다.

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit <파일>`
Expected: FAIL.

- [ ] **Step 3: 구현**

마지막으로 관측한 포인터 좌표를 기억하고, `mouseenter`가 **좌표 변화 없이** 발화하면 그것을 스크롤 유발로 보아 무시한다. 실제로 마우스를 움직여 다른 셀에 올린 사용자는 계속 기존처럼 앞선 요청을 선점한다.

정확한 배선은 `cell-transaction-tooltip.tsx` / `cell-transaction-popover.tsx`가 `open()`을 어떻게 부르는지 읽고 정한다. `open()`에 호출 출처를 넘기는 편이 나을 수도 있다 — **두 방식을 다 보고 고른 이유를 보고서에 적을 것.**

- [ ] **Step 4: 통과 확인과 실물 확인**

Run: `NODE_OPTIONS= pnpm vitest run --project unit <파일>`
Expected: PASS.

그리고 브라우저에서: `/report`의 상세 표에서 마우스를 표 위에 둔 채 키보드로 접힘선 아래 셀에 포커스한다. 툴팁이 뜨는지 확인한다. **앞 브랜치는 이 경로를 실물로 확인한 적이 없다.**

- [ ] **Step 5: 확인·커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, dev 서버를 죽이고 `NODE_OPTIONS= pnpm e2e`.
Expected: 0 errors, 유닛 PASS, 94 passed. **`parity.spec.ts:1066`이 스크롤 취소를 단언하므로 그것이 여전히 통과해야 한다 — 통과하지 않으면 스크롤 취소까지 없앤 것이다.**

```bash
git add src/features/analytics/cell-transactions.ts <테스트 경로>
git commit -m "fix(stats): a scroll-induced hover no longer cancels a focused cell's request"
```

---

## Task 6: 누적 막대 범례 (Task 5가 끝난 뒤에만)

**왜:** 통계의 누적 막대에 범례가 없어 어느 색이 어느 항목인지 아래 표를 봐야 안다. 앞 브랜치에서 세 배치를 시도해 셋 다 E2E를 깼는데, **그 파손의 기전이 전부 Task 5의 버그였다** — 범례가 높이를 더해 셀이 접힘선 아래로 밀리고, 포커스가 스크롤을 일으키고, 그 스크롤이 호버를 만들어 요청을 지웠다. 범례가 테스트를 깬 것이 아니라 **범례가 제품 버그를 드러냈고 테스트가 그것을 잡은 것**이다.

**Task 5가 병합된 뒤에만 이 태스크를 시작한다.** Task 5 없이 시도하면 앞 브랜치와 같은 자리에서 같은 이유로 깨진다.

**Files:**
- Modify: `src/features/analytics/stats-monthly-section.tsx`

- [ ] **Step 1: Task 5가 정말 이것을 풀었는지 먼저 확인한다**

범례를 넣기 전에, Task 5의 수정만으로 앞 브랜치가 실패했던 지점이 이제 견디는지 본다. 뷰포트를 390×520으로 두고 `/report`에서 접힘선 아래 셀에 키보드로 포커스해 툴팁이 뜨는지 확인한다.

**뜨지 않으면 여기서 멈추고 보고한다.** Task 5가 이 태스크의 전제이고, 전제가 틀렸으면 범례는 다시 연기다.

- [ ] **Step 2: 범례를 넣는다**

`GRID_COLUMNS`는 `'150px repeat(12, minmax(0, 1fr)) 110px 95px 90px'` 16열이다. 차트 행 다음 행에 축 칸을 비우고 열두 달 폭으로 넣는다.

```tsx
              <div className="col-span-12 col-start-2 pt-2">
                <ChartLegend items={model.series.map((item) => ({ name: item.label, color: item.color }))} />
              </div>
```

**`item.color`를 날것으로 넘긴다.** `ChartLegend`(`chart-legend.tsx:16`)가 평범한 DOM 노드에 `backgroundColor`로 쓰므로 CSS 변수를 그대로 받고, 아래 표의 스와치가 이미 그렇게 한다. `resolveChartColor`나 `useFinanceChartPalette`를 거치면 서버 렌더가 항상 라이트 팔레트라 다크 첫 페인트가 어긋난다. import는 `ChartLegend` 하나면 된다.

- [ ] **Step 3: 범례 색이 표 스와치와 맞는지 실측**

브라우저에서 범례 항목과 아래 표의 같은 행 스와치의 계산된 배경을 각각 읽어 대조한다. **light와 dark 양쪽에서**, 그리고 **첫 페인트에서도**(정적 청크를 차단하면 인라인 스트리밍 스크립트가 마크업을 넣고 테마 스크립트가 `data-theme`을 찍되 React는 재렌더하지 않는다).
Expected: 항목 수만큼 전부 일치, 불일치 0.

- [ ] **Step 4: 접힘선 영향을 잰다**

범례가 더한 높이와, 상세 표의 첫 셀이 390×520에서 접힘선 위인지 아래인지 보고한다. 아래여도 Task 5 덕에 견뎌야 한다 — 그것이 이 태스크의 전제다.

- [ ] **Step 5: 확인·커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`, dev 서버를 죽이고 `NODE_OPTIONS= pnpm e2e`.
Expected: 0 errors, 유닛 PASS, **94 passed**. 앞 브랜치에서 이 태스크가 세 번 깬 스펙은 `month-close.spec.ts`, `parity.spec.ts`, `period-sorting-charts.spec.ts` 셋이다. 하나라도 빨가면 멈추고 보고한다 — 다시 범례를 빼기 전에 Task 5가 왜 안 막았는지 알아야 한다.

```bash
git add src/features/analytics/stats-monthly-section.tsx
git commit -m "feat(stats): name the stacked chart's categories in a legend"
```

---

## 마지막 확인

- [ ] dev 서버를 죽이고 `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm build && NODE_OPTIONS= pnpm e2e`
- [ ] `docs/design/budget-editor/result/`의 PNG 여섯 개가 복원됐고 스테이징되지 않았는지 확인
- [ ] 워크트리 루트에 스크래치 `.mjs`가 없는지 확인
- [ ] Task 1·2의 측정 스크립트를 다시 돌려 수정 전후 수치가 보고서와 일치하는지 확인

## Self-Review

**1. 근거 커버리지** — 사용자가 "다 해줘"라고 한 여섯 항목: 예산 격자(T1), 자산 헤어라인(T2), 죽은 form 유틸리티(T3), 전역 focus-visible(T4), 툴팁 취소(T5), 통계 범례(T6). 전부 있다. 개발 가구의 테스트 잔여물은 코드 변경이 아니라 데이터 정리이므로 플랜 밖에서 처리한다.

**2. 플레이스홀더 점검** — 조건부 지시가 셋 있다. T1 Step 2의 자식 클래스 이름, T3 Step 2의 `t-label` 자간 판단, T5 Step 3의 배선 선택. 셋 다 "무엇을 할지 안 적음"이 아니라 "현장에서 이름·수치를 확인하라"이며, 각각 확인 방법과 판단 기준을 적었다. 앞 브랜치에서 이 종류의 조건부 지시는 문제를 일으키지 않았고, 오히려 내가 확인 없이 단정한 자리들이 여덟 번 틀렸다.

**3. 타입 일관성** — 새 인터페이스는 `.t-caption-strong`(T3)과 `.focus-inset`(T4) 두 CSS 클래스, 그리고 T5의 포인터 좌표 가드뿐이다. 서로 겹치지 않는다.

**4. 태스크 간 충돌**

| 파일 | 태스크 | 충돌? |
| --- | --- | --- |
| `globals.css` | 1(격자), 3(`.t-caption-strong`), 4(`.focus-inset`) | 없음. 서로 다른 블록이며 셋 다 추가다 |
| `stats-monthly-section.tsx` | 3(`:567` 버튼), 6(범례 행) | 없음. 서로 다른 줄 |
| `cell-transactions.ts` | 5 | 단독 |
| `category-detail-table.tsx` | 4 | 단독 |
| 인박스 그룹 3파일 | 4 | 단독 |

**순서 의존 하나:** T6은 T5 뒤에만. T6 Step 1이 그 전제를 실행으로 확인하고, 틀리면 멈춘다.

**5. E2E 게이트** — 앞 브랜치의 가장 비싼 실수가 한 태스크의 브리프에 E2E 게이트가 없어 최종 실행에서야 파손이 드러난 것이다. **여기서는 여섯 태스크 전부가 `pnpm e2e` 전체를 돌린다.** T1·T2는 시각 변경이라 스크린샷 픽셀 대조 스펙에 걸릴 수 있고, T3·T4는 열 개 파일의 화면을 건드리며, T5·T6은 그 스펙들이 잡아낸 바로 그 기전이다.

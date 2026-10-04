# 투자 1단계(스키마·계산·화면 골격) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `우리집 투자` 공간을 만들고, 수동 입력한 거래만으로 보유·추이·거래·관심·어드바이저·종목 상세·설정 화면이 명세대로 렌더되게 한다. 키움 연동(2단계)과 AI 작업(3단계)은 이 계획에 없다.

**Architecture:** 모든 자금 이벤트를 `investment_transactions` 한 테이블에 두고 포지션·평균단가·예수금·실현손익은 순수 함수로 계산한다. 국내(KRW)·해외(USD)는 먼저 통화별로 집계하고 원화 환산은 합계에서만 한다. 헤더는 `space` prop으로 가계부/투자 두 공간을 전환하고, 투자 공간의 페이지는 `src/app/investment/*` 서버 컴포넌트가 `src/features/investment/queries.ts`를 직접 호출한다. 워커용 RPC와 `diagnosis_workers.capabilities`는 워커와 함께 2단계에서 만든다(이 계획은 테이블·RLS·GRANT까지).

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM + drizzle-kit, Supabase Postgres(로컬 Docker), Tailwind v4, Chart.js 4 + react-chartjs-2, Vitest(unit/integration), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-investment-portfolio-design.md` (1·2·4.1·4.3·4.6절이 이 계획의 근거). 화면 목업: `docs/design/swiss-ledger/investment-2026-09-28.html`.

## 앞선 계획에서 배운 것 — 전부 읽고 시작할 것

1. **모든 node·pnpm 명령 앞에 `NODE_OPTIONS=`.** 빼면 실패한다.
2. **`git add`는 계획에 적힌 경로만. `git add -A` 금지. `git commit --amend` 금지.**
3. **레이어 밖 CSS가 Tailwind를 이긴다.** `globals.css`의 `button, input, select, textarea { font: inherit }`이 form 요소 위의 `text-[Npx]`·`font-*`를 죽인다. 컨트롤 타입은 `t-body-normal`·`t-caption-strong` 같은 `t-*` 클래스로만 정한다.
4. **`pnpm build`와 `pnpm dev`를 동시에 돌리지 않는다.** `pnpm e2e`는 자체 빌드를 한다.
5. **통합 테스트는 로컬 Supabase가 떠 있어야 한다.** `NODE_OPTIONS= pnpm dlx supabase@latest status`로 확인. Docker가 없으면 "실행 못 함"으로 기록하고 통과라고 쓰지 않는다.
6. **구현자를 병렬로 돌리지 않는다.**

## 시각 참조 — 화면 태스크(7·8·9) 시작 전에 열어 볼 것

이 계획의 화면은 이미 승인된 고충실도 목업을 옮기는 일이다. 새로 디자인하지 않는다.

| 자료 | 경로 | 용도 |
| --- | --- | --- |
| 목업 HTML (동작함) | `docs/design/swiss-ledger/investment-2026-09-28.html` | 브라우저로 열면 상단 프로토타입 바에서 목록/상세 화면 전환, 라이트/다크 토글. 메뉴를 누르면 화면이 바뀐다. 보유 표의 계좌·국내·해외 행을 눌러 접힘 동작을 본다. |
| 화면별 스크린샷 | `docs/design/swiss-ledger/investment-2026-09-28/01…13.png` | 렌더하지 않고 볼 때. 01 보유, 02 보유(접힘 상태), 03 추이, 04 거래, 05 관심, 06 어드바이저, 07 종목 상세, 08·09 다크, 10~13 모바일 390px. |
| 디자인 규칙 | `docs/design/swiss-ledger/README.md` | 카드·그림자 금지, 헤어라인, 숫자 정렬, 색의 의미. 목업이 규칙과 다르면 규칙이 우선. |
| 색·타입 토큰 | `src/app/globals.css` (`:root` 변수, `.t-*`, `.finance-header*`, `.kpi-band`) | 목업의 CSS는 이 파일을 베낀 것이다. 구현은 목업 CSS가 아니라 이 파일의 클래스를 쓴다. |
| 기존 페이지 골격 | `src/app/dashboard/page.tsx`, `src/app/assets/page.tsx`, `src/app/ledger/page.tsx` | KPI 띠, 할 일 목록, 표, 탭의 실제 마크업. 목업이 흉내 낸 원본. |
| 명세 4.6절 | `docs/superpowers/specs/2026-09-28-investment-portfolio-design.md` | 화면마다 무엇이 들어가고 무엇이 2·3단계 몫인지. |

목업과 1단계 구현의 의도된 차이: 목업은 시세·환율·리서치가 다 있는 상태를 그린다. 1단계는 시세가 없으면 "시세 없음"·"종가 기준", 리서치 자리는 "3단계에서 연결" 빈 상태다. 빈 상태 문구는 각 태스크 코드에 있다.

각 화면 태스크의 마지막 단계에서 1440px과 390px 스크린샷을 찍어 해당 참조 PNG와 나란히 놓고 본다. 색·간격·정렬이 다르면 고치고, 데이터가 달라 생기는 차이는 무시한다.

## Global Constraints

- 모든 테이블에 `household_id uuid not null references households(id) on delete cascade`, `enableRLS()`, `is_member(household_id)` SELECT 정책, `REVOKE ALL ... GRANT SELECT TO authenticated`. 쓰기는 서버(owner DATABASE_URL)만 한다. (명세 4.1, 기존 `diagnosis.ts` 규약)
- 종류 값은 pg enum이 아닌 `text` + CHECK. (명세 4.1)
- 대량 행은 `bigint generated always as identity`, 작업 행은 `uuid`, 시각은 `timestamp with time zone`. 소프트 삭제 없음.
- 금액 열은 `numeric` (quantity 18,6 · price 18,4 · amount/fee 18,2 · rate 12,4). 앱 코드에서는 문자열로 받아 `Number()`로 바꾸고 계산은 소수 6자리에서 반올림한다.
- 국내는 원화, 해외는 달러 그대로. 원화 환산은 합계 줄에서만, 환율과 기준일을 화면에 표시. 비중은 원화 환산 합계 기준. (명세 4.3)
- 평균단가는 이동평균법. 매도는 수량만 줄이고 단가 유지. `adjust`는 수량을 더하고 price가 있으면 단가를 그 값으로 재설정. (명세 4.3)
- 색은 토큰만: ink `#18181b`, muted `#71717a`, faint `#a1a1aa`, border `#e4e4e7`, track `#f4f4f5`, panel `#fafafa`, blue `#2563eb`, red `#dc2626`, green `#16a34a`, amber `#d97706`. 수익 파랑 / 손실 빨강 / 주의 주황. 카드·그림자·둥근 모서리 없음. 숫자는 우측 정렬 `tabular-nums`. (`docs/design/swiss-ledger/README.md`)
- 타입 스케일은 `t-page-title`·`t-kpi`·`t-section`·`t-body`·`t-caption`·`t-label`만. 원시 `text-[Npx]` 금지.
- 컨트롤 높이 34px, 행 안 보조 컨트롤 30px. 주 버튼은 채운 검정(`bg-finance-ink text-white`).
- 투자 공간의 페이지는 기존 가계부 테이블(`transactions`, `asset_accounts` 등)을 읽지 않는다. (명세 1절 "독립")
- 각 태스크 완료 게이트: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`. 스키마·쿼리·액션 태스크는 `NODE_OPTIONS= pnpm test:db`도.

## Review Focus

명세가 말하지 않지만 실제로 부딪힐 입력 다섯 가지. 각 줄의 테스트는 해당 태스크 안에 들어 있다.

1. **매도 수량이 보유 수량을 넘는 입력** — 서버 액션이 거부하고 "보유 40주보다 많이 팔 수 없습니다"를 돌려준다. 포지션이 음수가 되지 않는다. (Task 3 계산 테스트 + Task 6 액션 테스트)
2. **평균단가가 없는 상태의 매도(첫 거래가 매도)** — 계산은 realized를 `null`로 두고 화면은 "단가 없음"을 보여준다. 크래시 없음. (Task 3)
3. **해외 종목인데 통화가 KRW로 들어오는 입력 / 국내인데 USD** — 액션이 시장·통화 불일치를 거부한다. (Task 6)
4. **환율 행이 하나도 없을 때의 원화 합계** — 합계는 국내만 더하고 캡션에 "환율 없음 · 해외 미포함"을 표시한다. `NaN`이 화면에 나오지 않는다. (Task 3 + Task 7)
5. **거래일이 미래이거나 1990년 이전** — 액션이 거부한다. 소수 주식은 소수 6자리까지만, 음수 수량은 `adjust`만 허용. (Task 6)

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/db/schema/investment.ts` | 10개 테이블 정의와 RLS 정책 |
| `src/db/schema/index.ts` | `export * from './investment'` 추가 |
| `drizzle/0010_investment.sql` + `drizzle/meta/0010_snapshot.json`, `_journal.json` | drizzle-kit 생성 + 손으로 붙인 GRANT |
| `src/features/investment/types.ts` | 종류 리터럴 타입, 행 타입, 화면 데이터 타입 |
| `src/features/investment/calculations.ts` | 순수 계산: 포지션, 실현손익, 예수금, 통화별 집계, 원화 환산, 괴리, 비중 |
| `src/features/investment/format.ts` | `formatMoney(value, currency)`, `formatSigned`, `formatPct` |
| `src/features/investment/queries.ts` | 페이지별 읽기 모델 (householdId 필수) |
| `src/features/investment/actions.ts` | 서버 액션: 계좌 저장, 수동 거래 저장/메모 수정, 관심 종목 추가, 보유 메모 저장 |
| `src/features/investment/transaction-input.ts` | FormData → 검증된 거래 입력 (순수) |
| `src/features/investment/space.ts` | 공간 쿠키 이름·읽기·쓰기 헬퍼 |
| `src/features/investment/holdings-table.tsx` | 계좌·시장 소그룹 접기 표 (client) |
| `src/features/investment/kpi-band.tsx` | 4칸 KPI 띠 (server) |
| `src/features/investment/status-line.tsx` | 시세·환율·동기화 상태 줄 (server) |
| `src/features/investment/owner-chips.tsx` | 전체/DJ/YJ 칩 (링크) |
| `src/features/investment/transaction-form.tsx` | 수동 거래 인라인 폼 (client) |
| `src/features/investment/holding-memo-form.tsx` | 보유 메모 폼 (client) |
| `src/features/investment/account-form.tsx` | 계좌 추가·수정 폼 (client) |
| `src/features/investment/trend-chart.tsx` | 평가금액·투입원금 선 차트 (client) |
| `src/app/investment/layout.tsx` | 투자 공간 공통 shell(헤더 space='investment', 공간 쿠키 저장) |
| `src/app/investment/page.tsx` | 보유 |
| `src/app/investment/trend/page.tsx` | 추이 |
| `src/app/investment/transactions/page.tsx` | 거래 |
| `src/app/investment/watch/page.tsx` | 관심 |
| `src/app/investment/advisor/page.tsx` | 어드바이저(1단계는 빈 상태) |
| `src/app/investment/[securityId]/page.tsx` | 종목 상세 |
| `src/app/investment/settings/page.tsx` | 투자 설정(계좌) |
| `src/components/app-header-menu.tsx`, `src/components/app-header.tsx` | `space` prop, 브랜드 전환 팝오버, 공간별 링크 |
| `src/app/page.tsx` | 마지막 공간 쿠키에 따라 `/dashboard` 또는 `/investment` |
| `src/app/globals.css` | 브랜드 전환 팝오버·`.mk` 시장 칩 스타일 |
| `src/lib/revalidate.ts` | `investment` 도메인과 경로 |
| `tests/finance/investment-*.test.ts(x)` | 유닛 |
| `tests/integration/investment-*.test.ts` | 통합 |
| `tests/e2e/investment.spec.ts` | E2E |

---

### Task 1: 스키마와 마이그레이션

**Files:**
- Create: `src/db/schema/investment.ts`
- Create: `src/features/investment/types.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0010_investment.sql` (생성 후 GRANT 추가), `drizzle/meta/0010_snapshot.json`, `drizzle/meta/_journal.json`(생성기가 갱신)
- Test: `tests/integration/investment-schema.test.ts`

**Interfaces:**
- Produces: Drizzle 테이블 객체 `investmentAccounts`, `investmentSecurities`, `investmentTransactions`, `latestQuotes`, `priceSnapshots`, `fxRates`, `brokerPositions`, `investmentSettings`, `researchJobs`, `syncJobs`. 타입 `Market = 'KR' | 'US'`, `Currency = 'KRW' | 'USD'`, `TransactionKind = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdraw' | 'fee' | 'adjust'`, `TransactionSource = 'kiwoom' | 'manual'`, `WeightBasis = 'total_assets' | 'stock_accounts'`.

- [x] **Step 1: 실패하는 통합 테스트 작성**

`tests/integration/investment-schema.test.ts`:

```ts
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { db } from '@/db/client'
import { households, investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'

const householdIds: string[] = []
let accountId = 0
let securityId = 0

beforeAll(async () => {
  const created = await db.insert(households).values([{ name: 'TEST-invest-schema' }, { name: 'TEST-invest-other' }]).returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  const [account] = await db.insert(investmentAccounts).values({
    householdId: householdIds[0], owner: 'DJ', name: 'DJ 키움 종합', broker: 'kiwoom', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom',
  }).returning({ id: investmentAccounts.id })
  accountId = account.id
  const [security] = await db.insert(investmentSecurities).values({
    householdId: householdIds[0], market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW',
  }).returning({ id: investmentSecurities.id })
  securityId = security.id
})

afterAll(async () => {
  for (const id of householdIds) await db.delete(households).where(eq(households.id, id))
})

describe('investment schema constraints', () => {
  test('rejects an unknown transaction kind', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'gift' as never, tradeDate: '2026-09-01',
      quantity: '1', price: '1', fee: '0', amount: '-1', currency: 'KRW', source: 'manual',
    })).rejects.toThrow(/investment_transactions_kind_check/)
  })

  test('rejects buy without quantity and price', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'buy', tradeDate: '2026-09-01',
      quantity: null, price: null, fee: '0', amount: '0', currency: 'KRW', source: 'manual',
    })).rejects.toThrow(/investment_transactions_trade_fields_check/)
  })

  test('rejects deposit with a security', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'deposit', tradeDate: '2026-09-01',
      quantity: null, price: null, fee: '0', amount: '1000', currency: 'KRW', source: 'manual',
    })).rejects.toThrow(/investment_transactions_cash_fields_check/)
  })

  test('rejects kiwoom rows without broker_ref and duplicates of the same broker_ref', async () => {
    await expect(db.insert(investmentTransactions).values({
      householdId: householdIds[0], accountId, securityId, kind: 'buy', tradeDate: '2026-09-01',
      quantity: '1', price: '70000', fee: '0', amount: '-70000', currency: 'KRW', source: 'kiwoom', brokerRef: null,
    })).rejects.toThrow(/investment_transactions_source_ref_check/)
    const row = {
      householdId: householdIds[0], accountId, securityId, kind: 'buy' as const, tradeDate: '2026-09-01',
      quantity: '1', price: '70000', fee: '0', amount: '-70000', currency: 'KRW' as const, source: 'kiwoom' as const, brokerRef: 'F-1',
    }
    await db.insert(investmentTransactions).values(row)
    await expect(db.insert(investmentTransactions).values(row)).rejects.toThrow(/investment_transactions_account_broker_ref/)
  })

  test('securities are unique per household, market and symbol', async () => {
    await expect(db.insert(investmentSecurities).values({
      householdId: householdIds[0], market: 'KR', symbol: '005930', name: '중복', currency: 'KRW', exposureCurrency: 'KRW',
    })).rejects.toThrow(/investment_securities_household_market_symbol/)
  })

  test('authenticated role can only select rows of its own household', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
    try {
      const rows = await sql.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' })}, true)`
        return tx`select id from public.investment_accounts`
      })
      expect(rows).toHaveLength(0)
      await expect(sql.begin(async (tx) => {
        await tx`set local role authenticated`
        await tx`insert into public.investment_accounts (household_id, owner, name, broker, broker_account_no, credential_ref) values (${householdIds[0]}, 'DJ', 'x', 'kiwoom', '1', 'r')`
      })).rejects.toThrow(/permission denied/)
    } finally {
      await sql.end()
    }
  })
})
```

파일 상단에 `import { eq } from 'drizzle-orm'`를 추가한다.

- [x] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project integration tests/integration/investment-schema.test.ts`
Expected: FAIL — `investmentAccounts` export 없음 (모듈 로드 실패).

- [x] **Step 3: 타입 파일 작성**

`src/features/investment/types.ts`:

```ts
export type Market = 'KR' | 'US'
export type Currency = 'KRW' | 'USD'
export type TransactionKind = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdraw' | 'fee' | 'adjust'
export type TransactionSource = 'kiwoom' | 'manual'
export type WeightBasis = 'total_assets' | 'stock_accounts'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ResearchKind = 'security' | 'portfolio' | 'discover'
export type ResearchMode = 'quarterly' | 'monthly' | 'event'
export type SyncKind = 'account' | 'snapshot'

export const TRANSACTION_KINDS: readonly TransactionKind[] = ['buy', 'sell', 'dividend', 'deposit', 'withdraw', 'fee', 'adjust']
export const CASH_KINDS: readonly TransactionKind[] = ['deposit', 'withdraw', 'fee']
export const MARKET_CURRENCY: Record<Market, Currency> = { KR: 'KRW', US: 'USD' }

export const KIND_LABELS: Record<TransactionKind, string> = {
  buy: '매수', sell: '매도', dividend: '배당', deposit: '입금', withdraw: '출금', fee: '수수료', adjust: '정정',
}
export const MARKET_LABELS: Record<Market, string> = { KR: '국내', US: '해외' }

/** 계산 모듈이 받는 거래 행. DB의 numeric은 문자열로 오므로 여기서는 이미 number다. */
export type TransactionRow = {
  id: number
  accountId: number
  securityId: number | null
  kind: TransactionKind
  tradeDate: string
  quantity: number | null
  price: number | null
  fee: number
  amount: number
  currency: Currency
  source: TransactionSource
}

export type SecurityRow = {
  id: number
  market: Market
  symbol: string
  name: string
  currency: Currency
  exposureCurrency: Currency
  sector: string | null
  watching: boolean
}

export type AccountRow = {
  id: number
  owner: string
  name: string
  brokerAccountNo: string
  active: boolean
  lastSyncedAt: string | null
}

export type QuoteRow = { securityId: number; price: number; changeRate: number | null; quotedAt: string }
export type FxRow = { date: string; rate: number }
export type BrokerPositionRow = { accountId: number; securityId: number; quantity: number; avgCost: number; syncedAt: string }
```

- [x] **Step 4: 스키마 파일 작성**

`src/db/schema/investment.ts`:

```ts
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, index, integer, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import type { Currency, JobStatus, Market, ResearchKind, ResearchMode, SyncKind, TransactionKind, TransactionSource, WeightBasis } from '@/features/investment/types'

import { households } from './auth'
import { diagnosisWorkers } from './diagnosis'

const member = (column: unknown) => sql`public.is_member(${column})`

export const investmentAccounts = pgTable('investment_accounts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  broker: text('broker').notNull().default('kiwoom'),
  brokerAccountNo: text('broker_account_no').notNull(),
  credentialRef: text('credential_ref').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_accounts_household_broker_no').on(table.householdId, table.broker, table.brokerAccountNo),
  check('investment_accounts_broker_check', sql`${table.broker} in ('kiwoom')`),
  check('investment_accounts_owner_check', sql`length(${table.owner}) between 1 and 20`),
  pgPolicy('investment_accounts_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentSecurities = pgTable('investment_securities', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  market: text('market').$type<Market>().notNull(),
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  exposureCurrency: text('exposure_currency').$type<Currency>().notNull(),
  sector: text('sector'),
  watching: boolean('watching').notNull().default(false),
  thesis: text('thesis'),
  horizonYears: numeric('horizon_years', { precision: 4, scale: 1 }),
  fundsNeededAt: text('funds_needed_at'),
  lossLimitPct: numeric('loss_limit_pct', { precision: 5, scale: 2 }),
  weightBasis: text('weight_basis').$type<WeightBasis>().notNull().default('stock_accounts'),
  businessType: text('business_type'),
  nextCheckDate: date('next_check_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_securities_household_market_symbol').on(table.householdId, table.market, table.symbol),
  check('investment_securities_market_check', sql`${table.market} in ('KR', 'US')`),
  check('investment_securities_currency_check', sql`${table.currency} in ('KRW', 'USD') and ${table.exposureCurrency} in ('KRW', 'USD')`),
  check('investment_securities_weight_basis_check', sql`${table.weightBasis} in ('total_assets', 'stock_accounts')`),
  check('investment_securities_symbol_check', sql`${table.symbol} ~ '^[A-Z0-9.]{1,12}$'`),
  pgPolicy('investment_securities_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentTransactions = pgTable('investment_transactions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  accountId: bigint('account_id', { mode: 'number' }).notNull().references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).references(() => investmentSecurities.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<TransactionKind>().notNull(),
  tradeDate: date('trade_date').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 6 }),
  price: numeric('price', { precision: 18, scale: 4 }),
  fee: numeric('fee', { precision: 18, scale: 2 }).notNull().default('0'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  source: text('source').$type<TransactionSource>().notNull(),
  brokerRef: text('broker_ref'),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('investment_transactions_account_broker_ref').on(table.accountId, table.brokerRef).where(sql`${table.brokerRef} is not null`),
  index('investment_transactions_household_date_idx').on(table.householdId, table.tradeDate),
  index('investment_transactions_security_idx').on(table.securityId),
  check('investment_transactions_kind_check', sql`${table.kind} in ('buy', 'sell', 'dividend', 'deposit', 'withdraw', 'fee', 'adjust')`),
  check('investment_transactions_currency_check', sql`${table.currency} in ('KRW', 'USD')`),
  check('investment_transactions_source_check', sql`${table.source} in ('kiwoom', 'manual')`),
  check('investment_transactions_trade_fields_check', sql`${table.kind} not in ('buy', 'sell') or (${table.securityId} is not null and ${table.quantity} is not null and ${table.quantity} > 0 and ${table.price} is not null and ${table.price} >= 0)`),
  check('investment_transactions_cash_fields_check', sql`${table.kind} not in ('deposit', 'withdraw', 'fee') or (${table.securityId} is null and ${table.quantity} is null and ${table.price} is null)`),
  check('investment_transactions_dividend_check', sql`${table.kind} <> 'dividend' or ${table.securityId} is not null`),
  check('investment_transactions_adjust_check', sql`${table.kind} <> 'adjust' or (${table.securityId} is not null and ${table.quantity} is not null and ${table.amount} = 0)`),
  check('investment_transactions_source_ref_check', sql`${table.source} <> 'kiwoom' or ${table.brokerRef} is not null`),
  pgPolicy('investment_transactions_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const latestQuotes = pgTable('latest_quotes', {
  securityId: bigint('security_id', { mode: 'number' }).primaryKey().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  price: numeric('price', { precision: 18, scale: 4 }).notNull(),
  changeRate: numeric('change_rate', { precision: 8, scale: 4 }),
  quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
}, (table) => [
  check('latest_quotes_source_check', sql`${table.source} in ('kiwoom_ws', 'kiwoom_rest', 'manual')`),
  pgPolicy('latest_quotes_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const priceSnapshots = pgTable('price_snapshots', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).notNull().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  close: numeric('close', { precision: 18, scale: 4 }).notNull(),
  currency: text('currency').$type<Currency>().notNull(),
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('price_snapshots_security_date').on(table.securityId, table.date),
  pgPolicy('price_snapshots_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const fxRates = pgTable('fx_rates', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  pair: text('pair').notNull().default('USDKRW'),
  rate: numeric('rate', { precision: 12, scale: 4 }).notNull(),
  source: text('source').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('fx_rates_household_pair_date').on(table.householdId, table.pair, table.date),
  check('fx_rates_pair_check', sql`${table.pair} in ('USDKRW')`),
  pgPolicy('fx_rates_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const brokerPositions = pgTable('broker_positions', {
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  accountId: bigint('account_id', { mode: 'number' }).notNull().references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  securityId: bigint('security_id', { mode: 'number' }).notNull().references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
  avgCost: numeric('avg_cost', { precision: 18, scale: 4 }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex('broker_positions_account_security').on(table.accountId, table.securityId),
  pgPolicy('broker_positions_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const investmentSettings = pgTable('investment_settings', {
  householdId: uuid('household_id').primaryKey().references(() => households.id, { onDelete: 'cascade' }),
  researchDailyLimit: integer('research_daily_limit').notNull().default(10),
  researchInstructions: text('research_instructions'),
  advisorInstructions: text('advisor_instructions'),
  discoverInstructions: text('discover_instructions'),
  reportAreas: jsonb('report_areas'),
  revision: integer('revision').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
}, (table) => [
  check('investment_settings_limit_check', sql`${table.researchDailyLimit} between 0 and 100`),
  pgPolicy('investment_settings_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

const jobColumns = {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  requestedBy: uuid('requested_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  workerId: uuid('worker_id').references(() => diagnosisWorkers.id, { onDelete: 'set null' }),
}

export const researchJobs = pgTable('research_jobs', {
  ...jobColumns,
  kind: text('kind').$type<ResearchKind>().notNull(),
  securityId: bigint('security_id', { mode: 'number' }).references(() => investmentSecurities.id, { onDelete: 'cascade' }),
  mode: text('mode').$type<ResearchMode>(),
  question: text('question'),
  promptVersion: text('prompt_version').notNull(),
  snapshot: jsonb('snapshot').notNull(),
  promptInput: jsonb('prompt_input'),
  report: jsonb('report'),
  errorCode: text('error_code'),
}, (table) => [
  uniqueIndex('research_jobs_active_idx').on(table.householdId, table.kind, sql`coalesce(${table.securityId}, 0)`).where(sql`${table.status} in ('queued', 'running')`),
  index('research_jobs_history_idx').on(table.householdId, table.kind, table.securityId, table.createdAt),
  check('research_jobs_kind_check', sql`${table.kind} in ('security', 'portfolio', 'discover')`),
  check('research_jobs_security_check', sql`(${table.kind} = 'security' and ${table.securityId} is not null and ${table.mode} in ('quarterly', 'monthly', 'event')) or (${table.kind} <> 'security' and ${table.securityId} is null and ${table.mode} is null)`),
  check('research_jobs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('research_jobs_error_code_check', sql`${table.errorCode} is null or ${table.errorCode} in ('timeout', 'invalid_output', 'cli_failed', 'worker_stopped', 'lease_expired', 'daily_limit')`),
  check('research_jobs_question_check', sql`${table.question} is null or length(${table.question}) <= 500`),
  check('research_jobs_result_check', sql`(
    (${table.status} in ('queued', 'running') and ${table.report} is null and ${table.errorCode} is null and ${table.completedAt} is null)
    or (${table.status} = 'completed' and ${table.report} is not null and ${table.errorCode} is null and ${table.completedAt} is not null)
    or (${table.status} = 'failed' and ${table.report} is null and ${table.errorCode} is not null and ${table.completedAt} is not null)
  )`),
  pgPolicy('research_jobs_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()

export const syncJobs = pgTable('sync_jobs', {
  ...jobColumns,
  kind: text('kind').$type<SyncKind>().notNull(),
  accountId: bigint('account_id', { mode: 'number' }).references(() => investmentAccounts.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull(),
  result: jsonb('result'),
  errorCode: text('error_code'),
}, (table) => [
  uniqueIndex('sync_jobs_active_idx').on(table.householdId, table.kind, sql`coalesce(${table.accountId}, 0)`).where(sql`${table.status} in ('queued', 'running')`),
  check('sync_jobs_kind_check', sql`${table.kind} in ('account', 'snapshot')`),
  check('sync_jobs_account_check', sql`(${table.kind} = 'account' and ${table.accountId} is not null) or (${table.kind} = 'snapshot' and ${table.accountId} is null)`),
  check('sync_jobs_trigger_check', sql`${table.trigger} in ('user', 'schedule')`),
  check('sync_jobs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
  check('sync_jobs_error_code_check', sql`${table.errorCode} is null or ${table.errorCode} in ('auth_failed', 'rate_limited', 'provider_error', 'timeout', 'worker_stopped', 'lease_expired')`),
  pgPolicy('sync_jobs_member_select', { for: 'select', to: 'authenticated', using: member(table.householdId) }),
]).enableRLS()
```

`src/db/schema/index.ts` 끝에 `export * from './investment'` 추가.

- [x] **Step 5: 마이그레이션 생성 후 GRANT 추가**

Run: `NODE_OPTIONS= pnpm db:generate --name investment`
Expected: `drizzle/0010_investment.sql`과 `drizzle/meta/0010_snapshot.json` 생성, `_journal.json`에 idx 10 추가.

생성된 SQL 끝에 다음을 붙인다(기존 `0008_ai_diagnosis_settings.sql` 규약):

```sql
--> statement-breakpoint
REVOKE ALL ON TABLE public.investment_accounts, public.investment_securities, public.investment_transactions, public.latest_quotes, public.price_snapshots, public.fx_rates, public.broker_positions, public.investment_settings, public.research_jobs, public.sync_jobs FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON TABLE public.investment_accounts, public.investment_securities, public.investment_transactions, public.latest_quotes, public.price_snapshots, public.fx_rates, public.broker_positions, public.investment_settings, public.research_jobs, public.sync_jobs TO authenticated;
```

Run: `NODE_OPTIONS= pnpm db:migrate`
Expected: 오류 없이 적용.

- [x] **Step 6: 테스트 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project integration tests/integration/investment-schema.test.ts`
Expected: 6 passed.

- [x] **Step 7: 게이트와 커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint`

```bash
git add src/db/schema/investment.ts src/db/schema/index.ts src/features/investment/types.ts drizzle/0010_investment.sql drizzle/meta/0010_snapshot.json drizzle/meta/_journal.json tests/integration/investment-schema.test.ts
git commit -m "feat(investment): add portfolio schema with RLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 금액 포맷터

**Files:**
- Create: `src/features/investment/format.ts`
- Test: `tests/finance/investment-format.test.ts`

**Interfaces:**
- Produces: `formatMoney(value: number, currency: Currency): string` ('KRW' → `formatWon` + 없음, 'USD' → `$1,234.56`), `formatSigned(value: number, currency: Currency): string` (`+864,000` / `−$12.30`, 0은 `0`), `formatPct(value: number | null): string` (`+10.1%` / `−5.8%` / `–`), `MINUS = '−'` (U+2212).

- [x] **Step 1: 실패하는 테스트**

`tests/finance/investment-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'

describe('investment formatters', () => {
  it('formats won without decimals and dollars with two', () => {
    expect(formatMoney(9408000, 'KRW')).toBe('9,408,000')
    expect(formatMoney(1965.75, 'USD')).toBe('$1,965.75')
    expect(formatMoney(6444, 'USD')).toBe('$6,444.00')
  })
  it('signs with a real minus sign and keeps zero unsigned', () => {
    expect(formatSigned(864000, 'KRW')).toBe('+864,000')
    expect(formatSigned(-420000, 'KRW')).toBe('−420,000')
    expect(formatSigned(-12.3, 'USD')).toBe('−$12.30')
    expect(formatSigned(0, 'KRW')).toBe('0')
  })
  it('formats percentages to one decimal and dashes null', () => {
    expect(formatPct(10.06)).toBe('+10.1%')
    expect(formatPct(-5.84)).toBe('−5.8%')
    expect(formatPct(0)).toBe('0.0%')
    expect(formatPct(null)).toBe('–')
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-format.test.ts`
Expected: FAIL — 모듈 없음.

- [x] **Step 3: 구현**

`src/features/investment/format.ts`:

```ts
import { formatWon } from '@/lib/finance'

import type { Currency } from './types'

export const MINUS = '−'

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatMoney(value: number, currency: Currency) {
  const abs = Math.abs(value)
  const body = currency === 'USD' ? `$${usd.format(abs)}` : formatWon(abs)
  return value < 0 ? `${MINUS}${body}` : body
}

export function formatSigned(value: number, currency: Currency) {
  if (value === 0) return '0'
  return value > 0 ? `+${formatMoney(value, currency)}` : formatMoney(value, currency)
}

export function formatPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return '–'
  const rounded = Math.round(value * 10) / 10
  const body = `${Math.abs(rounded).toFixed(1)}%`
  if (rounded === 0) return `0.0%`
  return rounded > 0 ? `+${body}` : `${MINUS}${body}`
}
```

- [x] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-format.test.ts`
Expected: 3 passed.

- [x] **Step 5: 커밋**

```bash
git add src/features/investment/format.ts tests/finance/investment-format.test.ts
git commit -m "feat(investment): add currency-aware formatters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: 계산 모듈(포지션·실현손익·예수금·집계)

**Files:**
- Create: `src/features/investment/calculations.ts`
- Test: `tests/finance/investment-calculations.test.ts`

**Interfaces:**
- Consumes: `TransactionRow`, `SecurityRow`, `QuoteRow`, `FxRow`, `BrokerPositionRow` (Task 1 types).
- Produces:
  - `foldPositions(rows: TransactionRow[]): Position[]` — `Position = { accountId, securityId, quantity, avgCost: number | null, costBasis }`. 날짜·id 순으로 접는다.
  - `realizedByTransaction(rows: TransactionRow[]): Map<number, number | null>` — sell 행 id → 실현손익(당시 평균단가 없으면 null).
  - `cashBalances(rows: TransactionRow[]): CashBalance[]` — `{ accountId, currency, amount }`.
  - `valuePositions(positions, securities, quotes, snapshotsCloseBySecurity: Map<number, number>): ValuedPosition[]` — `{ ...Position, market, currency, price: number | null, priceSource: 'quote' | 'close' | 'none', marketValue: number | null, unrealized: number | null, returnPct: number | null }`.
  - `aggregateByMarket(valued: ValuedPosition[], cash: CashBalance[], fx: FxRow | null): MarketSummary` — `{ KR: { value, cost, unrealized, returnPct, count }, US: {...}, cashKRW, cashUSD, totalKRW: number | null, totalUnrealizedKRW: number | null, fxMissing: boolean }`.
  - `weightsKRW(valued, cash, fx): Map<number, number | null>` — securityId → 비중 %.
  - `discrepancies(positions, broker: BrokerPositionRow[], thresholdPct = 3): Discrepancy[]` — `{ accountId, securityId, ourQty, brokerQty, ourAvg, brokerAvg, qtyDiffers, avgDiffPct }`.
  - `round6(n: number): number`.

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/investment-calculations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  aggregateByMarket, cashBalances, discrepancies, foldPositions, realizedByTransaction, valuePositions, weightsKRW,
} from '@/features/investment/calculations'
import type { SecurityRow, TransactionRow } from '@/features/investment/types'

const sec: SecurityRow[] = [
  { id: 1, market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW', sector: null, watching: false },
  { id: 2, market: 'US', symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', exposureCurrency: 'USD', sector: null, watching: false },
]
let nextId = 1
function tx(partial: Partial<TransactionRow> & Pick<TransactionRow, 'kind' | 'tradeDate'>): TransactionRow {
  return { id: nextId++, accountId: 1, securityId: 1, quantity: null, price: null, fee: 0, amount: 0, currency: 'KRW', source: 'manual', ...partial }
}

describe('foldPositions (moving average)', () => {
  it('averages buys including fees and keeps the average on sells', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-07-30', quantity: 20, price: 179000, fee: 1000, amount: -3581000 }),
      tx({ kind: 'buy', tradeDate: '2026-08-12', quantity: 20, price: 185000, fee: 1000, amount: -3701000 }),
      tx({ kind: 'sell', tradeDate: '2026-09-04', quantity: 10, price: 190000, fee: 500, amount: 1899500 }),
    ]
    const [p] = foldPositions(rows)
    expect(p.quantity).toBe(30)
    expect(p.avgCost).toBeCloseTo((3581000 + 3701000) / 40, 6)
    expect(p.costBasis).toBeCloseTo(30 * ((3581000 + 3701000) / 40), 2)
  })

  it('folds in date then id order even when rows arrive shuffled', () => {
    const later = tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 3, price: 100, amount: 300 })
    const earlier = tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 5, price: 80, amount: -400 })
    const [p] = foldPositions([later, earlier])
    expect(p.quantity).toBe(2)
    expect(p.avgCost).toBe(80)
    expect(realizedByTransaction([later, earlier]).get(later.id)).toBe(60)
  })

  it('adjust adds quantity and resets the average only when a price is given', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 10, price: 100, amount: -1000 }),
      tx({ kind: 'adjust', tradeDate: '2026-09-02', quantity: 2, price: null }),
      tx({ kind: 'adjust', tradeDate: '2026-09-03', quantity: 0, price: 120 }),
    ]
    const [p] = foldPositions(rows)
    expect(p.quantity).toBe(12)
    expect(p.avgCost).toBe(120)
  })

  it('drops positions that return to zero and never goes negative', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 3, price: 10, amount: -30 }),
      tx({ kind: 'sell', tradeDate: '2026-09-02', quantity: 3, price: 12, amount: 36 }),
    ]
    expect(foldPositions(rows)).toEqual([])
  })

  it('a sell before any buy leaves avgCost null instead of crashing', () => {
    const rows = [tx({ kind: 'sell', tradeDate: '2026-09-01', quantity: 1, price: 10, amount: 10 })]
    const positions = foldPositions(rows)
    expect(positions).toEqual([])
    expect(realizedByTransaction(rows).get(rows[0].id)).toBeNull()
  })

  it('keeps fractional US quantities to six decimals', () => {
    const rows = [tx({ kind: 'buy', tradeDate: '2026-09-01', securityId: 2, currency: 'USD', quantity: 0.123456789, price: 100, amount: -12.35 })]
    expect(foldPositions(rows)[0].quantity).toBe(0.123457)
  })
})

describe('realizedByTransaction', () => {
  it('is (price − avg) × qty − fee at the time of the sell', () => {
    const rows = [
      tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 30, price: 80000, fee: 0, amount: -2400000 }),
      tx({ kind: 'sell', tradeDate: '2026-09-04', quantity: 30, price: 80700, fee: 500, amount: 2420500 }),
    ]
    expect(realizedByTransaction(rows).get(rows[1].id)).toBe(700 * 30 - 500)
  })
})

describe('cashBalances', () => {
  it('sums signed amounts per account and currency; adjust contributes nothing', () => {
    const rows = [
      tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, amount: 3000000 }),
      tx({ kind: 'buy', tradeDate: '2026-09-02', quantity: 10, price: 100000, fee: 100, amount: -1000100 }),
      tx({ kind: 'dividend', tradeDate: '2026-09-03', securityId: 2, currency: 'USD', amount: 6.63 }),
      tx({ kind: 'adjust', tradeDate: '2026-09-04', quantity: 1, amount: 0 }),
      tx({ kind: 'withdraw', tradeDate: '2026-09-05', securityId: null, accountId: 2, amount: -500 }),
    ]
    expect(cashBalances(rows)).toEqual([
      { accountId: 1, currency: 'KRW', amount: 1999900 },
      { accountId: 1, currency: 'USD', amount: 6.63 },
      { accountId: 2, currency: 'KRW', amount: -500 },
    ])
  })
})

describe('valuePositions and aggregateByMarket', () => {
  const rows = [
    tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 120, price: 71200, amount: -8544000 }),
    tx({ kind: 'buy', tradeDate: '2026-09-01', securityId: 2, currency: 'USD', quantity: 15, price: 118.2, amount: -1773 }),
    tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, amount: 1120000 }),
    tx({ kind: 'deposit', tradeDate: '2026-09-01', securityId: null, currency: 'USD', amount: 640 }),
  ]
  const positions = foldPositions(rows)
  const quotes = [{ securityId: 1, price: 78400, changeRate: -1.2, quotedAt: '2026-09-28T05:32:00Z' }]
  const closes = new Map([[2, 131.05]])

  it('prefers the live quote, falls back to the last close, and marks missing prices', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const kr = valued.find((v) => v.securityId === 1)!
    const us = valued.find((v) => v.securityId === 2)!
    expect(kr.priceSource).toBe('quote'); expect(kr.marketValue).toBe(9408000); expect(kr.unrealized).toBe(864000); expect(kr.returnPct).toBeCloseTo(10.11, 1)
    expect(us.priceSource).toBe('close'); expect(us.marketValue).toBeCloseTo(1965.75, 2)
    const none = valuePositions(positions, sec, [], new Map())
    expect(none[0].priceSource).toBe('none'); expect(none[0].marketValue).toBeNull()
  })

  it('aggregates per market in native currency and converts only the total', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const cash = cashBalances(rows)
    const s = aggregateByMarket(valued, cash, { date: '2026-09-27', rate: 1380.2 })
    expect(s.KR.value).toBe(9408000); expect(s.KR.count).toBe(1)
    expect(s.US.value).toBeCloseTo(1965.75, 2); expect(s.US.unrealized).toBeCloseTo(192.75, 2)
    expect(s.cashKRW).toBe(1120000); expect(s.cashUSD).toBe(640)
    expect(s.totalKRW).toBeCloseTo(9408000 + 1120000 + (1965.75 + 640) * 1380.2, 0)
    expect(s.fxMissing).toBe(false)
  })

  it('without an fx row the total counts won only and flags fxMissing (no NaN)', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const s = aggregateByMarket(valued, cashBalances(rows), null)
    expect(s.fxMissing).toBe(true)
    expect(s.totalKRW).toBe(9408000 + 1120000)
    expect(Number.isNaN(s.totalUnrealizedKRW)).toBe(false)
  })

  it('weights are shares of the won-converted total including cash', () => {
    const valued = valuePositions(positions, sec, quotes, closes)
    const w = weightsKRW(valued, cashBalances(rows), { date: '2026-09-27', rate: 1380.2 })
    const total = 9408000 + 1120000 + (1965.75 + 640) * 1380.2
    expect(w.get(1)).toBeCloseTo(9408000 / total * 100, 3)
    expect(w.get(2)).toBeCloseTo(1965.75 * 1380.2 / total * 100, 3)
  })
})

describe('discrepancies', () => {
  it('flags quantity mismatch or average cost off by 3% or more', () => {
    const positions = foldPositions([tx({ kind: 'buy', tradeDate: '2026-09-01', quantity: 120, price: 71200, amount: -8544000 })])
    const broker = [{ accountId: 1, securityId: 1, quantity: 120, avgCost: 73640, syncedAt: '2026-09-27T07:05:00Z' }]
    const [d] = discrepancies(positions, broker)
    expect(d.qtyDiffers).toBe(false)
    expect(d.avgDiffPct).toBeCloseTo(3.31, 1) // |71,200 − 73,640| / 73,640
    expect(discrepancies(positions, [{ ...broker[0], avgCost: 71500 }])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-calculations.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/features/investment/calculations.ts`:

```ts
import type { BrokerPositionRow, Currency, FxRow, Market, QuoteRow, SecurityRow, TransactionRow } from './types'

export type Position = { accountId: number; securityId: number; quantity: number; avgCost: number | null; costBasis: number }
export type CashBalance = { accountId: number; currency: Currency; amount: number }
export type ValuedPosition = Position & {
  market: Market
  currency: Currency
  price: number | null
  priceSource: 'quote' | 'close' | 'none'
  marketValue: number | null
  unrealized: number | null
  returnPct: number | null
}
export type MarketTotals = { value: number; cost: number; unrealized: number; returnPct: number | null; count: number }
export type MarketSummary = {
  KR: MarketTotals
  US: MarketTotals
  cashKRW: number
  cashUSD: number
  totalKRW: number
  totalUnrealizedKRW: number
  fxMissing: boolean
}
export type Discrepancy = {
  accountId: number; securityId: number
  ourQty: number; brokerQty: number
  ourAvg: number | null; brokerAvg: number
  qtyDiffers: boolean; avgDiffPct: number | null
}

export function round6(n: number) { return Math.round(n * 1e6) / 1e6 }
const round2 = (n: number) => Math.round(n * 100) / 100

function ordered(rows: TransactionRow[]) {
  return [...rows].sort((a, b) => a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : a.id - b.id)
}

/**
 * Walk trades in date order keeping a moving-average cost per (account,
 * security). Sells reduce quantity only; the average survives so the next
 * sell still has a basis. `adjust` adds quantity (may be negative) and, when
 * it carries a price, resets the average to that price.
 */
function walk(rows: TransactionRow[], onSell?: (row: TransactionRow, avgBefore: number | null) => void) {
  const state = new Map<string, Position>()
  for (const row of ordered(rows)) {
    if (row.securityId === null) continue
    if (row.kind !== 'buy' && row.kind !== 'sell' && row.kind !== 'adjust') continue
    const key = `${row.accountId}:${row.securityId}`
    const current = state.get(key) ?? { accountId: row.accountId, securityId: row.securityId, quantity: 0, avgCost: null, costBasis: 0 }
    const qty = row.quantity ?? 0
    if (row.kind === 'buy') {
      const spent = qty * (row.price ?? 0) + row.fee
      const newQty = current.quantity + qty
      current.avgCost = newQty > 0 ? (current.costBasis + spent) / newQty : null
      current.quantity = newQty
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * newQty
    } else if (row.kind === 'sell') {
      onSell?.(row, current.avgCost)
      current.quantity = Math.max(0, current.quantity - qty)
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * current.quantity
    } else {
      current.quantity = Math.max(0, current.quantity + qty)
      if (row.price !== null) current.avgCost = row.price
      current.costBasis = current.avgCost === null ? 0 : current.avgCost * current.quantity
    }
    current.quantity = round6(current.quantity)
    current.costBasis = round2(current.costBasis)
    state.set(key, current)
  }
  return state
}

export function foldPositions(rows: TransactionRow[]): Position[] {
  return [...walk(rows).values()].filter((p) => p.quantity > 0)
}

export function realizedByTransaction(rows: TransactionRow[]) {
  const out = new Map<number, number | null>()
  walk(rows, (row, avgBefore) => {
    if (avgBefore === null || row.price === null || row.quantity === null) { out.set(row.id, null); return }
    out.set(row.id, round2((row.price - avgBefore) * row.quantity - row.fee))
  })
  return out
}

export function cashBalances(rows: TransactionRow[]): CashBalance[] {
  const sums = new Map<string, CashBalance>()
  for (const row of rows) {
    if (row.kind === 'adjust') continue
    const key = `${row.accountId}:${row.currency}`
    const entry = sums.get(key) ?? { accountId: row.accountId, currency: row.currency, amount: 0 }
    entry.amount = round2(entry.amount + row.amount)
    sums.set(key, entry)
  }
  return [...sums.values()].sort((a, b) => a.accountId - b.accountId || a.currency.localeCompare(b.currency))
}

export function valuePositions(
  positions: Position[],
  securities: SecurityRow[],
  quotes: QuoteRow[],
  closeBySecurity: Map<number, number>,
): ValuedPosition[] {
  const secById = new Map(securities.map((s) => [s.id, s]))
  const quoteById = new Map(quotes.map((q) => [q.securityId, q]))
  return positions.flatMap((p) => {
    const security = secById.get(p.securityId)
    if (!security) return []
    const quote = quoteById.get(p.securityId)
    const close = closeBySecurity.get(p.securityId)
    const price = quote ? quote.price : close ?? null
    const priceSource: ValuedPosition['priceSource'] = quote ? 'quote' : close !== undefined ? 'close' : 'none'
    const marketValue = price === null ? null : round2(price * p.quantity)
    const unrealized = marketValue === null ? null : round2(marketValue - p.costBasis)
    const returnPct = unrealized === null || p.costBasis === 0 ? null : unrealized / p.costBasis * 100
    return [{ ...p, market: security.market, currency: security.currency, price, priceSource, marketValue, unrealized, returnPct }]
  })
}

function totals(valued: ValuedPosition[], market: Market): MarketTotals {
  const rows = valued.filter((v) => v.market === market)
  const value = round2(rows.reduce((s, v) => s + (v.marketValue ?? 0), 0))
  const cost = round2(rows.reduce((s, v) => s + (v.marketValue === null ? 0 : v.costBasis), 0))
  const unrealized = round2(value - cost)
  return { value, cost, unrealized, returnPct: cost === 0 ? null : unrealized / cost * 100, count: rows.length }
}

export function aggregateByMarket(valued: ValuedPosition[], cash: CashBalance[], fx: FxRow | null): MarketSummary {
  const KR = totals(valued, 'KR')
  const US = totals(valued, 'US')
  const cashKRW = round2(cash.filter((c) => c.currency === 'KRW').reduce((s, c) => s + c.amount, 0))
  const cashUSD = round2(cash.filter((c) => c.currency === 'USD').reduce((s, c) => s + c.amount, 0))
  const rate = fx?.rate ?? null
  const usdToKrw = (usd: number) => rate === null ? 0 : usd * rate
  return {
    KR, US, cashKRW, cashUSD,
    totalKRW: Math.round(KR.value + cashKRW + usdToKrw(US.value + cashUSD)),
    totalUnrealizedKRW: Math.round(KR.unrealized + usdToKrw(US.unrealized)),
    fxMissing: rate === null,
  }
}

export function weightsKRW(valued: ValuedPosition[], cash: CashBalance[], fx: FxRow | null) {
  const summary = aggregateByMarket(valued, cash, fx)
  const out = new Map<number, number | null>()
  for (const v of valued) {
    if (v.marketValue === null || summary.totalKRW === 0) { out.set(v.securityId, null); continue }
    if (v.currency === 'USD' && fx === null) { out.set(v.securityId, null); continue }
    const krw = v.currency === 'USD' ? v.marketValue * (fx?.rate ?? 0) : v.marketValue
    const previous = out.get(v.securityId) ?? 0
    out.set(v.securityId, (previous ?? 0) + krw / summary.totalKRW * 100)
  }
  return out
}

export function discrepancies(positions: Position[], broker: BrokerPositionRow[], thresholdPct = 3): Discrepancy[] {
  const byKey = new Map(positions.map((p) => [`${p.accountId}:${p.securityId}`, p]))
  const out: Discrepancy[] = []
  for (const b of broker) {
    const ours = byKey.get(`${b.accountId}:${b.securityId}`)
    const ourQty = ours?.quantity ?? 0
    const ourAvg = ours?.avgCost ?? null
    const qtyDiffers = round6(ourQty) !== round6(b.quantity)
    const avgDiffPct = ourAvg === null || b.avgCost === 0 ? null : Math.abs(ourAvg - b.avgCost) / b.avgCost * 100
    if (qtyDiffers || (avgDiffPct !== null && avgDiffPct >= thresholdPct)) {
      out.push({ accountId: b.accountId, securityId: b.securityId, ourQty, brokerQty: b.quantity, ourAvg, brokerAvg: b.avgCost, qtyDiffers, avgDiffPct })
    }
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-calculations.test.ts`
Expected: 12 passed.

- [ ] **Step 5: 커밋**

```bash
git add src/features/investment/calculations.ts tests/finance/investment-calculations.test.ts
git commit -m "feat(investment): add position, cash and market aggregation calculations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: 헤더 공간 전환(가계부 ↔ 투자)

**시각 참조:** `01-holdings-desktop.png` 헤더(브랜드 "↗ 우리집 투자" + 캐럿, 메뉴 다섯 개), `10-holdings-mobile.png` 하단 바. 브랜드 팝오버는 기존 `.finance-popover` 스타일 그대로다.

**Files:**
- Create: `src/features/investment/space.ts`
- Modify: `src/components/app-header-menu.tsx` (전체), `src/components/app-header.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Test: `tests/finance/app-header-space.test.tsx`

**Interfaces:**
- Produces: `type Space = 'ledger' | 'investment'`, `SPACE_COOKIE = 'finance-space'`, `parseSpace(value: string | undefined): Space` (기본 'ledger'). `HeaderSection`에 `'investment' | 'investment-trend' | 'investment-transactions' | 'investment-watch' | 'investment-advisor' | 'investment-settings'` 추가. `AppHeaderMenu`와 `AppHeader`에 `space?: Space` prop(기본 'ledger').
- 투자 공간의 헤더: 브랜드 "↗ 우리집 투자", 주 메뉴 보유·추이·거래·관심·어드바이저, 톱니는 `/investment/settings`, 모바일 하단 바 보유·추이·거래·관심·더보기(더보기에 어드바이저·설정·"가계부로"). 가계부 공간의 헤더는 지금과 동일하고 브랜드 팝오버만 추가된다. 가계부 메뉴에 `투자` 항목은 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/app-header-space.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/investment' }))
vi.mock('@/components/theme-selector', () => ({ ThemeSelector: () => null }))

import { AppHeaderMenu } from '@/components/app-header-menu'
import { parseSpace } from '@/features/investment/space'

describe('parseSpace', () => {
  it('defaults to ledger and accepts investment', () => {
    expect(parseSpace(undefined)).toBe('ledger')
    expect(parseSpace('nonsense')).toBe('ledger')
    expect(parseSpace('investment')).toBe('investment')
  })
})

describe('AppHeaderMenu spaces', () => {
  it('renders the investment brand and menu without ledger links', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="investment" email="a@b.c" pendingInboxCount={0} space="investment" />)
    expect(html).toContain('우리집 투자')
    for (const label of ['보유', '추이', '거래', '관심', '어드바이저']) expect(html).toContain(`>${label}<`)
    expect(html).not.toContain('href="/ledger"')
    expect(html).not.toContain('href="/budgets"')
    expect(html).toContain('href="/investment/settings"')
    expect(html).toMatch(/href="\/investment"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/investment"|is-active[^>]*href="\/investment"/)
  })

  it('keeps the ledger header unchanged and never adds an investment link to it', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="dashboard" email="a@b.c" pendingInboxCount={0} />)
    expect(html).toContain('우리집 가계부')
    expect(html).toContain('href="/ledger"')
    expect(html).not.toContain('href="/investment"')
  })

  it('marks the current space in the brand switcher', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="investment" email="a@b.c" pendingInboxCount={0} space="investment" />)
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="공간 전환"')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/app-header-space.test.tsx`
Expected: FAIL — `@/features/investment/space` 없음, `space` prop 타입 오류.

- [ ] **Step 3: space 헬퍼**

`src/features/investment/space.ts`:

```ts
export type Space = 'ledger' | 'investment'

export const SPACE_COOKIE = 'finance-space'
export const SPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function parseSpace(value: string | undefined): Space {
  return value === 'investment' ? 'investment' : 'ledger'
}

export const SPACE_HOME: Record<Space, string> = { ledger: '/dashboard', investment: '/investment' }
```

- [ ] **Step 4: 헤더 메뉴 수정**

`src/components/app-header-menu.tsx`를 다음으로 바꾼다(기존 팝오버·모바일 로직 유지, 공간별 링크 목록 분리):

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { SPACE_HOME, type Space } from '@/features/investment/space'

import { ThemeSelector } from './theme-selector'

export type HeaderSection =
  | 'assets' | 'budgets' | 'dashboard' | 'inbox' | 'ledger' | 'report' | 'settings'
  | 'investment' | 'investment-trend' | 'investment-transactions' | 'investment-watch' | 'investment-advisor' | 'investment-settings'

type AppHeaderMenuProps = {
  active: HeaderSection
  email: string
  pendingInboxCount: number
  space?: Space
}

type MenuName = 'more' | 'settings' | 'space' | null
type NavLink = { key: HeaderSection; href: string; label: string; mobile?: boolean }

const ledgerLinks: NavLink[] = [
  { key: 'dashboard', href: '/dashboard', label: '홈', mobile: true },
  { key: 'ledger', href: '/ledger', label: '내역', mobile: true },
  { key: 'budgets', href: '/budgets', label: '예산', mobile: true },
  { key: 'assets', href: '/assets', label: '자산' },
  { key: 'report', href: '/report', label: '통계' },
  { key: 'inbox', href: '/inbox', label: '가져오기', mobile: true },
]

const investmentLinks: NavLink[] = [
  { key: 'investment', href: '/investment', label: '보유', mobile: true },
  { key: 'investment-trend', href: '/investment/trend', label: '추이', mobile: true },
  { key: 'investment-transactions', href: '/investment/transactions', label: '거래', mobile: true },
  { key: 'investment-watch', href: '/investment/watch', label: '관심', mobile: true },
  { key: 'investment-advisor', href: '/investment/advisor', label: '어드바이저' },
]

const ledgerSettings: Array<{ href: string; label: string; description: string }> = [
  { href: '/manage?tab=accounts', label: '결제수단', description: '카드와 계좌 관리' },
  { href: '/manage?tab=categories', label: '카테고리', description: '대분류와 소분류 편집' },
  { href: '/manage?tab=rules', label: '가져오기 규칙', description: '가맹점 사전과 결제수단 별칭' },
  { href: '/recurring', label: '정기거래 규칙', description: '정기 수입·지출·저축' },
  { href: '/settings?section=assets', label: '자산 계정', description: '자산 그룹과 계정 이름' },
  { href: '/settings?section=security', label: '계정 및 보안', description: '비밀번호와 로그인 계정' },
]

const investmentSettings: Array<{ href: string; label: string; description: string }> = [
  { href: '/investment/settings', label: '증권 계좌', description: '키움 계좌와 소유자' },
  { href: '/settings?section=security', label: '계정 및 보안', description: '비밀번호와 로그인 계정' },
]

const SPACES: Array<{ key: Space; label: string; mark: string; description: string }> = [
  { key: 'ledger', label: '우리집 가계부', mark: '₩', description: '수입·지출·예산·자산' },
  { key: 'investment', label: '우리집 투자', mark: '↗', description: '보유·헬스체크·어드바이저' },
]

function isMoreSection(space: Space, active: HeaderSection) {
  if (space === 'investment') return active === 'investment-advisor' || active === 'investment-settings'
  return active === 'assets' || active === 'report' || active === 'settings'
}

export function AppHeaderMenu({ active, email, pendingInboxCount, space = 'ledger' }: AppHeaderMenuProps) {
  const pathname = usePathname()
  const [openMenu, setOpenMenu] = useState<MenuName>(null)
  const headerRef = useRef<HTMLElement>(null)
  const previousPathname = useRef(pathname)
  const initials = email.split('@')[0]?.slice(0, 2).toUpperCase() || 'ME'
  const links = space === 'investment' ? investmentLinks : ledgerLinks
  const settingsLinks = space === 'investment' ? investmentSettings : ledgerSettings
  const current = SPACES.find((item) => item.key === space) ?? SPACES[0]
  const other = SPACES.find((item) => item.key !== space) ?? SPACES[1]

  useEffect(() => {
    if (previousPathname.current !== pathname) setOpenMenu(null)
    previousPathname.current = pathname
  }, [pathname])

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const navClass = (selected: boolean) => `finance-nav-link ${selected ? 'is-active' : ''}`
  const toggleMenu = (menu: Exclude<MenuName, null>) => setOpenMenu((value) => value === menu ? null : menu)
  const badge = (link: NavLink) => link.key === 'inbox' && pendingInboxCount > 0 && (
    <span aria-label={`처리할 거래 ${pendingInboxCount}건`} className="finance-count-badge">{pendingInboxCount > 99 ? '99+' : pendingInboxCount}</span>
  )

  return (
    <header className="finance-header" ref={headerRef}>
      <div className="finance-header-inner">
        <div className="finance-popover-wrap">
          <button
            aria-expanded={openMenu === 'space'}
            aria-haspopup="menu"
            aria-label="공간 전환"
            className="finance-brand"
            onClick={() => toggleMenu('space')}
            type="button"
          >
            <span aria-hidden="true" className="finance-brand-mark">{current.mark}</span>
            <span>{current.label}</span>
            <span aria-hidden="true" className="finance-brand-caret">⌄</span>
          </button>
          {openMenu === 'space' && (
            <div className="finance-popover" role="menu">
              {SPACES.map((item) => (
                <Link
                  aria-current={item.key === space ? 'true' : undefined}
                  className={`finance-popover-item ${item.key === space ? 'is-current' : ''}`}
                  href={SPACE_HOME[item.key]}
                  key={item.key}
                  role="menuitem"
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </Link>
              ))}
            </div>
          )}
        </div>

        <nav aria-label="주 메뉴" className="finance-desktop-nav">
          {links.map((link) => (
            <Link aria-current={active === link.key ? 'page' : undefined} className={navClass(active === link.key)} href={link.href} key={link.href}>
              {link.label}{badge(link)}
            </Link>
          ))}
        </nav>

        <div className="finance-user-actions">
          <div onClickCapture={() => setOpenMenu(null)}><ThemeSelector /></div>
          <div className="finance-popover-wrap">
            <button
              aria-expanded={openMenu === 'settings'}
              aria-haspopup="menu"
              aria-label="설정 메뉴"
              className={`finance-settings-button ${active === 'settings' || active === 'investment-settings' ? 'is-active' : ''}`}
              onClick={() => toggleMenu('settings')}
              type="button"
            >
              <span aria-hidden="true">⚙</span>
            </button>
            {openMenu === 'settings' && (
              <div className="finance-popover is-right" role="menu">
                {settingsLinks.map((link) => (
                  <Link className="finance-popover-item" href={link.href} key={link.href} role="menuitem">
                    <span>{link.label}</span>
                    <small>{link.description}</small>
                  </Link>
                ))}
                <div className="finance-popover-account">
                  <span title={email}>{email}</span>
                  <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
                </div>
              </div>
            )}
          </div>
          <span aria-label={email} className="finance-user-initial" title={email}>{initials}</span>
        </div>

        <nav aria-label="모바일 주 메뉴" className="finance-mobile-bottom-nav">
          {links.filter((link) => link.mobile).map((link) => (
            <Link className={navClass(active === link.key)} href={link.href} key={link.href}>
              <span>{link.label}</span>{badge(link)}
            </Link>
          ))}
          <button aria-expanded={openMenu === 'more'} aria-haspopup="menu" className={navClass(isMoreSection(space, active))} onClick={() => toggleMenu('more')} type="button">
            더보기
          </button>
        </nav>

        {openMenu === 'more' && (
          <div className="finance-mobile-more" role="menu">
            <p>업무</p>
            {links.filter((link) => !link.mobile).map((link) => (
              <Link className={navClass(active === link.key)} href={link.href} key={link.href} role="menuitem">{link.label}</Link>
            ))}
            <p>설정</p>
            {settingsLinks.map((link) => (
              <Link className={navClass(active === 'settings' || active === 'investment-settings')} href={link.href} key={link.href} role="menuitem">{link.label}</Link>
            ))}
            <p>공간</p>
            <Link className="finance-nav-link" href={SPACE_HOME[other.key]} role="menuitem">{other.label}로 전환</Link>
            <p>테마</p>
            <ThemeSelector mobile />
            <div className="finance-mobile-account">
              <span title={email}>{email}</span>
              <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
```

`src/components/app-header.tsx`: props에 `space?: Space` 추가, `<AppHeaderMenu ... space={space} />`로 전달. import `type { Space } from '@/features/investment/space'`.

`src/app/globals.css`의 `.finance-brand` 블록 뒤에 추가:

```css
button.finance-brand { cursor: pointer; background: none; border: 0; padding: 0; }
.finance-brand-caret { color: var(--finance-faint); font-size: 12px; font-weight: 400; }
.finance-popover-item.is-current { border-left: 2px solid var(--finance-blue); }
```

`src/app/page.tsx`:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { parseSpace, SPACE_COOKIE, SPACE_HOME } from '@/features/investment/space'

export default async function Home() {
  const store = await cookies()
  redirect(SPACE_HOME[parseSpace(store.get(SPACE_COOKIE)?.value)])
}
```

- [ ] **Step 5: 통과 확인과 게이트**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/app-header-space.test.tsx`
Expected: 4 passed.

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`
Expected: 기존 헤더 관련 테스트 포함 전부 통과. `HeaderSection` 유니온이 커졌으므로 `active`를 문자열 리터럴로 넘기는 기존 페이지는 그대로 컴파일된다.

- [ ] **Step 6: 커밋**

```bash
git add src/features/investment/space.ts src/components/app-header-menu.tsx src/components/app-header.tsx src/app/page.tsx src/app/globals.css tests/finance/app-header-space.test.tsx
git commit -m "feat(header): add ledger/investment space switcher

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: revalidate 도메인과 수동 거래 입력 파서

**Files:**
- Modify: `src/lib/revalidate.ts`
- Create: `src/features/investment/transaction-input.ts`
- Test: `tests/finance/investment-transaction-input.test.ts`, 기존 `tests/finance/revalidate.test.ts`가 있으면 거기에 케이스 추가(없으면 새 파일 `tests/finance/investment-revalidate.test.ts`)

**Interfaces:**
- Produces: `FinanceDomain`에 `'investment'` 추가, `ROUTES`에 `investment: '/investment'`, `investmentTrend: '/investment/trend'`, `investmentTransactions: '/investment/transactions'`, `investmentWatch: '/investment/watch'`, `investmentAdvisor: '/investment/advisor'`, `investmentSettings: '/investment/settings'`. `READERS.investment`는 그 여섯 경로 전부.
- Produces: `parseManualTransaction(formData: FormData, context: { accountIds: number[]; securities: Array<{ id: number; market: Market; currency: Currency }>; today: string }): { data: ManualTransactionInput } | { error: string }`. `ManualTransactionInput = { accountId, securityId: number | null, kind, tradeDate, quantity: number | null, price: number | null, fee: number, amount: number, currency, memo: string | null }`. amount는 파서가 계산한다: buy `-(qty×price+fee)`, sell `+(qty×price−fee)`, dividend/deposit `+|amount|`, withdraw/fee `-|amount|`, adjust `0`.

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/investment-transaction-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { parseManualTransaction } from '@/features/investment/transaction-input'

const ctx = {
  accountIds: [1, 2],
  securities: [
    { id: 10, market: 'KR' as const, currency: 'KRW' as const },
    { id: 20, market: 'US' as const, currency: 'USD' as const },
  ],
  today: '2026-09-29',
}
function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

describe('parseManualTransaction', () => {
  it('computes the signed amount for a buy including fee', () => {
    const result = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '10', price: '70000', fee: '150' }), ctx)
    expect(result).toEqual({ data: { accountId: 1, securityId: 10, kind: 'buy', tradeDate: '2026-09-01', quantity: 10, price: 70000, fee: 150, amount: -700150, currency: 'KRW', memo: null } })
  })
  it('computes sell, dividend, deposit, withdraw and adjust amounts', () => {
    const sell = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'sell', tradeDate: '2026-09-01', quantity: '10', price: '80700', fee: '500' }), ctx)
    expect('data' in sell && sell.data.amount).toBe(806500)
    const dividend = parseManualTransaction(form({ accountId: '2', securityId: '20', kind: 'dividend', tradeDate: '2026-09-01', amount: '6.63' }), ctx)
    expect('data' in dividend && dividend.data).toMatchObject({ amount: 6.63, currency: 'USD', quantity: null, price: null })
    const deposit = parseManualTransaction(form({ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '3000000', currency: 'KRW' }), ctx)
    expect('data' in deposit && deposit.data).toMatchObject({ securityId: null, amount: 3000000 })
    const withdraw = parseManualTransaction(form({ accountId: '1', kind: 'withdraw', tradeDate: '2026-09-01', amount: '500', currency: 'USD' }), ctx)
    expect('data' in withdraw && withdraw.data).toMatchObject({ amount: -500, currency: 'USD' })
    const adjust = parseManualTransaction(form({ accountId: '1', securityId: '10', kind: 'adjust', tradeDate: '2026-09-01', quantity: '-2', price: '73640' }), ctx)
    expect('data' in adjust && adjust.data).toMatchObject({ quantity: -2, price: 73640, amount: 0 })
  })
  it('rejects the inputs a careless form will send', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ accountId: '9', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1' }, /계좌/],
      [{ accountId: '1', securityId: '99', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1' }, /종목/],
      [{ accountId: '1', securityId: '10', kind: 'gift', tradeDate: '2026-09-01' }, /종류/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2027-01-01', quantity: '1', price: '1' }, /날짜/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '1989-12-31', quantity: '1', price: '1' }, /날짜/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '-1', price: '1' }, /수량/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1.1234567', price: '1' }, /소수/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '-1' }, /단가/],
      [{ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '0', currency: 'KRW' }, /금액/],
      [{ accountId: '1', kind: 'deposit', tradeDate: '2026-09-01', amount: '100', currency: 'EUR' }, /통화/],
      [{ accountId: '1', securityId: '20', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', currency: 'KRW' }, /통화/],
      [{ accountId: '1', securityId: '10', kind: 'buy', tradeDate: '2026-09-01', quantity: '1', price: '1', memo: 'x'.repeat(201) }, /메모/],
    ]
    for (const [entries, pattern] of cases) {
      const result = parseManualTransaction(form(entries), ctx)
      expect('error' in result ? result.error : 'no error').toMatch(pattern)
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-transaction-input.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 파서 구현**

`src/features/investment/transaction-input.ts`:

```ts
import { CASH_KINDS, TRANSACTION_KINDS, type Currency, type Market, type TransactionKind } from './types'

export type ManualTransactionInput = {
  accountId: number
  securityId: number | null
  kind: TransactionKind
  tradeDate: string
  quantity: number | null
  price: number | null
  fee: number
  amount: number
  currency: Currency
  memo: string | null
}

type Context = {
  accountIds: number[]
  securities: Array<{ id: number; market: Market; currency: Currency }>
  today: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const round2 = (n: number) => Math.round(n * 100) / 100

function text(data: FormData, key: string) {
  const value = data.get(key)
  return typeof value === 'string' ? value.trim() : ''
}
function num(data: FormData, key: string) {
  const raw = text(data, key)
  if (raw === '') return null
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : Number.NaN
}
function decimals(value: number) {
  const [, frac = ''] = String(value).split('.')
  return frac.length
}

export function parseManualTransaction(data: FormData, context: Context): { data: ManualTransactionInput } | { error: string } {
  const accountId = num(data, 'accountId')
  if (accountId === null || !context.accountIds.includes(accountId)) return { error: '이 가구에 없는 계좌입니다.' }

  const kind = text(data, 'kind') as TransactionKind
  if (!TRANSACTION_KINDS.includes(kind)) return { error: '거래 종류가 올바르지 않습니다.' }

  const tradeDate = text(data, 'tradeDate')
  if (!DATE.test(tradeDate) || tradeDate > context.today || tradeDate < '1990-01-01') return { error: '거래 날짜는 1990-01-01부터 오늘까지만 가능합니다.' }

  const memoRaw = text(data, 'memo')
  if (memoRaw.length > 200) return { error: '메모는 200자까지입니다.' }
  const memo = memoRaw === '' ? null : memoRaw

  const isCash = CASH_KINDS.includes(kind)
  const securityIdRaw = num(data, 'securityId')
  const security = securityIdRaw === null ? null : context.securities.find((s) => s.id === securityIdRaw) ?? null
  if (!isCash && !security) return { error: '이 가구에 없는 종목입니다.' }

  const currencyRaw = text(data, 'currency')
  const currency: Currency | null = security ? security.currency : currencyRaw === 'KRW' || currencyRaw === 'USD' ? currencyRaw : null
  if (currency === null) return { error: '통화는 KRW 또는 USD여야 합니다.' }
  if (security && currencyRaw !== '' && currencyRaw !== security.currency) return { error: `이 종목의 통화는 ${security.currency}입니다.` }

  const fee = num(data, 'fee') ?? 0
  if (Number.isNaN(fee) || fee < 0) return { error: '수수료는 0 이상이어야 합니다.' }

  if (kind === 'buy' || kind === 'sell') {
    const quantity = num(data, 'quantity')
    const price = num(data, 'price')
    if (quantity === null || Number.isNaN(quantity) || quantity <= 0) return { error: '수량은 0보다 커야 합니다.' }
    if (decimals(quantity) > 6) return { error: '수량은 소수 6자리까지입니다.' }
    if (price === null || Number.isNaN(price) || price < 0) return { error: '단가는 0 이상이어야 합니다.' }
    const gross = round2(quantity * price)
    const amount = kind === 'buy' ? -round2(gross + fee) : round2(gross - fee)
    return { data: { accountId, securityId: security!.id, kind, tradeDate, quantity, price, fee, amount, currency, memo } }
  }

  if (kind === 'adjust') {
    const quantity = num(data, 'quantity')
    const price = num(data, 'price')
    if (quantity === null || Number.isNaN(quantity)) return { error: '정정 수량을 입력하세요(±).' }
    if (decimals(quantity) > 6) return { error: '수량은 소수 6자리까지입니다.' }
    if (price !== null && (Number.isNaN(price) || price < 0)) return { error: '정정 후 단가는 0 이상이어야 합니다.' }
    return { data: { accountId, securityId: security!.id, kind, tradeDate, quantity, price, fee: 0, amount: 0, currency, memo } }
  }

  const amountRaw = num(data, 'amount')
  if (amountRaw === null || Number.isNaN(amountRaw) || amountRaw === 0) return { error: '금액은 0이 아니어야 합니다.' }
  const magnitude = round2(Math.abs(amountRaw))
  const amount = kind === 'withdraw' || kind === 'fee' ? -magnitude : magnitude
  return { data: { accountId, securityId: kind === 'dividend' ? security!.id : null, kind, tradeDate, quantity: null, price: null, fee: 0, amount, currency, memo } }
}
```

- [ ] **Step 4: revalidate 확장**

`src/lib/revalidate.ts`의 `ROUTES`에 여섯 경로, `FinanceDomain`에 `'investment'`, `READERS`에 `investment: ['investment', 'investmentTrend', 'investmentTransactions', 'investmentWatch', 'investmentAdvisor', 'investmentSettings']` 추가. 기존 `tests/finance/revalidate.test.ts`가 있으면 `routesToRevalidate(['investment'])`가 여섯 경로를 돌려주고 가계부 경로는 포함하지 않는다는 케이스를 추가한다(없으면 같은 내용의 `tests/finance/investment-revalidate.test.ts`).

- [ ] **Step 5: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-transaction-input.test.ts tests/finance/revalidate.test.ts`
Expected: 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/revalidate.ts src/features/investment/transaction-input.ts tests/finance/investment-transaction-input.test.ts tests/finance/revalidate.test.ts
git commit -m "feat(investment): validate manual transaction input and register routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: 읽기 모델(queries)과 서버 액션

**Files:**
- Create: `src/features/investment/queries.ts`
- Create: `src/features/investment/actions.ts`
- Test: `tests/integration/investment-queries.test.ts`, `tests/integration/investment-actions.test.ts`

**Interfaces:**
- Consumes: Task 1 테이블, Task 3 계산, Task 5 파서.
- Produces (queries, 모두 `householdId` 첫 인자):
  - `loadPortfolioInputs(householdId): Promise<PortfolioInputs>` — `{ accounts: AccountRow[], securities: SecurityRow[], transactions: TransactionRow[], quotes: QuoteRow[], closes: Map<number, number>, fx: FxRow | null, broker: BrokerPositionRow[], quotedAt: string | null, lastSyncedAt: string | null }`. numeric 문자열을 `Number()`로 바꾼다.
  - `getHoldingsData(householdId, owner?: string): Promise<HoldingsData>` — `{ status: StatusLine, summary: MarketSummary, groups: AccountGroup[], attention: AttentionItem[], securitiesCount: { KR: number; US: number } }`. `AccountGroup = { account: AccountRow, cashKRW, cashUSD, markets: Array<{ market: Market, count, value, unrealized, returnPct, valueKRW: number | null, rows: HoldingRow[] }> }`. `HoldingRow = ValuedPosition & { security: SecurityRow, weightPct: number | null, discrepancy: Discrepancy | null }`. `AttentionItem = { kind: 'discrepancy', securityId, title, detail, href }` (1단계는 괴리만; 2·3단계에서 종류 추가). `StatusLine = { quotedAt: string | null, fx: FxRow | null, lastSyncedAt: string | null, workerConnected: false }`.
  - `getTransactionsData(householdId, month: string, market: Market | 'all', owner?): Promise<TransactionsData>` — `{ month, rows: TransactionListRow[], realizedKRW, realizedUSD, dividendKRW, dividendUSD, netCashKRW, netCashUSD }`. `TransactionListRow = TransactionRow & { accountName, security: { market, symbol, name } | null, realized: number | null, editable: boolean }`.
  - `getWatchData(householdId): Promise<WatchRow[]>` — `{ security: SecurityRow, price: number | null, changeRate: number | null }` (watching=true이고 포지션 없음).
  - `getTrendData(householdId, range: '1m' | '3m' | '1y' | 'all', scope: 'total' | 'KR' | 'US'): Promise<TrendData>` — `{ points: Array<{ date, value, cost }>, allocation: Array<{ label, pct }>, empty: boolean }`. 1단계는 price_snapshots·fx_rates가 비어 있으면 `empty: true`와 현재 포지션 기준 allocation만.
  - `getSecurityDetail(householdId, securityId): Promise<SecurityDetail | null>` — `{ security: SecurityRow & { thesis, horizonYears, fundsNeededAt, lossLimitPct, weightBasis, businessType, nextCheckDate }, positions: HoldingRow[] (계좌별), price: number | null, changeRate, transactions: TransactionListRow[], neighbors: { prev: { id, name } | null, next: ... } }`.
  - `getInvestmentSettingsData(householdId): Promise<{ accounts: AccountRow[] }>`.
- Produces (actions, `'use server'`, 모두 `requireHousehold()` 후 동작, 실패는 `{ error }`):
  - `saveInvestmentAccount(prev, formData): Promise<AccountActionState>` — 필드 `id?`, `owner`, `name`, `brokerAccountNo`, `credentialRef`, `active`. `revalidateFinance('investment')`.
  - `saveManualTransaction(prev, formData): Promise<TransactionActionState>` — Task 5 파서 → 매도면 현재 포지션 수량 검사 → insert(source 'manual') → `revalidateFinance('investment')`. 반환 `{ saved?: { id }, error? }`.
  - `updateTransactionMemo(prev, formData)` — `id`, `memo`. source 무관하게 memo만 갱신.
  - `deleteManualTransaction(prev, formData)` — source='manual'만 삭제, 삭제 후 해당 종목 포지션이 음수가 되면 거부.
  - `addWatchSecurity(prev, formData)` — `market`, `symbol`, `name?`. symbol 대문자 정규화, `MARKET_CURRENCY[market]`, 이미 있으면 `watching=true`로 갱신.
  - `saveHoldingMemo(prev, formData)` — `securityId`, `thesis`, `horizonYears`, `fundsNeededAt`, `lossLimitPct`, `weightBasis`.

- [ ] **Step 1: 실패하는 통합 테스트(쿼리)**

`tests/integration/investment-queries.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { db } from '@/db/client'
import { fxRates, households, investmentAccounts, investmentSecurities, investmentTransactions, latestQuotes } from '@/db/schema'
import { getHoldingsData, getSecurityDetail, getTransactionsData, getTrendData, getWatchData } from '@/features/investment/queries'

let householdId = ''
let otherHouseholdId = ''
let dj = 0, yj = 0, samsung = 0, nvda = 0, amat = 0

beforeAll(async () => {
  const created = await db.insert(households).values([{ name: 'TEST-invest-queries' }, { name: 'TEST-invest-queries-other' }]).returning({ id: households.id })
  householdId = created[0].id; otherHouseholdId = created[1].id
  const accounts = await db.insert(investmentAccounts).values([
    { householdId, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '1234', credentialRef: 'dj', sortOrder: 1 },
    { householdId, owner: 'YJ', name: 'YJ 키움 종합', brokerAccountNo: '5678', credentialRef: 'yj', sortOrder: 2 },
  ]).returning({ id: investmentAccounts.id })
  dj = accounts[0].id; yj = accounts[1].id
  const securities = await db.insert(investmentSecurities).values([
    { householdId, market: 'KR', symbol: '005930', name: '삼성전자', currency: 'KRW', exposureCurrency: 'KRW' },
    { householdId, market: 'US', symbol: 'NVDA', name: 'NVIDIA', currency: 'USD', exposureCurrency: 'USD' },
    { householdId, market: 'US', symbol: 'AMAT', name: 'Applied Materials', currency: 'USD', exposureCurrency: 'USD', watching: true },
    { householdId: otherHouseholdId, market: 'KR', symbol: '000660', name: '남의 종목', currency: 'KRW', exposureCurrency: 'KRW' },
  ]).returning({ id: investmentSecurities.id })
  samsung = securities[0].id; nvda = securities[1].id; amat = securities[2].id
  await db.insert(investmentTransactions).values([
    { householdId, accountId: dj, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', amount: '10000000', currency: 'KRW', source: 'manual' },
    { householdId, accountId: dj, securityId: samsung, kind: 'buy', tradeDate: '2026-09-02', quantity: '120', price: '71200', fee: '0', amount: '-8544000', currency: 'KRW', source: 'manual' },
    { householdId, accountId: dj, securityId: samsung, kind: 'sell', tradeDate: '2026-09-04', quantity: '30', price: '80700', fee: '500', amount: '2420500', currency: 'KRW', source: 'kiwoom', brokerRef: 'F-1' },
    { householdId, accountId: yj, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', amount: '2000', currency: 'USD', source: 'manual' },
    { householdId, accountId: yj, securityId: nvda, kind: 'buy', tradeDate: '2026-09-03', quantity: '15', price: '118.2', fee: '0', amount: '-1773', currency: 'USD', source: 'manual' },
  ])
  await db.insert(latestQuotes).values([
    { securityId: samsung, householdId, price: '78400', changeRate: '-1.2', quotedAt: new Date('2026-09-28T05:32:00Z'), source: 'manual' },
    { securityId: nvda, householdId, price: '131.05', changeRate: '0.8', quotedAt: new Date('2026-09-27T20:00:00Z'), source: 'manual' },
  ])
  await db.insert(fxRates).values({ householdId, date: '2026-09-27', pair: 'USDKRW', rate: '1380.2', source: 'manual' })
})

afterAll(async () => {
  await db.delete(households).where(eq(households.id, householdId))
  await db.delete(households).where(eq(households.id, otherHouseholdId))
})

describe('getHoldingsData', () => {
  test('groups by account then market, values in native currency, converts only totals', async () => {
    const data = await getHoldingsData(householdId)
    expect(data.groups.map((g) => g.account.name)).toEqual(['DJ 키움 종합', 'YJ 키움 종합'])
    const djKR = data.groups[0].markets.find((m) => m.market === 'KR')!
    expect(djKR.rows[0].quantity).toBe(90)
    expect(djKR.rows[0].avgCost).toBe(71200)
    expect(djKR.value).toBe(90 * 78400)
    expect(data.groups[0].cashKRW).toBe(10000000 - 8544000 + 2420500)
    const yjUS = data.groups[1].markets.find((m) => m.market === 'US')!
    expect(yjUS.value).toBeCloseTo(15 * 131.05, 2)
    expect(yjUS.valueKRW).toBe(Math.round(15 * 131.05 * 1380.2))
    expect(data.summary.fxMissing).toBe(false)
    expect(data.status.fx?.rate).toBe(1380.2)
    expect(data.securitiesCount).toEqual({ KR: 1, US: 1 })
  })
  test('owner filter keeps only that owner\'s accounts and never leaks other households', async () => {
    const data = await getHoldingsData(householdId, 'YJ')
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].account.owner).toBe('YJ')
    const other = await getHoldingsData(otherHouseholdId)
    expect(other.groups).toEqual([])
  })
})

describe('getTransactionsData', () => {
  test('lists the month, computes realized on sells, and flags kiwoom rows as memo-only', async () => {
    const data = await getTransactionsData(householdId, '2026-09', 'all')
    expect(data.rows).toHaveLength(5)
    const sell = data.rows.find((r) => r.kind === 'sell')!
    expect(sell.realized).toBe((80700 - 71200) * 30 - 500)
    expect(sell.editable).toBe(false)
    expect(data.realizedKRW).toBe(sell.realized)
    expect(data.realizedUSD).toBe(0)
    expect(data.netCashKRW).toBe(10000000)
    expect(data.netCashUSD).toBe(2000)
    expect((await getTransactionsData(householdId, '2026-09', 'US')).rows.every((r) => r.currency === 'USD')).toBe(true)
    expect((await getTransactionsData(householdId, '2026-08', 'all')).rows).toEqual([])
  })
})

describe('getWatchData / getTrendData / getSecurityDetail', () => {
  test('watch lists watching securities without a position', async () => {
    const rows = await getWatchData(householdId)
    expect(rows.map((r) => r.security.symbol)).toEqual(['AMAT'])
  })
  test('trend is empty without snapshots but allocation reflects current positions', async () => {
    const data = await getTrendData(householdId, '3m', 'total')
    expect(data.empty).toBe(true)
    expect(data.allocation.map((a) => a.label)).toEqual(['국내 주식', '해외 주식', '원화 예수금', '달러 예수금'])
    expect(data.allocation.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(100, 6)
  })
  test('security detail carries positions, its transactions and neighbors', async () => {
    const detail = await getSecurityDetail(householdId, samsung)
    expect(detail?.positions[0].quantity).toBe(90)
    expect(detail?.transactions).toHaveLength(2)
    // 이웃은 시장·종목코드 순: KR 005930 → US AMAT → US NVDA
    expect(detail?.neighbors.next?.id).toBe(amat)
    expect((await getSecurityDetail(householdId, nvda))?.neighbors.prev?.id).toBe(amat)
    expect(await getSecurityDetail(otherHouseholdId, samsung)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패하는 통합 테스트(액션)**

`tests/integration/investment-actions.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { households, investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'
import { addWatchSecurity, deleteManualTransaction, saveHoldingMemo, saveInvestmentAccount, saveManualTransaction } from '@/features/investment/actions'

const context = vi.hoisted(() => ({ householdId: '' }))
vi.mock('@/lib/household', () => ({ requireHousehold: async () => ({ userId: 'invest-actions-user', householdId: context.householdId, email: 't@example.com' }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}
let accountId = 0
let securityId = 0

beforeAll(async () => {
  const [household] = await db.insert(households).values({ name: 'TEST-invest-actions' }).returning({ id: households.id })
  context.householdId = household.id
})
afterAll(async () => { await db.delete(households).where(eq(households.id, context.householdId)) })

describe('investment actions', () => {
  test('saveInvestmentAccount creates and updates an account', async () => {
    const created = await saveInvestmentAccount({}, form({ owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom' }))
    expect(created.error).toBeUndefined()
    const [row] = await db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, context.householdId))
    accountId = row.id
    expect(row.name).toBe('DJ 키움 종합')
    const updated = await saveInvestmentAccount({}, form({ id: String(accountId), owner: 'DJ', name: 'DJ 키움', brokerAccountNo: '12345678', credentialRef: 'dj-kiwoom', active: 'on' }))
    expect(updated.error).toBeUndefined()
    const [after] = await db.select().from(investmentAccounts).where(eq(investmentAccounts.id, accountId))
    expect(after.name).toBe('DJ 키움')
  })

  test('addWatchSecurity normalizes the symbol and is idempotent', async () => {
    expect((await addWatchSecurity({}, form({ market: 'KR', symbol: '005930', name: '삼성전자' }))).error).toBeUndefined()
    expect((await addWatchSecurity({}, form({ market: 'KR', symbol: ' 005930 ' }))).error).toBeUndefined()
    const rows = await db.select().from(investmentSecurities).where(eq(investmentSecurities.householdId, context.householdId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ symbol: '005930', currency: 'KRW', exposureCurrency: 'KRW', watching: true })
    securityId = rows[0].id
    expect((await addWatchSecurity({}, form({ market: 'US', symbol: 'bad symbol!' }))).error).toMatch(/종목코드/)
  })

  test('saveManualTransaction inserts buys and refuses to oversell', async () => {
    const buy = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'buy', tradeDate: '2026-09-01', quantity: '40', price: '70000', fee: '100' }))
    expect(buy.error).toBeUndefined()
    const over = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'sell', tradeDate: '2026-09-02', quantity: '41', price: '71000' }))
    expect(over.error).toMatch(/보유 40주보다 많이 팔 수 없습니다/)
    const ok = await saveManualTransaction({}, form({ accountId: String(accountId), securityId: String(securityId), kind: 'sell', tradeDate: '2026-09-02', quantity: '10', price: '71000' }))
    expect(ok.error).toBeUndefined()
    const rows = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, context.householdId))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.source === 'manual')).toBe(true)
  })

  test('deleteManualTransaction refuses when it would leave a negative position', async () => {
    const rows = await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, context.householdId))
    const buy = rows.find((r) => r.kind === 'buy')!
    const sell = rows.find((r) => r.kind === 'sell')!
    expect((await deleteManualTransaction({}, form({ id: String(buy.id) }))).error).toMatch(/보유 수량이 음수/)
    expect((await deleteManualTransaction({}, form({ id: String(sell.id) }))).error).toBeUndefined()
  })

  test('saveHoldingMemo stores thesis fields and rejects an out-of-range loss limit', async () => {
    const ok = await saveHoldingMemo({}, form({ securityId: String(securityId), thesis: 'HBM 수요', horizonYears: '5', fundsNeededAt: '2031 이후', lossLimitPct: '', weightBasis: 'stock_accounts' }))
    expect(ok.error).toBeUndefined()
    const [row] = await db.select().from(investmentSecurities).where(eq(investmentSecurities.id, securityId))
    expect(row.thesis).toBe('HBM 수요'); expect(row.horizonYears).toBe('5.0'); expect(row.lossLimitPct).toBeNull()
    expect((await saveHoldingMemo({}, form({ securityId: String(securityId), lossLimitPct: '150', weightBasis: 'stock_accounts' }))).error).toMatch(/손실 한도/)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project integration tests/integration/investment-queries.test.ts tests/integration/investment-actions.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: queries 구현**

`src/features/investment/queries.ts`:

```ts
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'

import { db } from '@/db/client'
import { brokerPositions, fxRates, investmentAccounts, investmentSecurities, investmentTransactions, latestQuotes, priceSnapshots } from '@/db/schema'
import { monthBounds } from '@/lib/finance'

import {
  aggregateByMarket, cashBalances, discrepancies, foldPositions, realizedByTransaction, valuePositions, weightsKRW,
  type Discrepancy, type MarketSummary, type ValuedPosition,
} from './calculations'
import type { AccountRow, BrokerPositionRow, FxRow, Market, QuoteRow, SecurityRow, TransactionRow } from './types'

const n = (value: string | null | undefined) => value === null || value === undefined ? null : Number(value)
const n0 = (value: string | null | undefined) => Number(value ?? 0)
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null

export type StatusLine = { quotedAt: string | null; fx: FxRow | null; lastSyncedAt: string | null; workerConnected: boolean }
export type HoldingRow = ValuedPosition & { security: SecurityRow; weightPct: number | null; discrepancy: Discrepancy | null }
export type MarketGroup = { market: Market; count: number; value: number; unrealized: number; returnPct: number | null; valueKRW: number | null; rows: HoldingRow[] }
export type AccountGroup = { account: AccountRow; cashKRW: number; cashUSD: number; markets: MarketGroup[] }
export type AttentionItem = { kind: 'discrepancy'; securityId: number; title: string; detail: string; href: string }
export type HoldingsData = { status: StatusLine; summary: MarketSummary; groups: AccountGroup[]; attention: AttentionItem[]; securitiesCount: Record<Market, number> }
export type TransactionListRow = TransactionRow & { accountName: string; brokerRef: string | null; memo: string | null; security: { market: Market; symbol: string; name: string } | null; realized: number | null; editable: boolean }
export type TransactionsData = { month: string; rows: TransactionListRow[]; realizedKRW: number; realizedUSD: number; dividendKRW: number; dividendUSD: number; netCashKRW: number; netCashUSD: number }
export type WatchRow = { security: SecurityRow; price: number | null; changeRate: number | null }
export type TrendData = { points: Array<{ date: string; value: number; cost: number }>; allocation: Array<{ label: string; pct: number }>; empty: boolean }
export type SecurityDetail = {
  security: SecurityRow & { thesis: string | null; horizonYears: number | null; fundsNeededAt: string | null; lossLimitPct: number | null; weightBasis: 'total_assets' | 'stock_accounts'; businessType: string | null; nextCheckDate: string | null }
  positions: HoldingRow[]
  price: number | null
  changeRate: number | null
  transactions: TransactionListRow[]
  neighbors: { prev: { id: number; name: string } | null; next: { id: number; name: string } | null }
}
export type PortfolioInputs = {
  accounts: AccountRow[]; securities: SecurityRow[]; transactions: TransactionRow[]; quotes: QuoteRow[]
  closes: Map<number, number>; fx: FxRow | null; broker: BrokerPositionRow[]; quotedAt: string | null; lastSyncedAt: string | null
}

const securityColumns = {
  id: investmentSecurities.id, market: investmentSecurities.market, symbol: investmentSecurities.symbol, name: investmentSecurities.name,
  currency: investmentSecurities.currency, exposureCurrency: investmentSecurities.exposureCurrency, sector: investmentSecurities.sector, watching: investmentSecurities.watching,
}

export async function loadPortfolioInputs(householdId: string): Promise<PortfolioInputs> {
  const [accountRows, securities, txRows, quoteRows, closeRows, fxRow, brokerRows] = await Promise.all([
    db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, householdId)).orderBy(asc(investmentAccounts.sortOrder), asc(investmentAccounts.id)),
    db.select(securityColumns).from(investmentSecurities).where(eq(investmentSecurities.householdId, householdId)).orderBy(asc(investmentSecurities.market), asc(investmentSecurities.symbol)),
    db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId)),
    db.select().from(latestQuotes).where(eq(latestQuotes.householdId, householdId)),
    db.select({ securityId: priceSnapshots.securityId, close: priceSnapshots.close })
      .from(priceSnapshots).where(eq(priceSnapshots.householdId, householdId))
      .orderBy(asc(priceSnapshots.securityId), desc(priceSnapshots.date)),
    db.select().from(fxRates).where(and(eq(fxRates.householdId, householdId), eq(fxRates.pair, 'USDKRW'))).orderBy(desc(fxRates.date)).limit(1),
    db.select().from(brokerPositions).where(eq(brokerPositions.householdId, householdId)),
  ])
  const closes = new Map<number, number>()
  for (const row of closeRows) if (!closes.has(row.securityId)) closes.set(row.securityId, Number(row.close))
  const quotes: QuoteRow[] = quoteRows.map((q) => ({ securityId: q.securityId, price: Number(q.price), changeRate: n(q.changeRate), quotedAt: q.quotedAt.toISOString() }))
  const quotedAt = quotes.reduce<string | null>((latest, q) => latest === null || q.quotedAt > latest ? q.quotedAt : latest, null)
  const accounts: AccountRow[] = accountRows.map((a) => ({ id: a.id, owner: a.owner, name: a.name, brokerAccountNo: a.brokerAccountNo, active: a.active, lastSyncedAt: iso(a.lastSyncedAt) }))
  return {
    accounts,
    securities: securities as SecurityRow[],
    transactions: txRows.map((t) => ({
      id: t.id, accountId: t.accountId, securityId: t.securityId, kind: t.kind, tradeDate: t.tradeDate,
      quantity: n(t.quantity), price: n(t.price), fee: n0(t.fee), amount: n0(t.amount), currency: t.currency, source: t.source,
    })),
    quotes, closes,
    fx: fxRow[0] ? { date: fxRow[0].date, rate: Number(fxRow[0].rate) } : null,
    broker: brokerRows.map((b) => ({ accountId: b.accountId, securityId: b.securityId, quantity: Number(b.quantity), avgCost: Number(b.avgCost), syncedAt: b.syncedAt.toISOString() })),
    quotedAt,
    lastSyncedAt: accounts.reduce<string | null>((latest, a) => a.lastSyncedAt && (latest === null || a.lastSyncedAt > latest) ? a.lastSyncedAt : latest, null),
  }
}

function status(inputs: PortfolioInputs): StatusLine {
  return { quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }
}

function marketGroups(rows: HoldingRow[], fx: FxRow | null): MarketGroup[] {
  return (['KR', 'US'] as Market[]).flatMap((market) => {
    const group = rows.filter((r) => r.market === market)
    if (group.length === 0) return []
    const value = group.reduce((s, r) => s + (r.marketValue ?? 0), 0)
    const cost = group.reduce((s, r) => s + (r.marketValue === null ? 0 : r.costBasis), 0)
    const unrealized = value - cost
    const valueKRW = market === 'KR' ? Math.round(value) : fx ? Math.round(value * fx.rate) : null
    return [{ market, count: group.length, value, unrealized, returnPct: cost === 0 ? null : unrealized / cost * 100, valueKRW, rows: group }]
  })
}

export async function getHoldingsData(householdId: string, owner?: string): Promise<HoldingsData> {
  const inputs = await loadPortfolioInputs(householdId)
  const accounts = inputs.accounts.filter((a) => a.active && (!owner || a.owner === owner))
  const accountIds = new Set(accounts.map((a) => a.id))
  const transactions = inputs.transactions.filter((t) => accountIds.has(t.accountId))
  const positions = foldPositions(transactions)
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const cash = cashBalances(transactions)
  const weights = weightsKRW(valued, cash, inputs.fx)
  const diffs = discrepancies(positions, inputs.broker.filter((b) => accountIds.has(b.accountId)))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const rows: HoldingRow[] = valued.map((v) => ({
    ...v, security: secById.get(v.securityId)!, weightPct: weights.get(v.securityId) ?? null,
    discrepancy: diffs.find((d) => d.accountId === v.accountId && d.securityId === v.securityId) ?? null,
  }))
  const groups: AccountGroup[] = accounts.map((account) => ({
    account,
    cashKRW: cash.find((c) => c.accountId === account.id && c.currency === 'KRW')?.amount ?? 0,
    cashUSD: cash.find((c) => c.accountId === account.id && c.currency === 'USD')?.amount ?? 0,
    markets: marketGroups(rows.filter((r) => r.accountId === account.id), inputs.fx),
  }))
  const attention: AttentionItem[] = diffs.map((d) => {
    const security = secById.get(d.securityId)!
    const detail = d.qtyDiffers
      ? `수량이 증권사(${d.brokerQty})와 다름 · 우리 ${d.ourQty}`
      : `평균단가가 증권사 값과 ${d.avgDiffPct!.toFixed(1)}% 차이 · 정정 필요 여부 확인`
    return { kind: 'discrepancy', securityId: d.securityId, title: security.name, detail, href: `/investment/${security.id}` }
  })
  const held = new Set(rows.map((r) => r.securityId))
  const securitiesCount = { KR: 0, US: 0 } as Record<Market, number>
  for (const id of held) securitiesCount[secById.get(id)!.market] += 1
  return { status: status(inputs), summary: aggregateByMarket(valued, cash, inputs.fx), groups, attention, securitiesCount }
}

function listRows(inputs: PortfolioInputs, transactions: TransactionRow[], raw: Array<{ id: number; brokerRef: string | null; memo: string | null }>): TransactionListRow[] {
  const realized = realizedByTransaction(inputs.transactions)
  const accountName = new Map(inputs.accounts.map((a) => [a.id, a.name]))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const rawById = new Map(raw.map((r) => [r.id, r]))
  return transactions
    .sort((a, b) => a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : b.id - a.id)
    .map((t) => {
      const security = t.securityId === null ? null : secById.get(t.securityId) ?? null
      return {
        ...t, accountName: accountName.get(t.accountId) ?? '', brokerRef: rawById.get(t.id)?.brokerRef ?? null, memo: rawById.get(t.id)?.memo ?? null,
        security: security ? { market: security.market, symbol: security.symbol, name: security.name } : null,
        realized: t.kind === 'sell' ? realized.get(t.id) ?? null : null, editable: t.source === 'manual',
      }
    })
}

export async function getTransactionsData(householdId: string, month: string, market: Market | 'all', owner?: string): Promise<TransactionsData> {
  const inputs = await loadPortfolioInputs(householdId)
  const { start, end } = monthBounds(month)
  const raw = await db.select({ id: investmentTransactions.id, brokerRef: investmentTransactions.brokerRef, memo: investmentTransactions.memo })
    .from(investmentTransactions)
    .where(and(eq(investmentTransactions.householdId, householdId), gte(investmentTransactions.tradeDate, start), lte(investmentTransactions.tradeDate, end)))
  const accountIds = new Set(inputs.accounts.filter((a) => !owner || a.owner === owner).map((a) => a.id))
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const inMonth = inputs.transactions.filter((t) => t.tradeDate >= start && t.tradeDate <= end && accountIds.has(t.accountId))
    .filter((t) => market === 'all' || (t.securityId === null ? (market === 'KR' ? t.currency === 'KRW' : t.currency === 'USD') : secById.get(t.securityId)?.market === market))
  const rows = listRows(inputs, inMonth, raw)
  const sum = (predicate: (r: TransactionListRow) => boolean, pick: (r: TransactionListRow) => number) => Math.round(rows.filter(predicate).reduce((s, r) => s + pick(r), 0) * 100) / 100
  return {
    month, rows,
    realizedKRW: sum((r) => r.kind === 'sell' && r.currency === 'KRW', (r) => r.realized ?? 0),
    realizedUSD: sum((r) => r.kind === 'sell' && r.currency === 'USD', (r) => r.realized ?? 0),
    dividendKRW: sum((r) => r.kind === 'dividend' && r.currency === 'KRW', (r) => r.amount),
    dividendUSD: sum((r) => r.kind === 'dividend' && r.currency === 'USD', (r) => r.amount),
    netCashKRW: sum((r) => (r.kind === 'deposit' || r.kind === 'withdraw') && r.currency === 'KRW', (r) => r.amount),
    netCashUSD: sum((r) => (r.kind === 'deposit' || r.kind === 'withdraw') && r.currency === 'USD', (r) => r.amount),
  }
}

export async function getWatchData(householdId: string): Promise<WatchRow[]> {
  const inputs = await loadPortfolioInputs(householdId)
  const held = new Set(foldPositions(inputs.transactions).map((p) => p.securityId))
  const quoteById = new Map(inputs.quotes.map((q) => [q.securityId, q]))
  return inputs.securities.filter((s) => s.watching && !held.has(s.id)).map((security) => ({
    security, price: quoteById.get(security.id)?.price ?? inputs.closes.get(security.id) ?? null, changeRate: quoteById.get(security.id)?.changeRate ?? null,
  }))
}

const RANGE_DAYS = { '1m': 31, '3m': 92, '1y': 366, all: 36500 } as const

export async function getTrendData(householdId: string, range: keyof typeof RANGE_DAYS, scope: 'total' | Market): Promise<TrendData> {
  const inputs = await loadPortfolioInputs(householdId)
  const positions = foldPositions(inputs.transactions)
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const cash = cashBalances(inputs.transactions)
  const summary = aggregateByMarket(valued, cash, inputs.fx)
  const toKRW = (usd: number) => inputs.fx ? usd * inputs.fx.rate : 0
  const parts = [
    { label: '국내 주식', krw: summary.KR.value }, { label: '해외 주식', krw: toKRW(summary.US.value) },
    { label: '원화 예수금', krw: summary.cashKRW }, { label: '달러 예수금', krw: toKRW(summary.cashUSD) },
  ]
  const total = parts.reduce((s, p) => s + p.krw, 0)
  const allocation = parts.map((p) => ({ label: p.label, pct: total === 0 ? 0 : p.krw / total * 100 }))
  // 1단계: 일별 스냅샷은 2단계 워커가 채운다. 스냅샷이 있으면 종목별 종가 × 그날 수량으로 재구성한다.
  const since = new Date(); since.setDate(since.getDate() - RANGE_DAYS[range])
  const sinceKey = since.toISOString().slice(0, 10)
  const snapshots = await db.select({ securityId: priceSnapshots.securityId, date: priceSnapshots.date, close: priceSnapshots.close })
    .from(priceSnapshots).where(and(eq(priceSnapshots.householdId, householdId), gte(priceSnapshots.date, sinceKey))).orderBy(asc(priceSnapshots.date))
  if (snapshots.length === 0) return { points: [], allocation, empty: true }
  const secById = new Map(inputs.securities.map((s) => [s.id, s]))
  const dates = [...new Set(snapshots.map((s) => s.date))]
  const closeByDate = new Map<string, Map<number, number>>()
  for (const s of snapshots) {
    if (!closeByDate.has(s.date)) closeByDate.set(s.date, new Map())
    closeByDate.get(s.date)!.set(s.securityId, Number(s.close))
  }
  const rate = inputs.fx?.rate ?? 0
  const points = dates.map((date) => {
    const dayPositions = foldPositions(inputs.transactions.filter((t) => t.tradeDate <= date))
    let value = 0, cost = 0
    for (const p of dayPositions) {
      const security = secById.get(p.securityId)
      if (!security || (scope !== 'total' && security.market !== scope)) continue
      const close = closeByDate.get(date)?.get(p.securityId)
      const factor = scope === 'US' ? 1 : security.currency === 'USD' ? rate : 1
      if (close !== undefined) value += close * p.quantity * factor
      cost += p.costBasis * factor
    }
    return { date, value: Math.round(value * 100) / 100, cost: Math.round(cost * 100) / 100 }
  })
  return { points, allocation, empty: false }
}

export async function getSecurityDetail(householdId: string, securityId: number): Promise<SecurityDetail | null> {
  const [row] = await db.select().from(investmentSecurities).where(and(eq(investmentSecurities.id, securityId), eq(investmentSecurities.householdId, householdId))).limit(1)
  if (!row) return null
  const inputs = await loadPortfolioInputs(householdId)
  const positions = foldPositions(inputs.transactions).filter((p) => p.securityId === securityId)
  const allValued = valuePositions(foldPositions(inputs.transactions), inputs.securities, inputs.quotes, inputs.closes)
  const weights = weightsKRW(allValued, cashBalances(inputs.transactions), inputs.fx)
  const diffs = discrepancies(positions, inputs.broker.filter((b) => b.securityId === securityId))
  const valued = valuePositions(positions, inputs.securities, inputs.quotes, inputs.closes)
  const security = inputs.securities.find((s) => s.id === securityId)!
  const raw = await db.select({ id: investmentTransactions.id, brokerRef: investmentTransactions.brokerRef, memo: investmentTransactions.memo })
    .from(investmentTransactions).where(and(eq(investmentTransactions.householdId, householdId), eq(investmentTransactions.securityId, securityId)))
  const quote = inputs.quotes.find((q) => q.securityId === securityId)
  const ordered = inputs.securities
  const index = ordered.findIndex((s) => s.id === securityId)
  return {
    security: {
      ...security, thesis: row.thesis, horizonYears: n(row.horizonYears), fundsNeededAt: row.fundsNeededAt, lossLimitPct: n(row.lossLimitPct),
      weightBasis: row.weightBasis, businessType: row.businessType, nextCheckDate: row.nextCheckDate,
    },
    positions: valued.map((v) => ({ ...v, security, weightPct: weights.get(securityId) ?? null, discrepancy: diffs.find((d) => d.accountId === v.accountId) ?? null })),
    price: quote?.price ?? inputs.closes.get(securityId) ?? null,
    changeRate: quote?.changeRate ?? null,
    transactions: listRows(inputs, inputs.transactions.filter((t) => t.securityId === securityId), raw),
    neighbors: {
      prev: index > 0 ? { id: ordered[index - 1].id, name: ordered[index - 1].name } : null,
      next: index >= 0 && index < ordered.length - 1 ? { id: ordered[index + 1].id, name: ordered[index + 1].name } : null,
    },
  }
}

export async function getInvestmentSettingsData(householdId: string) {
  const { accounts } = await loadPortfolioInputs(householdId)
  return { accounts }
}
```

- [ ] **Step 5: actions 구현**

`src/features/investment/actions.ts`:

```ts
'use server'

import { and, eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'
import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'

import { foldPositions } from './calculations'
import { loadPortfolioInputs } from './queries'
import { parseManualTransaction } from './transaction-input'
import { MARKET_CURRENCY, type Market, type WeightBasis } from './types'

export type ActionState = { error?: string; message?: string; saved?: { id: number } }

const NO_HOUSEHOLD = '가족 가계부에 연결된 계정이 아닙니다.'
const text = (data: FormData, key: string) => { const v = data.get(key); return typeof v === 'string' ? v.trim() : '' }
const todayInKorea = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export async function saveInvestmentAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id') || 0)
  const owner = text(formData, 'owner'); const name = text(formData, 'name')
  const brokerAccountNo = text(formData, 'brokerAccountNo'); const credentialRef = text(formData, 'credentialRef')
  const active = formData.get('active') === null ? true : formData.get('active') === 'on'
  if (!owner || owner.length > 20) return { error: '소유자는 1~20자입니다.' }
  if (!name || name.length > 60) return { error: '계좌 이름은 1~60자입니다.' }
  if (!/^[0-9-]{4,20}$/.test(brokerAccountNo)) return { error: '계좌번호는 숫자와 하이픈 4~20자입니다.' }
  if (!/^[a-z0-9-]{2,40}$/.test(credentialRef)) return { error: '키체인 항목 이름은 소문자·숫자·하이픈 2~40자입니다.' }
  const values = { owner, name, brokerAccountNo, credentialRef, active, updatedAt: new Date() }
  if (id > 0) {
    const updated = await db.update(investmentAccounts).set(values).where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.householdId, household.householdId))).returning({ id: investmentAccounts.id })
    if (updated.length === 0) return { error: '이 가구에 없는 계좌입니다.' }
    revalidateFinance('investment')
    return { saved: { id }, message: '계좌를 저장했습니다.' }
  }
  const [row] = await db.insert(investmentAccounts).values({ householdId: household.householdId, ...values }).returning({ id: investmentAccounts.id })
  revalidateFinance('investment')
  return { saved: { id: row.id }, message: '계좌를 추가했습니다.' }
}

export async function addWatchSecurity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const market = text(formData, 'market') as Market
  if (market !== 'KR' && market !== 'US') return { error: '시장은 KR 또는 US입니다.' }
  const symbol = text(formData, 'symbol').toUpperCase()
  if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) return { error: '종목코드는 영문 대문자·숫자·점 1~12자입니다.' }
  const name = text(formData, 'name') || symbol
  const currency = MARKET_CURRENCY[market]
  const [existing] = await db.select({ id: investmentSecurities.id }).from(investmentSecurities)
    .where(and(eq(investmentSecurities.householdId, household.householdId), eq(investmentSecurities.market, market), eq(investmentSecurities.symbol, symbol))).limit(1)
  if (existing) {
    await db.update(investmentSecurities).set({ watching: true, updatedAt: new Date() }).where(eq(investmentSecurities.id, existing.id))
    revalidateFinance('investment')
    return { saved: { id: existing.id }, message: '관심 종목으로 표시했습니다.' }
  }
  const [row] = await db.insert(investmentSecurities).values({ householdId: household.householdId, market, symbol, name, currency, exposureCurrency: currency, watching: true }).returning({ id: investmentSecurities.id })
  revalidateFinance('investment')
  return { saved: { id: row.id }, message: '관심 종목을 추가했습니다.' }
}

export async function saveManualTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const inputs = await loadPortfolioInputs(household.householdId)
  const parsed = parseManualTransaction(formData, {
    accountIds: inputs.accounts.filter((a) => a.active).map((a) => a.id),
    securities: inputs.securities.map((s) => ({ id: s.id, market: s.market, currency: s.currency })),
    today: todayInKorea(),
  })
  if ('error' in parsed) return { error: parsed.error }
  const input = parsed.data
  if (input.kind === 'sell') {
    const held = foldPositions(inputs.transactions).find((p) => p.accountId === input.accountId && p.securityId === input.securityId)?.quantity ?? 0
    if (input.quantity! > held) return { error: `보유 ${held}주보다 많이 팔 수 없습니다.` }
  }
  const [row] = await db.insert(investmentTransactions).values({
    householdId: household.householdId, accountId: input.accountId, securityId: input.securityId, kind: input.kind, tradeDate: input.tradeDate,
    quantity: input.quantity === null ? null : String(input.quantity), price: input.price === null ? null : String(input.price),
    fee: String(input.fee), amount: String(input.amount), currency: input.currency, source: 'manual', memo: input.memo,
  }).returning({ id: investmentTransactions.id })
  revalidateFinance('investment')
  return { saved: { id: row.id }, message: '거래를 저장했습니다.' }
}

export async function updateTransactionMemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id'))
  const memo = text(formData, 'memo')
  if (!Number.isInteger(id) || id <= 0) return { error: '거래를 찾을 수 없습니다.' }
  if (memo.length > 200) return { error: '메모는 200자까지입니다.' }
  const updated = await db.update(investmentTransactions).set({ memo: memo || null, updatedAt: new Date() })
    .where(and(eq(investmentTransactions.id, id), eq(investmentTransactions.householdId, household.householdId))).returning({ id: investmentTransactions.id })
  if (updated.length === 0) return { error: '거래를 찾을 수 없습니다.' }
  revalidateFinance('investment')
  return { saved: { id }, message: '메모를 저장했습니다.' }
}

export async function deleteManualTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id'))
  const [row] = await db.select().from(investmentTransactions).where(and(eq(investmentTransactions.id, id), eq(investmentTransactions.householdId, household.householdId))).limit(1)
  if (!row) return { error: '거래를 찾을 수 없습니다.' }
  if (row.source !== 'manual') return { error: '키움에서 가져온 거래는 삭제할 수 없습니다. 메모만 수정할 수 있습니다.' }
  if (row.securityId !== null && (row.kind === 'buy' || row.kind === 'adjust')) {
    const inputs = await loadPortfolioInputs(household.householdId)
    const remaining = inputs.transactions.filter((t) => t.id !== id && t.accountId === row.accountId && t.securityId === row.securityId)
    const sold = remaining.filter((t) => t.kind === 'sell').reduce((s, t) => s + (t.quantity ?? 0), 0)
    const bought = remaining.filter((t) => t.kind === 'buy' || t.kind === 'adjust').reduce((s, t) => s + (t.quantity ?? 0), 0)
    if (bought - sold < 0) return { error: '삭제하면 보유 수량이 음수가 됩니다. 매도 거래를 먼저 정리하세요.' }
  }
  await db.delete(investmentTransactions).where(eq(investmentTransactions.id, id))
  revalidateFinance('investment')
  return { message: '거래를 삭제했습니다.' }
}

export async function saveHoldingMemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const securityId = Number(text(formData, 'securityId'))
  const thesis = text(formData, 'thesis'); const fundsNeededAt = text(formData, 'fundsNeededAt')
  const horizonRaw = text(formData, 'horizonYears'); const lossRaw = text(formData, 'lossLimitPct')
  const weightBasis = text(formData, 'weightBasis') as WeightBasis
  if (thesis.length > 300) return { error: '매수 논지는 300자까지입니다.' }
  if (fundsNeededAt.length > 100) return { error: '자금 사용 시점은 100자까지입니다.' }
  const horizonYears = horizonRaw === '' ? null : Number(horizonRaw)
  if (horizonYears !== null && (!Number.isFinite(horizonYears) || horizonYears <= 0 || horizonYears > 99)) return { error: '투자 기간은 0보다 크고 99년 이하입니다.' }
  const lossLimitPct = lossRaw === '' ? null : Number(lossRaw)
  if (lossLimitPct !== null && (!Number.isFinite(lossLimitPct) || lossLimitPct <= 0 || lossLimitPct > 100)) return { error: '허용 손실 한도는 0보다 크고 100% 이하입니다.' }
  if (weightBasis !== 'total_assets' && weightBasis !== 'stock_accounts') return { error: '비중 분모가 올바르지 않습니다.' }
  const updated = await db.update(investmentSecurities).set({
    thesis: thesis || null, fundsNeededAt: fundsNeededAt || null,
    horizonYears: horizonYears === null ? null : horizonYears.toFixed(1), lossLimitPct: lossLimitPct === null ? null : lossLimitPct.toFixed(2),
    weightBasis, updatedAt: new Date(),
  }).where(and(eq(investmentSecurities.id, securityId), eq(investmentSecurities.householdId, household.householdId))).returning({ id: investmentSecurities.id })
  if (updated.length === 0) return { error: '이 가구에 없는 종목입니다.' }
  revalidateFinance('investment')
  return { saved: { id: securityId }, message: '보유 메모를 저장했습니다.' }
}
```

- [ ] **Step 6: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project integration tests/integration/investment-queries.test.ts tests/integration/investment-actions.test.ts`
Expected: 10 passed.

- [ ] **Step 7: 게이트와 커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

```bash
git add src/features/investment/queries.ts src/features/investment/actions.ts tests/integration/investment-queries.test.ts tests/integration/investment-actions.test.ts
git commit -m "feat(investment): add read models and manual entry actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: 투자 공간 공통 부품(레이아웃·상태 줄·KPI 띠·소유자 칩·보유 표)

**시각 참조:** `01-holdings-desktop.png`의 헤더·제목 줄·상태 줄·KPI 띠·소유자 칩, `02-holdings-collapsed.png`의 접힌 계좌·소그룹 행, `10-holdings-mobile.png`의 2×2 KPI와 세 열 표. 목업 HTML의 `.kpi-band`, `.status-line`, `.chips`, `table.ledger.holdings` 블록이 대응한다.

**Files:**
- Create: `src/app/investment/layout.tsx`
- Create: `src/features/investment/page-shell.tsx`
- Create: `src/features/investment/status-line.tsx`
- Create: `src/features/investment/kpi-band.tsx`
- Create: `src/features/investment/owner-chips.tsx`
- Create: `src/features/investment/holdings-table.tsx`
- Modify: `src/app/globals.css` (시장 칩 `.mk`)
- Test: `tests/finance/investment-components.test.tsx`

**Interfaces:**
- Consumes: `HoldingsData`, `AccountGroup`, `HoldingRow`, `StatusLine` (Task 6), 포맷터 (Task 2).
- Produces:
  - `InvestmentPageShell({ active, email, eyebrow, title, subtitle, status, owner, ownerHref, children })` — 헤더(space='investment') + `<main>` + 페이지 제목 + 소유자 칩 + 상태 줄. `ownerHref(owner: string | null): string`가 칩 링크를 만든다.
  - `StatusLineView({ status }: { status: StatusLine })` — "시세 HH:MM 기준 · USDKRW 1,380.20 (09-27) · 마지막 동기화 … · 로컬 워커 ●". 값이 없으면 "시세 없음", "환율 없음 · 해외 미포함", "동기화 전". 1단계는 워커 미연결이라 "연결 안 됨"(회색 점). "지금 동기화" 버튼은 `disabled` + `title="2단계에서 연결"`.
  - `KpiBand({ items }: { items: Array<{ label: string; value: ReactNode; tone?: 'ink' | 'blue' | 'red' | 'amber'; caption?: ReactNode }> })` — 4칸, `kpi-band` 클래스(globals.css에 이미 있는 짝수 칸 좌측 hairline 규칙 사용).
  - `OwnerChips({ owners, active, href })`.
  - `HoldingsTable({ groups, fx }: { groups: AccountGroup[]; fx: FxRow | null })` — client. 계좌 행·시장 소그룹 행 접기(localStorage 키 `investment-collapsed`), 열 너비 고정(`table-layout: fixed`), 모바일은 종목·평가손익·수익률만. 행 클릭 → `/investment/[securityId]`.
  - `MarketChip({ market })` — `.mk`/`.mk.us`.

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/investment-components.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HoldingsTable } from '@/features/investment/holdings-table'
import { KpiBand } from '@/features/investment/kpi-band'
import { StatusLineView } from '@/features/investment/status-line'
import type { AccountGroup } from '@/features/investment/queries'

const security = { id: 1, market: 'KR' as const, symbol: '005930', name: '삼성전자', currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: false }
const nvda = { ...security, id: 2, market: 'US' as const, symbol: 'NVDA', name: 'NVIDIA', currency: 'USD' as const, exposureCurrency: 'USD' as const }
const groups: AccountGroup[] = [{
  account: { id: 1, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', active: true, lastSyncedAt: null },
  cashKRW: 1120000, cashUSD: 640,
  markets: [
    { market: 'KR', count: 1, value: 9408000, unrealized: 864000, returnPct: 10.11, valueKRW: 9408000, rows: [{
      accountId: 1, securityId: 1, quantity: 120, avgCost: 71200, costBasis: 8544000, market: 'KR', currency: 'KRW', price: 78400, priceSource: 'quote', marketValue: 9408000, unrealized: 864000, returnPct: 10.11, security, weightPct: 15.3,
      discrepancy: { accountId: 1, securityId: 1, ourQty: 120, brokerQty: 120, ourAvg: 71200, brokerAvg: 73640, qtyDiffers: false, avgDiffPct: 3.43 },
    }] },
    { market: 'US', count: 1, value: 1965.75, unrealized: 192.75, returnPct: 10.87, valueKRW: 2713000, rows: [{
      accountId: 1, securityId: 2, quantity: 15, avgCost: 118.2, costBasis: 1773, market: 'US', currency: 'USD', price: 131.05, priceSource: 'close', marketValue: 1965.75, unrealized: 192.75, returnPct: 10.87, security: nvda, weightPct: 4.4, discrepancy: null,
    }] },
  ],
}]

describe('HoldingsTable', () => {
  const html = renderToStaticMarkup(<HoldingsTable fx={{ date: '2026-09-27', rate: 1380.2 }} groups={groups} />)
  it('renders account row, market subgroup rows in native currency and a won-converted overseas subtotal', () => {
    expect(html).toContain('DJ 키움 종합')
    expect(html).toContain('····5678')
    expect(html).toContain('국내')
    expect(html).toContain('해외')
    expect(html).toContain('$1,965.75')
    expect(html).toContain('₩2,713,000 환산')
    expect(html).toContain('+$192.75')
  })
  it('marks a discrepancy row and links every security row to its detail page', () => {
    expect(html).toContain('증권사 값과 3.4% 차이')
    expect(html).toContain('href="/investment/1"')
    expect(html).toContain('href="/investment/2"')
  })
  it('exposes collapse toggles with aria-expanded and fixed column widths', () => {
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(html).toContain('<colgroup>')
  })
  it('labels the price source when it is a close, not a live quote', () => {
    expect(html).toContain('종가 기준')
  })
})

describe('StatusLineView', () => {
  it('spells out missing quote, fx and sync instead of rendering blanks or NaN', () => {
    const html = renderToStaticMarkup(<StatusLineView status={{ quotedAt: null, fx: null, lastSyncedAt: null, workerConnected: false }} />)
    expect(html).toContain('시세 없음')
    expect(html).toContain('환율 없음 · 해외 미포함')
    expect(html).toContain('동기화 전')
    expect(html).toContain('연결 안 됨')
    expect(html).not.toContain('NaN')
    expect(html).toMatch(/<button[^>]*disabled/)
  })
  it('formats a present fx rate with its date', () => {
    const html = renderToStaticMarkup(<StatusLineView status={{ quotedAt: '2026-09-28T05:32:00Z', fx: { date: '2026-09-27', rate: 1380.2 }, lastSyncedAt: null, workerConnected: false }} />)
    expect(html).toContain('USDKRW')
    expect(html).toContain('1,380.20')
    expect(html).toContain('(09-27)')
  })
})

describe('KpiBand', () => {
  it('renders exactly the four items with their tones', () => {
    const html = renderToStaticMarkup(<KpiBand items={[
      { label: '국내 평가', value: '46,555,500', tone: 'ink' }, { label: '해외 평가', value: '$8,409.75' },
      { label: '합계', value: '61,402,500', tone: 'blue' }, { label: '예수금', value: '₩1,860,000', caption: '$1,000.00' },
    ]} />)
    expect((html.match(/<article/g) ?? []).length).toBe(4)
    expect(html).toContain('kpi-band')
    expect(html).toContain('text-finance-blue')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-components.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 레이아웃과 shell**

`src/app/investment/layout.tsx`:

```tsx
import type { ReactNode } from 'react'

/**
 * 투자 공간의 공통 레이아웃. 마지막 공간 기억은 page-shell의 <SpaceMemo/>가
 * 클라이언트에서 쿠키를 써서 한다(서버 컴포넌트는 쿠키를 쓸 수 없다).
 */
export default function InvestmentLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
```

`src/features/investment/page-shell.tsx`:

```tsx
import type { ReactNode } from 'react'

import { AppHeader } from '@/components/app-header'
import type { HeaderSection } from '@/components/app-header-menu'

import { OwnerChips } from './owner-chips'
import type { StatusLine } from './queries'
import { SpaceMemo } from './space-memo'
import { StatusLineView } from './status-line'

type Props = {
  active: HeaderSection
  email: string
  eyebrow: string
  title: string
  subtitle?: ReactNode
  status?: StatusLine
  owners: string[]
  owner: string | null
  ownerHref: (owner: string | null) => string
  children: ReactNode
}

export function InvestmentPageShell({ active, email, eyebrow, title, subtitle, status, owners, owner, ownerHref, children }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <AppHeader active={active} email={email} space="investment" />
      <SpaceMemo />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-24 pt-9 sm:px-12 sm:pb-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="t-label uppercase text-finance-blue">{eyebrow}</p>
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              {title}
              {subtitle && <span className="t-caption font-medium text-finance-muted">{subtitle}</span>}
            </h1>
          </div>
          {owners.length > 1 && <OwnerChips active={owner} href={ownerHref} owners={owners} />}
        </div>
        {status && <StatusLineView status={status} />}
        {children}
      </main>
    </div>
  )
}
```

`src/features/investment/space-memo.tsx` (client, 쿠키 저장):

```tsx
'use client'

import { useEffect } from 'react'

import { SPACE_COOKIE, SPACE_COOKIE_MAX_AGE, type Space } from './space'

export function SpaceMemo({ space = 'investment' }: { space?: Space }) {
  useEffect(() => {
    document.cookie = `${SPACE_COOKIE}=${space}; path=/; max-age=${SPACE_COOKIE_MAX_AGE}; samesite=lax`
  }, [space])
  return null
}
```

가계부 공간으로 돌아갈 때도 기억되어야 하므로 `src/app/dashboard/page.tsx`의 `<AppHeader ... />` 바로 아래에 `<SpaceMemo space="ledger" />`를 넣는다.

- [ ] **Step 4: 상태 줄·KPI·칩·시장 칩**

`src/features/investment/status-line.tsx`:

```tsx
import type { StatusLine } from './queries'

const timeKST = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
const dateTimeKST = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
const rate = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function StatusLineView({ status }: { status: StatusLine }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-finance-border py-3 t-caption text-finance-muted">
      <span>{status.quotedAt ? <>시세 <strong className="text-finance-ink">{timeKST.format(new Date(status.quotedAt))}</strong> 기준</> : '시세 없음'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span>{status.fx ? <>USDKRW <strong className="text-finance-ink">{rate.format(status.fx.rate)}</strong> ({status.fx.date.slice(5)})</> : '환율 없음 · 해외 미포함'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span>{status.lastSyncedAt ? <>마지막 동기화 <strong className="text-finance-ink">{dateTimeKST.format(new Date(status.lastSyncedAt))}</strong></> : '동기화 전'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span className="inline-flex items-center gap-1.5">로컬 워커 <span aria-hidden className={`inline-block h-[7px] w-[7px] ${status.workerConnected ? 'bg-finance-green' : 'bg-finance-faint'}`} />{status.workerConnected ? '연결됨' : '연결 안 됨'}</span>
      <button className="ml-auto h-[30px] border border-finance-border px-3 t-caption-strong text-finance-muted disabled:opacity-40" disabled title="키움 연동은 2단계에서 연결됩니다" type="button">지금 동기화</button>
    </div>
  )
}
```

`src/features/investment/kpi-band.tsx`:

```tsx
import type { ReactNode } from 'react'

export type KpiItem = { label: string; value: ReactNode; tone?: 'ink' | 'blue' | 'red' | 'amber'; caption?: ReactNode }

const TONE = { ink: 'text-finance-ink', blue: 'text-finance-blue', red: 'text-finance-red', amber: 'text-finance-amber' } as const

export function KpiBand({ items }: { items: KpiItem[] }) {
  return (
    <section className="kpi-band mt-5 grid grid-cols-2 border-y border-finance-ink sm:grid-cols-4" aria-label="요약">
      {items.map((item, index) => (
        <article className={`py-5 ${index % 2 === 1 ? 'pl-4 sm:pl-6' : ''} ${index > 1 ? 'border-t border-finance-border sm:border-t-0' : ''} ${index > 0 ? 'sm:border-l sm:border-finance-border sm:pl-6' : ''} pr-4 sm:pr-6`} key={item.label}>
          <p className="t-label uppercase text-finance-muted">{item.label}</p>
          <p className={`mt-2 t-kpi tabular-nums ${TONE[item.tone ?? 'ink']}`}>{item.value}</p>
          {item.caption && <p className="mt-2 t-caption text-finance-muted">{item.caption}</p>}
        </article>
      ))}
    </section>
  )
}
```

`src/features/investment/owner-chips.tsx`:

```tsx
import Link from 'next/link'

export function OwnerChips({ owners, active, href }: { owners: string[]; active: string | null; href: (owner: string | null) => string }) {
  const items: Array<string | null> = [null, ...owners]
  return (
    <div className="flex border border-finance-border" role="group" aria-label="소유자">
      {items.map((owner) => (
        <Link
          aria-pressed={active === owner}
          className={`flex h-[30px] items-center border-r border-finance-border px-3.5 t-caption-strong last:border-r-0 ${active === owner ? 'bg-finance-ink text-white' : 'text-finance-muted hover:text-finance-ink'}`}
          href={href(owner)}
          key={owner ?? 'all'}
        >
          {owner ?? '전체'}
        </Link>
      ))}
    </div>
  )
}
```

`src/features/investment/market-chip.tsx`:

```tsx
import { MARKET_LABELS, type Market } from './types'

export function MarketChip({ market }: { market: Market }) {
  return <span className={`mk ${market === 'US' ? 'us' : ''}`}>{MARKET_LABELS[market]}</span>
}
```

`src/app/globals.css` 끝에:

```css
/* 투자: 시장 칩. 국내는 잉크 테두리, 해외는 파랑 테두리. 배경 없음. */
.mk { display: inline-block; margin-right: 6px; border: 1px solid var(--finance-ink); padding: 0 6px; color: var(--finance-ink); font-size: 10px; font-weight: 700; line-height: 16px; letter-spacing: .06em; vertical-align: middle; }
.mk.us { border-color: var(--finance-blue); color: var(--finance-blue); }
/* 투자: 보유 표는 접고 펼쳐도 열이 움직이지 않게 고정 레이아웃 */
@media (min-width: 861px) { .investment-holdings { table-layout: fixed; } }
```

- [ ] **Step 5: 보유 표(client)**

`src/features/investment/holdings-table.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { formatMoney, formatPct, formatSigned } from './format'
import { MarketChip } from './market-chip'
import type { AccountGroup, HoldingRow } from './queries'
import type { FxRow } from './types'

const STORAGE_KEY = 'investment-collapsed'

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setCollapsed(new Set(JSON.parse(raw) as string[])) } catch { /* 저장소 없음 */ }
  }, [])
  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch { /* 저장소 없음 */ }
      return next
    })
  }
  return { collapsed, toggle }
}

const cell = 'px-3 py-3 text-right tabular-nums whitespace-nowrap'
const hide = 'hidden sm:table-cell'

function Row({ row }: { row: HoldingRow }) {
  const c = row.currency
  const tone = (value: number | null) => value === null ? 'text-finance-faint' : value > 0 ? 'text-finance-blue' : value < 0 ? 'text-finance-red' : 'text-finance-ink'
  return (
    <tr className="border-b border-finance-track hover:bg-finance-track">
      <td className="py-3 pr-3">
        <Link className="flex flex-wrap items-center gap-x-2 gap-y-1 t-body-strong text-finance-ink" href={`/investment/${row.securityId}`}>
          {row.security.name}
          <span className="t-caption font-normal text-finance-faint">{row.security.symbol}</span>
          {row.discrepancy && <span aria-hidden className="inline-block h-[7px] w-[7px] bg-finance-amber" title="증권사 값과 차이" />}
          {row.priceSource === 'close' && <span className="t-caption font-normal text-finance-faint">종가 기준</span>}
          {row.priceSource === 'none' && <span className="t-caption font-normal text-finance-faint">시세 없음</span>}
        </Link>
        {row.discrepancy && (
          <p className="mt-1 t-caption text-finance-muted">
            {row.discrepancy.qtyDiffers ? `수량이 증권사(${row.discrepancy.brokerQty})와 다름` : `증권사 값과 ${row.discrepancy.avgDiffPct!.toFixed(1)}% 차이 · 증권사 평균단가 ${formatMoney(row.discrepancy.brokerAvg, c)}`}
          </p>
        )}
      </td>
      <td className={`${cell} ${hide}`}>{row.quantity}</td>
      <td className={`${cell} ${hide}`}>{row.avgCost === null ? '–' : formatMoney(row.avgCost, c)}</td>
      <td className={`${cell} ${hide}`}>{row.price === null ? '–' : formatMoney(row.price, c)}</td>
      <td className={`${cell} ${hide}`}>{row.marketValue === null ? '–' : formatMoney(row.marketValue, c)}</td>
      <td className={`${cell} ${tone(row.unrealized)}`}>{row.unrealized === null ? '–' : formatSigned(row.unrealized, c)}</td>
      <td className={`${cell} ${tone(row.returnPct)}`}>{formatPct(row.returnPct)}</td>
      <td className={`${cell} ${hide} pr-0`}>
        {row.weightPct === null ? '–' : (
          <span className="inline-grid grid-cols-[44px_40px] items-center gap-1.5">
            <span className="relative block h-[5px] bg-finance-track"><span className="absolute inset-y-0 left-0 bg-finance-ink" style={{ width: `${Math.min(100, row.weightPct * 4)}%` }} /></span>
            <span>{row.weightPct.toFixed(1)}%</span>
          </span>
        )}
      </td>
    </tr>
  )
}

export function HoldingsTable({ groups, fx }: { groups: AccountGroup[]; fx: FxRow | null }) {
  const { collapsed, toggle } = useCollapsed()
  const caret = (open: boolean) => <span aria-hidden className={`absolute right-1 top-1/2 -translate-y-1/2 text-finance-faint transition-transform ${open ? '' : '-rotate-90'}`}>⌄</span>
  return (
    <div className="mt-4 overflow-x-auto border-t border-finance-ink">
      <table className="investment-holdings w-full t-body">
        <colgroup><col style={{ width: '30%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '9%' }} /><col style={{ width: '10%' }} /></colgroup>
        <thead className="border-b border-finance-border t-label uppercase text-finance-muted">
          <tr>
            <th className="py-2.5 text-left">종목</th>
            <th className={`px-3 py-2.5 text-right ${hide}`}>수량</th>
            <th className={`px-3 py-2.5 text-right ${hide}`}>평균단가</th>
            <th className={`px-3 py-2.5 text-right ${hide}`}>현재가</th>
            <th className={`px-3 py-2.5 text-right ${hide}`}>평가금액</th>
            <th className="px-3 py-2.5 text-right">평가손익</th>
            <th className="px-3 py-2.5 text-right">수익률</th>
            <th className={`py-2.5 pl-3 text-right ${hide}`}>비중</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const accountKey = `a${group.account.id}`
            const accountOpen = !collapsed.has(accountKey)
            const kr = group.markets.find((m) => m.market === 'KR')
            const us = group.markets.find((m) => m.market === 'US')
            return [
              <tr className="cursor-pointer border-b border-finance-border bg-finance-panel hover:bg-finance-track" key={accountKey} onClick={() => toggle(accountKey)} aria-expanded={accountOpen}>
                <td className="relative py-2.5 pr-8 t-body-strong text-finance-ink" colSpan={8}>
                  {group.account.name}
                  <span className="ml-2.5 t-caption font-medium text-finance-muted">
                    ····{group.account.brokerAccountNo.slice(-4)}
                    {kr && <> · 국내 {formatMoney(kr.value, 'KRW')}원</>}
                    {us && <> · 해외 {formatMoney(us.value, 'USD')}</>}
                    {' · 예수금 '}₩{formatMoney(group.cashKRW, 'KRW')} / {formatMoney(group.cashUSD, 'USD')}
                  </span>
                  {caret(accountOpen)}
                </td>
              </tr>,
              ...(accountOpen ? group.markets.flatMap((market) => {
                const key = `${accountKey}-${market.market}`
                const open = !collapsed.has(key)
                const c = market.market === 'KR' ? 'KRW' : 'USD'
                return [
                  <tr className="cursor-pointer border-b border-finance-track hover:bg-finance-track" key={key} onClick={() => toggle(key)} aria-expanded={open}>
                    <td className="relative py-1.5 pr-8 t-caption text-finance-muted" colSpan={8}>
                      <MarketChip market={market.market} />
                      {market.count}종목 · {formatMoney(market.value, c)}{c === 'KRW' ? '원' : ''} · <span className={market.unrealized >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatSigned(market.unrealized, c)} · {formatPct(market.returnPct)}</span>
                      {market.market === 'US' && (market.valueKRW !== null ? <> · ₩{formatMoney(market.valueKRW, 'KRW')} 환산</> : <> · 환율 없음</>)}
                      {caret(open)}
                    </td>
                  </tr>,
                  ...(open ? market.rows.map((row) => <Row key={`${row.accountId}-${row.securityId}`} row={row} />) : []),
                ]
              }) : []),
            ]
          })}
        </tbody>
      </table>
      {fx === null && <p className="mt-2 t-caption text-finance-faint">환율이 없어 해외 소계의 원화 환산과 비중은 비어 있습니다.</p>}
    </div>
  )
}
```

- [ ] **Step 6: 통과 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-components.test.tsx`
Expected: 7 passed. (`HoldingsTable`은 client 컴포넌트지만 `renderToStaticMarkup`으로 초기 HTML을 검사한다. `useEffect`는 서버 렌더에서 실행되지 않는다.)

- [ ] **Step 7: 게이트와 커밋**

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

```bash
git add src/app/investment/layout.tsx src/app/dashboard/page.tsx src/features/investment/page-shell.tsx src/features/investment/space-memo.tsx src/features/investment/status-line.tsx src/features/investment/kpi-band.tsx src/features/investment/owner-chips.tsx src/features/investment/market-chip.tsx src/features/investment/holdings-table.tsx src/app/globals.css tests/finance/investment-components.test.tsx
git commit -m "feat(investment): add page shell, status line, KPI band and holdings table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: 보유·거래·관심 페이지와 입력 폼

**시각 참조:** 보유 `01-holdings-desktop.png`(주의 필요 블록은 dashboard의 할 일 목록과 같은 마크업), 거래 `04-transactions-desktop.png`·`11-transactions-mobile.png`(월 이동, 시장 필터, 인라인 폼, 종류 배지 색), 관심 `05-watch-desktop.png`. 목업 HTML의 `data-panel="transactions"`·`data-panel="watch"` 블록.

**Files:**
- Create: `src/app/investment/page.tsx`
- Create: `src/app/investment/transactions/page.tsx`
- Create: `src/app/investment/watch/page.tsx`
- Create: `src/features/investment/transaction-form.tsx`
- Create: `src/features/investment/watch-form.tsx`
- Create: `src/features/investment/transactions-table.tsx`
- Test: `tests/finance/investment-pages.test.tsx`

**Interfaces:**
- Consumes: Task 6 queries·actions, Task 7 부품.
- Produces: 세 페이지. `searchParams`: 보유 `?owner=DJ`, 거래 `?month=2026-09&market=all|KR|US&owner=`, 관심 없음. `ManualTransactionForm({ accounts, securities, today })`(client, `useActionState(saveManualTransaction)`), `WatchForm()`(client), `TransactionsTable({ rows })`(server, 메모 편집 링크 포함).

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/investment-pages.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/investment/actions', () => ({
  saveManualTransaction: vi.fn(), addWatchSecurity: vi.fn(), updateTransactionMemo: vi.fn(), deleteManualTransaction: vi.fn(),
}))

import { ManualTransactionForm } from '@/features/investment/transaction-form'
import { TransactionsTable } from '@/features/investment/transactions-table'
import type { TransactionListRow } from '@/features/investment/queries'

const accounts = [{ id: 1, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '1234', active: true, lastSyncedAt: null }]
const securities = [{ id: 10, market: 'KR' as const, symbol: '005930', name: '삼성전자', currency: 'KRW' as const, exposureCurrency: 'KRW' as const, sector: null, watching: false }]

describe('ManualTransactionForm', () => {
  const html = renderToStaticMarkup(<ManualTransactionForm accounts={accounts} securities={securities} today="2026-09-29" />)
  it('offers every kind, both currencies for cash rows and caps the date at today', () => {
    for (const label of ['매수', '매도', '배당', '입금', '출금', '수수료', '정정']) expect(html).toContain(`>${label}<`)
    expect(html).toContain('name="tradeDate"')
    expect(html).toContain('max="2026-09-29"')
    expect(html).toContain('name="currency"')
  })
  it('uses t-* classes on controls instead of raw pixel sizes', () => {
    expect(html).not.toMatch(/text-\[\d+px\]/)
    expect(html).toContain('t-body-normal')
  })
})

describe('TransactionsTable', () => {
  const rows: TransactionListRow[] = [
    { id: 1, accountId: 1, securityId: 10, kind: 'sell', tradeDate: '2026-09-04', quantity: 30, price: 80700, fee: 500, amount: 2420500, currency: 'KRW', source: 'kiwoom', accountName: 'DJ 키움', brokerRef: 'F-1', memo: null, security: { market: 'KR', symbol: '005930', name: '삼성전자' }, realized: 284500, editable: false },
    { id: 2, accountId: 1, securityId: null, kind: 'deposit', tradeDate: '2026-09-01', quantity: null, price: null, fee: 0, amount: 3000000, currency: 'KRW', source: 'manual', accountName: 'DJ 키움', brokerRef: null, memo: '월급', security: null, realized: null, editable: true },
  ]
  const html = renderToStaticMarkup(<TransactionsTable rows={rows} />)
  it('shows market chip, signed amounts, realized on sells and the source', () => {
    expect(html).toContain('국내')
    expect(html).toContain('+2,420,500')
    expect(html).toContain('+284,500')
    expect(html).toContain('키움')
    expect(html).toContain('수동')
  })
  it('only manual rows get a delete control; kiwoom rows get memo only', () => {
    expect((html.match(/삭제/g) ?? []).length).toBe(1)
    expect((html.match(/메모/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-pages.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 폼 두 개**

`src/features/investment/transaction-form.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveManualTransaction, type ActionState } from './actions'
import { CASH_KINDS, KIND_LABELS, TRANSACTION_KINDS, type AccountRow, type SecurityRow, type TransactionKind } from './types'

const control = 'h-[30px] w-full border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function ManualTransactionForm({ accounts, securities, today }: { accounts: AccountRow[]; securities: SecurityRow[]; today: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveManualTransaction, {})
  const [kind, setKind] = useState<TransactionKind>('buy')
  const isCash = CASH_KINDS.includes(kind)
  const isTrade = kind === 'buy' || kind === 'sell'
  return (
    <form action={action} className="mt-4 grid gap-3 border-y border-finance-border bg-finance-panel px-3 py-4 sm:grid-cols-4 lg:grid-cols-8" key={state.saved?.id ?? 'form'}>
      <label className={label}>종류
        <select className={control} name="kind" onChange={(event) => setKind(event.target.value as TransactionKind)} value={kind}>
          {TRANSACTION_KINDS.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
        </select>
      </label>
      <label className={label}>계좌
        <select className={control} defaultValue={accounts[0]?.id} name="accountId">
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <label className={label}>종목
        <select className={control} defaultValue="" disabled={isCash} name="securityId">
          <option value="">{isCash ? '해당 없음' : '선택'}</option>
          {securities.map((security) => <option key={security.id} value={security.id}>{security.name} ({security.symbol})</option>)}
        </select>
      </label>
      <label className={label}>날짜<input className={control} defaultValue={today} max={today} min="1990-01-01" name="tradeDate" type="date" /></label>
      <label className={label}>{kind === 'adjust' ? '수량 (±)' : '수량'}<input className={control} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="quantity" placeholder="0" /></label>
      <label className={label}>{kind === 'adjust' ? '정정 후 단가' : '단가'}<input className={control} disabled={isCash || kind === 'dividend'} inputMode="decimal" name="price" placeholder={kind === 'adjust' ? '선택' : '0'} /></label>
      {isTrade
        ? <label className={label}>수수료·세금<input className={control} defaultValue="0" inputMode="decimal" name="fee" /></label>
        : <label className={label}>금액<input className={control} disabled={kind === 'adjust'} inputMode="decimal" name="amount" placeholder="0" /></label>}
      <label className={label}>통화
        <select className={control} defaultValue="KRW" disabled={!isCash} name="currency">
          <option value="KRW">KRW</option><option value="USD">USD</option>
        </select>
      </label>
      <label className={`${label} sm:col-span-3 lg:col-span-6`}>메모<input className={control} maxLength={200} name="memo" /></label>
      <div className="flex items-end gap-3 sm:col-span-1 lg:col-span-2">
        <SubmitButton className="h-[30px] bg-finance-ink px-4 t-caption-strong text-white disabled:opacity-40" pendingLabel="저장 중…">저장</SubmitButton>
        {state.error && <p className="t-caption text-finance-red" role="alert">{state.error}</p>}
        {state.message && !state.error && <p className="t-caption text-finance-green" role="status">{state.message}</p>}
      </div>
    </form>
  )
}
```

`src/features/investment/watch-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { addWatchSecurity, type ActionState } from './actions'

const control = 'h-[30px] border border-finance-border bg-white px-2 t-body-normal text-finance-ink'

export function WatchForm() {
  const [state, action] = useActionState<ActionState, FormData>(addWatchSecurity, {})
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" key={state.saved?.id ?? 'form'}>
      <label className="grid gap-1 t-label uppercase text-finance-muted">시장<select className={control} defaultValue="KR" name="market"><option value="KR">KR</option><option value="US">US</option></select></label>
      <label className="grid gap-1 t-label uppercase text-finance-muted">종목코드<input className={`${control} w-[120px]`} name="symbol" placeholder="005930" required /></label>
      <label className="grid gap-1 t-label uppercase text-finance-muted">이름<input className={`${control} w-[160px]`} name="name" placeholder="선택" /></label>
      <SubmitButton className="h-[30px] border border-finance-ink px-3 t-caption-strong text-finance-ink" pendingLabel="추가 중…">추가</SubmitButton>
      {state.error && <p className="w-full t-caption text-finance-red" role="alert">{state.error}</p>}
    </form>
  )
}
```

- [ ] **Step 4: 거래 표(server)와 메모·삭제 컨트롤(client)**

`src/features/investment/transaction-row-controls.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { deleteManualTransaction, updateTransactionMemo, type ActionState } from './actions'

export function TransactionRowControls({ id, memo, editable }: { id: number; memo: string | null; editable: boolean }) {
  const [open, setOpen] = useState(false)
  const [memoState, memoAction] = useActionState<ActionState, FormData>(updateTransactionMemo, {})
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteManualTransaction, {})
  if (!open) {
    return (
      <span className="inline-flex gap-2">
        <button className="t-caption font-semibold text-finance-blue" onClick={() => setOpen(true)} type="button">메모</button>
        {editable && (
          <form action={deleteAction} className="inline">
            <input name="id" type="hidden" value={id} />
            <SubmitButton className="t-caption font-semibold text-finance-red" pendingLabel="삭제 중…">삭제</SubmitButton>
          </form>
        )}
        {deleteState.error && <span className="t-caption text-finance-red" role="alert">{deleteState.error}</span>}
      </span>
    )
  }
  return (
    <form action={memoAction} className="flex items-center gap-2">
      <input name="id" type="hidden" value={id} />
      <input className="h-[30px] w-[220px] border border-finance-border bg-white px-2 t-body-normal" defaultValue={memo ?? ''} maxLength={200} name="memo" />
      <SubmitButton className="h-[30px] border border-finance-ink px-2 t-caption-strong" pendingLabel="…">저장</SubmitButton>
      <button className="t-caption text-finance-muted" onClick={() => setOpen(false)} type="button">닫기</button>
      {memoState.error && <span className="t-caption text-finance-red" role="alert">{memoState.error}</span>}
    </form>
  )
}
```

`src/features/investment/transactions-table.tsx`:

```tsx
import { formatMoney, formatSigned } from './format'
import { MarketChip } from './market-chip'
import type { TransactionListRow } from './queries'
import { TransactionRowControls } from './transaction-row-controls'
import { KIND_LABELS } from './types'

const KIND_TINT: Record<TransactionListRow['kind'], string> = {
  buy: 'bg-finance-blue-tint text-finance-blue', sell: 'bg-finance-red-tint text-finance-red', dividend: 'bg-finance-green-tint text-finance-green',
  deposit: 'bg-finance-track text-finance-muted', withdraw: 'bg-finance-track text-finance-muted', fee: 'bg-finance-track text-finance-muted', adjust: 'bg-finance-amber-tint text-finance-amber',
}
const cell = 'px-3 py-3 text-right tabular-nums whitespace-nowrap'
const hide = 'hidden sm:table-cell'

export function TransactionsTable({ rows }: { rows: TransactionListRow[] }) {
  if (rows.length === 0) return <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">이 달 거래가 없습니다.</p>
  return (
    <div className="mt-4 overflow-x-auto border-t border-finance-ink">
      <table className="w-full t-body">
        <thead className="border-b border-finance-border t-label uppercase text-finance-muted">
          <tr>
            <th className="py-2.5 text-left">날짜</th><th className="px-3 py-2.5 text-left">종류</th><th className="px-3 py-2.5 text-left">시장 · 종목</th>
            <th className={`px-3 py-2.5 text-left ${hide}`}>계좌</th><th className={`px-3 py-2.5 text-right ${hide}`}>수량</th><th className={`px-3 py-2.5 text-right ${hide}`}>단가</th>
            <th className="px-3 py-2.5 text-right">금액</th><th className={`px-3 py-2.5 text-right ${hide}`}>실현손익</th><th className={`px-3 py-2.5 text-left ${hide}`}>출처</th><th className="py-2.5 pl-3 text-left"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-finance-track">
          {rows.map((row) => {
            const market = row.security?.market ?? (row.currency === 'USD' ? 'US' : 'KR')
            return (
              <tr key={row.id}>
                <td className="py-3 pr-3 tabular-nums">{row.tradeDate.slice(5)}</td>
                <td className="px-3 py-3"><span className={`inline-flex h-[18px] items-center px-1.5 t-badge ${KIND_TINT[row.kind]}`}>{KIND_LABELS[row.kind]}</span></td>
                <td className="px-3 py-3"><MarketChip market={market} />{row.security ? <strong className="text-finance-ink">{row.security.name}</strong> : <span className="text-finance-faint">{row.currency === 'USD' ? '달러 예수금' : '원화 예수금'}</span>}</td>
                <td className={`px-3 py-3 text-finance-muted ${hide}`}>{row.accountName}</td>
                <td className={`${cell} ${hide}`}>{row.quantity ?? '–'}</td>
                <td className={`${cell} ${hide}`}>{row.price === null ? '–' : formatMoney(row.price, row.currency)}</td>
                <td className={`${cell} ${row.amount > 0 ? 'text-finance-ink' : row.amount < 0 ? 'text-finance-ink' : 'text-finance-faint'}`}>{row.amount === 0 ? '–' : formatSigned(row.amount, row.currency)}</td>
                <td className={`${cell} ${hide} ${row.realized === null ? 'text-finance-faint' : row.realized >= 0 ? 'text-finance-blue' : 'text-finance-red'}`}>{row.realized === null ? '–' : formatSigned(row.realized, row.currency)}</td>
                <td className={`px-3 py-3 text-finance-muted ${hide}`}>{row.source === 'kiwoom' ? '키움' : '수동'}{row.memo && <span className="ml-2 text-finance-faint">· {row.memo}</span>}</td>
                <td className="py-3 pl-3"><TransactionRowControls editable={row.editable} id={row.id} memo={row.memo} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: 페이지 세 개**

`src/app/investment/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { HoldingsTable } from '@/features/investment/holdings-table'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, loadPortfolioInputs } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

type Props = { searchParams: Promise<{ owner?: string | string[] }> }

export default async function InvestmentHoldingsPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const owner = typeof params.owner === 'string' && params.owner !== '' ? params.owner : null
  const [data, inputs] = await Promise.all([getHoldingsData(household.householdId, owner ?? undefined), loadPortfolioInputs(household.householdId)])
  const owners = [...new Set(inputs.accounts.map((a) => a.owner))]
  const { summary } = data
  const fxNote = summary.fxMissing ? ' · 환율 없음 · 해외 미포함' : ''
  return (
    <InvestmentPageShell
      active="investment" email={household.email} eyebrow="Holdings" title="보유"
      subtitle={`${owners.length > 1 ? '두 계좌' : `${inputs.accounts.length}계좌`} · 국내 ${data.securitiesCount.KR} · 해외 ${data.securitiesCount.US} 종목`}
      status={data.status} owners={owners} owner={owner} ownerHref={(value) => value ? `/investment?owner=${encodeURIComponent(value)}` : '/investment'}
    >
      <KpiBand items={[
        { label: '국내 평가', value: <>{formatMoney(summary.KR.value, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, caption: <>손익 <strong className={summary.KR.unrealized >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatSigned(summary.KR.unrealized, 'KRW')} · {formatPct(summary.KR.returnPct)}</strong> · {summary.KR.count}종목</> },
        { label: '해외 평가', value: formatMoney(summary.US.value, 'USD'), caption: <>손익 <strong className={summary.US.unrealized >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatSigned(summary.US.unrealized, 'USD')} · {formatPct(summary.US.returnPct)}</strong>{data.status.fx && <> · ₩{formatMoney(Math.round(summary.US.value * data.status.fx.rate), 'KRW')} 환산</>} · {summary.US.count}종목</> },
        { label: '합계 (원화 환산)', value: <>{formatMoney(summary.totalKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, caption: <>손익 <strong className={summary.totalUnrealizedKRW >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatSigned(summary.totalUnrealizedKRW, 'KRW')}</strong>{fxNote}</> },
        { label: '예수금', value: `₩${formatMoney(summary.cashKRW, 'KRW')}`, caption: <><strong className="text-finance-ink">{formatMoney(summary.cashUSD, 'USD')}</strong>{data.groups.map((g) => <span key={g.account.id}> · {g.account.owner} ₩{formatMoney(g.cashKRW, 'KRW')} / {formatMoney(g.cashUSD, 'USD')}</span>)}</> },
      ]} />

      {data.attention.length > 0 && (
        <section aria-label="주의 필요" className="border-b border-finance-border">
          {data.attention.map((item) => (
            <Link className="flex min-h-12 flex-col gap-1 border-b border-finance-track py-3 t-body last:border-b-0 sm:flex-row sm:items-center sm:gap-3" href={item.href} key={`${item.kind}-${item.securityId}`}>
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 bg-finance-amber" />
              <strong className="text-finance-ink">{item.title}</strong>
              <span className="t-caption text-finance-muted">{item.detail}</span>
              <span className="ml-auto shrink-0 t-caption font-semibold text-finance-blue">보기 →</span>
            </Link>
          ))}
        </section>
      )}

      <section className="py-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="t-section text-finance-ink">보유 종목</h2><p className="mt-1 t-caption text-finance-faint">계좌별 · 평가손익은 이동평균 단가 기준 · 행을 누르면 상세</p></div>
          <p className="t-caption text-finance-muted">국내는 원화, 해외는 달러 · 비중은 원화 환산 기준</p>
        </div>
        {data.groups.length === 0
          ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">계좌가 없습니다. <Link className="font-semibold text-finance-blue" href="/investment/settings">투자 설정에서 계좌를 추가</Link>한 뒤 <Link className="font-semibold text-finance-blue" href="/investment/transactions">거래</Link>에서 매수를 입력하세요.</p>
          : <HoldingsTable fx={data.status.fx} groups={data.groups} />}
      </section>
    </InvestmentPageShell>
  )
}
```

`src/app/investment/transactions/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatSigned } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getTransactionsData, loadPortfolioInputs } from '@/features/investment/queries'
import { ManualTransactionForm } from '@/features/investment/transaction-form'
import { TransactionsTable } from '@/features/investment/transactions-table'
import type { Market } from '@/features/investment/types'
import { currentMonthInKorea, isMonthKey, shiftMonth } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type Props = { searchParams: Promise<{ month?: string | string[]; market?: string | string[]; owner?: string | string[] }> }

function href(month: string, market: string, owner: string | null) {
  const params = new URLSearchParams({ month, market })
  if (owner) params.set('owner', owner)
  return `/investment/transactions?${params.toString()}`
}

export default async function InvestmentTransactionsPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const month = isMonthKey(typeof params.month === 'string' ? params.month : undefined) ? (params.month as string) : currentMonthInKorea()
  const marketRaw = typeof params.market === 'string' ? params.market : 'all'
  const market: Market | 'all' = marketRaw === 'KR' || marketRaw === 'US' ? marketRaw : 'all'
  const owner = typeof params.owner === 'string' && params.owner !== '' ? params.owner : null
  const [data, inputs] = await Promise.all([getTransactionsData(household.householdId, month, market, owner ?? undefined), loadPortfolioInputs(household.householdId)])
  const owners = [...new Set(inputs.accounts.map((a) => a.owner))]
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
  const tone = (value: number) => value > 0 ? 'blue' as const : value < 0 ? 'red' as const : 'ink' as const
  return (
    <InvestmentPageShell active="investment-transactions" email={household.email} eyebrow="Transactions" title="거래" subtitle="매수·매도·배당·입출금 · 실현손익"
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }}
      owners={owners} owner={owner} ownerHref={(value) => href(month, market, value)}>
      <KpiBand items={[
        { label: `${Number(month.slice(5))}월 실현손익 · 국내`, value: <>{formatSigned(data.realizedKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, tone: tone(data.realizedKRW), caption: '매도 기준 · 수수료·세금 차감 후' },
        { label: `${Number(month.slice(5))}월 실현손익 · 해외`, value: formatSigned(data.realizedUSD, 'USD'), tone: tone(data.realizedUSD), caption: '달러 기준' },
        { label: '배당', value: `₩${formatMoney(data.dividendKRW, 'KRW')}`, caption: <><strong className="text-finance-ink">{formatMoney(data.dividendUSD, 'USD')}</strong> · 입력 금액 기준</> },
        { label: '순입출금', value: <>{formatSigned(data.netCashKRW, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, caption: <>달러 {formatSigned(data.netCashUSD, 'USD')}</> },
      ]} />
      <section className="py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center border border-finance-ink">
            <Link aria-label="이전 달" className="grid h-[34px] w-[34px] place-items-center border-r border-finance-ink hover:bg-finance-track" href={href(shiftMonth(month, -1), market, owner)}>←</Link>
            <span className="px-4 t-body-strong">{month.slice(0, 4)}년 {Number(month.slice(5))}월</span>
            <Link aria-label="다음 달" className="grid h-[34px] w-[34px] place-items-center border-l border-finance-ink hover:bg-finance-track" href={href(shiftMonth(month, 1), market, owner)}>→</Link>
          </div>
          <div className="flex border border-finance-border" role="group" aria-label="시장">
            {(['all', 'KR', 'US'] as const).map((value) => (
              <Link aria-pressed={market === value} className={`flex h-[30px] items-center border-r border-finance-border px-3 t-caption-strong last:border-r-0 ${market === value ? 'bg-finance-track text-finance-ink' : 'text-finance-muted'}`} href={href(month, value, owner)} key={value}>
                {value === 'all' ? '전체' : value === 'KR' ? '국내' : '해외'}
              </Link>
            ))}
          </div>
        </div>
        {inputs.accounts.length === 0
          ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted"><Link className="font-semibold text-finance-blue" href="/investment/settings">계좌를 먼저 추가</Link>하세요.</p>
          : <ManualTransactionForm accounts={inputs.accounts.filter((a) => a.active)} securities={inputs.securities} today={today} />}
        <TransactionsTable rows={data.rows} />
        <p className="mt-3 t-caption text-finance-faint">키움에서 온 행은 메모만 수정할 수 있습니다. 예수금이 증권사와 다르면 입금·출금 행으로, 수량·단가가 다르면 정정 행으로 맞춥니다. 환전은 원화 출금 + 달러 입금 두 행으로 기록합니다.</p>
      </section>
    </InvestmentPageShell>
  )
}
```

`src/app/investment/watch/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { formatMoney, formatPct } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { MarketChip } from '@/features/investment/market-chip'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getWatchData, loadPortfolioInputs } from '@/features/investment/queries'
import { WatchForm } from '@/features/investment/watch-form'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentWatchPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const [rows, inputs] = await Promise.all([getWatchData(household.householdId), loadPortfolioInputs(household.householdId)])
  const kr = rows.filter((r) => r.security.market === 'KR').length
  const us = rows.length - kr
  return (
    <InvestmentPageShell active="investment-watch" email={household.email} eyebrow="Watchlist" title="관심" subtitle={`국내 ${kr} · 해외 ${us}`}
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }}
      owners={[]} owner={null} ownerHref={() => '/investment/watch'}>
      <KpiBand items={[
        { label: '관심 종목', value: String(rows.length), caption: `국내 ${kr} · 해외 ${us}` },
        { label: '점검 예정 7일 내', value: '0', caption: '헬스체크는 3단계에서 연결' },
        { label: '미실행', value: String(rows.length), caption: '헬스체크 없음' },
        { label: '발굴 후보 대기', value: '0', caption: '발굴은 3단계에서 연결' },
      ]} />
      <section className="py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="t-section text-finance-ink">관심 종목</h2><p className="mt-1 t-caption text-finance-faint">미보유 · 매수하면 보유로 옮겨집니다</p></div>
          <WatchForm />
        </div>
        {rows.length === 0 ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">관심 종목이 없습니다.</p> : (
          <div className="mt-4 overflow-x-auto border-t border-finance-ink">
            <table className="w-full t-body">
              <thead className="border-b border-finance-border t-label uppercase text-finance-muted"><tr><th className="py-2.5 text-left">종목</th><th className="px-3 py-2.5 text-right">현재가</th><th className="px-3 py-2.5 text-right">등락</th><th className="py-2.5 pl-3 text-right">판정</th></tr></thead>
              <tbody className="divide-y divide-finance-track">
                {rows.map((row) => (
                  <tr key={row.security.id}>
                    <td className="py-3 pr-3"><Link className="t-body-strong text-finance-ink" href={`/investment/${row.security.id}`}><MarketChip market={row.security.market} />{row.security.name} <span className="t-caption font-normal text-finance-faint">{row.security.symbol}</span></Link></td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.price === null ? '–' : formatMoney(row.price, row.security.currency)}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${row.changeRate === null ? 'text-finance-faint' : row.changeRate >= 0 ? 'text-finance-blue' : 'text-finance-red'}`}>{formatPct(row.changeRate)}</td>
                    <td className="py-3 pl-3 text-right t-caption text-finance-faint">미실행</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </InvestmentPageShell>
  )
}
```

- [ ] **Step 6: 통과 확인, 실제 화면 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-pages.test.tsx`
Expected: 4 passed.

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test`

로컬 Supabase가 떠 있으면 `NODE_OPTIONS= pnpm dev`로 띄우고 `dev@finance.local` / `devdev1234`로 로그인해 `/investment`, `/investment/transactions`, `/investment/watch`가 빈 상태 문구와 함께 렌더되는지, 헤더 브랜드가 "우리집 투자"이고 팝오버로 가계부에 돌아가지는지 확인한다. 확인 후 dev 서버를 종료한다.

- [ ] **Step 7: 커밋**

```bash
git add src/app/investment/page.tsx src/app/investment/transactions/page.tsx src/app/investment/watch/page.tsx src/features/investment/transaction-form.tsx src/features/investment/watch-form.tsx src/features/investment/transactions-table.tsx src/features/investment/transaction-row-controls.tsx tests/finance/investment-pages.test.tsx
git commit -m "feat(investment): add holdings, transactions and watch pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: 추이·어드바이저·종목 상세·설정 페이지

**시각 참조:** 추이 `03-trend-desktop.png`(좌 차트·우 비중 막대, 범위·기간 토글), 어드바이저 `06-advisor-desktop.png`·`12-advisor-mobile.png`(1단계는 좌측 리포트 자리가 빈 상태 문구), 종목 상세 `07-detail-desktop.png`·`13-detail-mobile.png`(제목 줄, KPI 4개, 우측 보유 메모 폼. 3축 판정·논지 표·영역 목록은 3단계 몫이라 빈 상태), 다크 `09-detail-dark.png`. 설정 화면은 목업에 없으므로 `src/app/settings/page.tsx`의 자산 계정 섹션 마크업을 따른다.

**Files:**
- Create: `src/app/investment/trend/page.tsx`
- Create: `src/app/investment/advisor/page.tsx`
- Create: `src/app/investment/[securityId]/page.tsx`
- Create: `src/app/investment/settings/page.tsx`
- Create: `src/features/investment/trend-chart.tsx`
- Create: `src/features/investment/allocation-bars.tsx`
- Create: `src/features/investment/holding-memo-form.tsx`
- Create: `src/features/investment/account-form.tsx`
- Test: `tests/finance/investment-detail.test.tsx`

**Interfaces:**
- Consumes: Task 6 queries·actions, Task 7 부품, `src/features/analytics/chart-js.ts`의 `useFinanceChartPalette`, `financeScales`, `financeTooltip`, `CHART_HEIGHT`, `CHART_ANIMATIONS`.
- Produces: `TrendChart({ points, scope })`(client, Line 두 계열: 평가금액 `palette.series[0]`, 투입원금 `palette.series[1]`), `AllocationBars({ items })`, `HoldingMemoForm({ security })`(client, `saveHoldingMemo`), `AccountForm({ account? })`(client, `saveInvestmentAccount`).
- 어드바이저·종목 상세의 AI 영역은 1단계에서 **빈 상태**만 그린다: "헬스체크는 3단계에서 연결됩니다" + 비활성 버튼. 3단계가 이 자리를 채운다.

- [ ] **Step 1: 실패하는 테스트**

`tests/finance/investment-detail.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/investment/actions', () => ({ saveHoldingMemo: vi.fn(), saveInvestmentAccount: vi.fn() }))

import { AccountForm } from '@/features/investment/account-form'
import { AllocationBars } from '@/features/investment/allocation-bars'
import { HoldingMemoForm } from '@/features/investment/holding-memo-form'

describe('HoldingMemoForm', () => {
  const html = renderToStaticMarkup(<HoldingMemoForm security={{ id: 1, thesis: 'HBM 수요', horizonYears: 5, fundsNeededAt: null, lossLimitPct: null, weightBasis: 'stock_accounts' }} />)
  it('renders every v3 input with the stored values and an explicit "no limit" placeholder', () => {
    for (const label of ['매수 논지', '투자 기간', '자금 사용 시점', '손실 한도', '비중 분모']) expect(html).toContain(label)
    expect(html).toContain('value="HBM 수요"')
    expect(html).toContain('value="5"')
    expect(html).toContain('없음 (리포트가 임의로 만들지 않음)')
    expect(html).toContain('name="securityId"')
  })
})

describe('AccountForm', () => {
  it('masks nothing in the editor but never renders the secret itself', () => {
    const html = renderToStaticMarkup(<AccountForm account={{ id: 3, owner: 'DJ', name: 'DJ 키움 종합', brokerAccountNo: '12345678', active: true, lastSyncedAt: null, credentialRef: 'dj-kiwoom' }} />)
    expect(html).toContain('value="12345678"')
    expect(html).toContain('value="dj-kiwoom"')
    expect(html).toContain('키체인 항목 이름')
    expect(html).not.toMatch(/secret|appkey/i)
  })
})

describe('AllocationBars', () => {
  it('draws a bar per item with the percentage and flags the largest over 30% as amber', () => {
    const html = renderToStaticMarkup(<AllocationBars items={[{ label: '국내 주식', pct: 75.8 }, { label: '해외 주식', pct: 18.9 }, { label: '원화 예수금', pct: 3 }, { label: '달러 예수금', pct: 2.3 }]} warnAbove={30} />)
    expect((html.match(/role="progressbar"/g) ?? []).length).toBe(4)
    expect(html).toContain('75.8%')
    expect(html).toContain('bg-finance-amber')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-detail.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 차트·막대·폼 부품**

`src/features/investment/trend-chart.tsx`:

```tsx
'use client'

import { Line } from 'react-chartjs-2'

import { CHART_ANIMATIONS, CHART_HEIGHT, CHART_LINE_WIDTH, financeScales, financeTooltip, useFinanceChartPalette } from '@/features/analytics/chart-js'

import { formatMoney } from './format'
import type { Market } from './types'

export function TrendChart({ points, scope }: { points: Array<{ date: string; value: number; cost: number }>; scope: 'total' | Market }) {
  const palette = useFinanceChartPalette()
  const currency = scope === 'US' ? 'USD' : 'KRW'
  const compact = (value: number) => currency === 'USD' ? `$${(value / 1000).toFixed(0)}k` : `${(value / 1e6).toFixed(0)}M`
  return (
    <div style={{ height: CHART_HEIGHT }}>
      <Line
        data={{
          labels: points.map((p) => p.date.slice(5)),
          datasets: [
            { label: '평가금액', data: points.map((p) => p.value), borderColor: palette.series[0], backgroundColor: palette.series[0], borderWidth: CHART_LINE_WIDTH, pointRadius: 0, tension: 0 },
            { label: '투입원금', data: points.map((p) => p.cost), borderColor: palette.series[1], backgroundColor: palette.series[1], borderWidth: CHART_LINE_WIDTH, pointRadius: 0, tension: 0 },
          ],
        }}
        options={{
          responsive: true, maintainAspectRatio: false, animations: CHART_ANIMATIONS,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { ...financeTooltip(palette), callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(Number(ctx.raw ?? 0), currency)}${currency === 'KRW' ? '원' : ''}` } },
          },
          scales: financeScales(palette, { beginAtZero: false, format: compact, showMonths: true }),
        }}
      />
    </div>
  )
}
```

`src/features/investment/allocation-bars.tsx`:

```tsx
export function AllocationBars({ items, warnAbove }: { items: Array<{ label: string; pct: number }>; warnAbove?: number }) {
  const largest = Math.max(...items.map((i) => i.pct), 0)
  return (
    <div className="mt-4">
      {items.map((item) => {
        const warn = warnAbove !== undefined && item.pct === largest && item.pct > warnAbove
        return (
          <div className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3 py-1.5 t-body" key={item.label}>
            <span className="text-finance-muted">{item.label}</span>
            <span aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(item.pct * 10) / 10} className="block h-2 bg-finance-track" role="progressbar">
              <span className={`block h-full ${warn ? 'bg-finance-amber' : 'bg-finance-ink'}`} style={{ width: `${Math.min(100, item.pct)}%` }} />
            </span>
            <span className="text-right tabular-nums text-finance-ink">{item.pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}
```

`src/features/investment/holding-memo-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveHoldingMemo, type ActionState } from './actions'
import type { WeightBasis } from './types'

type Memo = { id: number; thesis: string | null; horizonYears: number | null; fundsNeededAt: string | null; lossLimitPct: number | null; weightBasis: WeightBasis }
const control = 'h-[28px] border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const row = 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 t-caption text-finance-muted'

export function HoldingMemoForm({ security }: { security: Memo }) {
  const [state, action] = useActionState<ActionState, FormData>(saveHoldingMemo, {})
  return (
    <form action={action} className="grid gap-2 border border-finance-border p-3">
      <input name="securityId" type="hidden" value={security.id} />
      <label className={row}>매수 논지<input className={control} defaultValue={security.thesis ?? ''} maxLength={300} name="thesis" placeholder="예: AI 서버용 HBM 수요로 3년간 매출 20%+ 성장" /></label>
      <label className={row}>투자 기간<input className={control} defaultValue={security.horizonYears ?? ''} inputMode="decimal" name="horizonYears" placeholder="년" /></label>
      <label className={row}>자금 사용 시점<input className={control} defaultValue={security.fundsNeededAt ?? ''} maxLength={100} name="fundsNeededAt" placeholder="예: 2031 이후 · 정해진 용처 없음" /></label>
      <label className={row}>손실 한도<input className={control} defaultValue={security.lossLimitPct ?? ''} inputMode="decimal" name="lossLimitPct" placeholder="없음 (리포트가 임의로 만들지 않음)" /></label>
      <label className={row}>비중 분모
        <select className={control} defaultValue={security.weightBasis} name="weightBasis"><option value="stock_accounts">주식 계좌</option><option value="total_assets">전체 투자자산</option></select>
      </label>
      <div className="flex items-center justify-end gap-3">
        {state.error && <span className="t-caption text-finance-red" role="alert">{state.error}</span>}
        {state.message && !state.error && <span className="t-caption text-finance-green" role="status">{state.message}</span>}
        <SubmitButton className="h-[28px] border border-finance-ink px-3 t-caption-strong text-finance-ink" pendingLabel="저장 중…">저장</SubmitButton>
      </div>
    </form>
  )
}
```

`src/features/investment/account-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import { saveInvestmentAccount, type ActionState } from './actions'
import type { AccountRow } from './types'

const control = 'h-[30px] border border-finance-border bg-white px-2 t-body-normal text-finance-ink'
const label = 'grid gap-1 t-label uppercase text-finance-muted'

export function AccountForm({ account }: { account?: AccountRow & { credentialRef: string } }) {
  const [state, action] = useActionState<ActionState, FormData>(saveInvestmentAccount, {})
  return (
    <form action={action} className="grid gap-3 border-t border-finance-border py-4 sm:grid-cols-[100px_minmax(0,1fr)_160px_180px_auto] sm:items-end" key={state.saved?.id ?? account?.id ?? 'new'}>
      {account && <input name="id" type="hidden" value={account.id} />}
      <label className={label}>소유자<input className={control} defaultValue={account?.owner ?? ''} maxLength={20} name="owner" placeholder="DJ" required /></label>
      <label className={label}>계좌 이름<input className={control} defaultValue={account?.name ?? ''} maxLength={60} name="name" placeholder="DJ 키움 종합" required /></label>
      <label className={label}>계좌번호<input className={control} defaultValue={account?.brokerAccountNo ?? ''} inputMode="numeric" name="brokerAccountNo" pattern="[0-9-]{4,20}" required /></label>
      <label className={label}>키체인 항목 이름<input className={control} defaultValue={account?.credentialRef ?? ''} name="credentialRef" pattern="[a-z0-9-]{2,40}" placeholder="dj-kiwoom" required /></label>
      <div className="flex items-center gap-3">
        {account && <label className="inline-flex items-center gap-1.5 t-caption text-finance-muted"><input defaultChecked={account.active} name="active" type="checkbox" />사용</label>}
        <SubmitButton className="h-[30px] bg-finance-ink px-4 t-caption-strong text-white" pendingLabel="저장 중…">{account ? '저장' : '추가'}</SubmitButton>
      </div>
      {state.error && <p className="t-caption text-finance-red sm:col-span-5" role="alert">{state.error}</p>}
      {state.message && !state.error && <p className="t-caption text-finance-green sm:col-span-5" role="status">{state.message}</p>}
    </form>
  )
}
```

`getInvestmentSettingsData`가 `credentialRef`를 돌려주도록 Task 6의 함수를 고친다: `loadPortfolioInputs` 대신 `db.select().from(investmentAccounts).where(eq(investmentAccounts.householdId, householdId)).orderBy(asc(investmentAccounts.sortOrder), asc(investmentAccounts.id))`를 직접 읽어 `{ accounts: Array<AccountRow & { credentialRef: string }> }`를 반환한다. 키체인 항목 **이름**은 비밀이 아니다(시크릿 본문은 Mac 키체인에만 있다, 명세 4.4).

- [ ] **Step 4: 페이지 네 개**

`src/app/investment/trend/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AllocationBars } from '@/features/investment/allocation-bars'
import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, getTrendData, loadPortfolioInputs } from '@/features/investment/queries'
import { TrendChart } from '@/features/investment/trend-chart'
import { requireHousehold } from '@/lib/household'

type Range = '1m' | '3m' | '1y' | 'all'
type Scope = 'total' | 'KR' | 'US'
type Props = { searchParams: Promise<{ range?: string | string[]; scope?: string | string[] }> }

const RANGES: Array<[Range, string]> = [['1m', '1개월'], ['3m', '3개월'], ['1y', '1년'], ['all', '전체']]
const SCOPES: Array<[Scope, string]> = [['total', '합계'], ['KR', '국내'], ['US', '해외 $']]
const href = (range: Range, scope: Scope) => `/investment/trend?range=${range}&scope=${scope}`

export default async function InvestmentTrendPage({ searchParams }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const range = (RANGES.find(([key]) => key === params.range)?.[0] ?? '3m') as Range
  const scope = (SCOPES.find(([key]) => key === params.scope)?.[0] ?? 'total') as Scope
  const [trend, holdings, inputs] = await Promise.all([getTrendData(household.householdId, range, scope), getHoldingsData(household.householdId), loadPortfolioInputs(household.householdId)])
  const first = trend.points[0]; const last = trend.points[trend.points.length - 1]
  const delta = first && last ? last.value - first.value : null
  const currency = scope === 'US' ? 'USD' : 'KRW'
  const segment = (items: Array<[string, string]>, active: string, make: (key: string) => string) => (
    <div className="flex border border-finance-border" role="group">
      {items.map(([key, text]) => <Link aria-pressed={active === key} className={`flex h-[26px] items-center border-r border-finance-border px-2.5 t-caption-strong last:border-r-0 ${active === key ? 'bg-finance-track text-finance-ink' : 'text-finance-muted'}`} href={make(key)} key={key}>{text}</Link>)}
    </div>
  )
  return (
    <InvestmentPageShell active="investment-trend" email={household.email} eyebrow="Trend" title="추이" subtitle="평가금액 · 투입원금 · 비중"
      status={holdings.status} owners={[]} owner={null} ownerHref={() => '/investment/trend'}>
      <KpiBand items={[
        { label: `${RANGES.find(([k]) => k === range)![1]} 변동 (${scope === 'US' ? '달러' : '원화'})`, value: delta === null ? '–' : formatSigned(delta, currency), tone: delta === null ? 'ink' : delta >= 0 ? 'blue' : 'red', caption: trend.empty ? '일별 스냅샷은 키움 연동 후 쌓입니다' : `${first.date} → ${last.date}` },
        { label: '국내 평가', value: <>{formatMoney(holdings.summary.KR.value, 'KRW')}<span className="ml-1 t-body font-medium text-finance-muted">원</span></>, caption: <>손익 {formatSigned(holdings.summary.KR.unrealized, 'KRW')} · {formatPct(holdings.summary.KR.returnPct)}</> },
        { label: '해외 평가', value: formatMoney(holdings.summary.US.value, 'USD'), caption: <>손익 {formatSigned(holdings.summary.US.unrealized, 'USD')} · {formatPct(holdings.summary.US.returnPct)}</> },
        { label: '연환산 수익률', value: '–', caption: '스냅샷 1년 이상 쌓이면 계산' },
      ]} />
      <section className="grid gap-10 py-7 xl:grid-cols-[1.2fr_1fr] xl:gap-x-0">
        <article className="min-w-0 xl:pr-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="t-section text-finance-ink">평가금액 추이</h2><p className="mt-1 t-caption text-finance-faint">일별 종가 스냅샷 · {scope === 'total' ? '원화 환산 합계' : scope === 'KR' ? '국내 · 원' : '해외 · 달러'}</p></div>
            <div className="flex flex-wrap gap-2">{segment(SCOPES, scope, (key) => href(range, key as Scope))}{segment(RANGES, range, (key) => href(key as Range, scope))}</div>
          </div>
          {trend.empty
            ? <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">아직 일별 스냅샷이 없습니다. 키움 연동(2단계)이 켜지면 장 마감마다 쌓이고 빠진 날은 백필됩니다.</p>
            : <div className="mt-5 min-w-0"><TrendChart points={trend.points} scope={scope} /><p className="mt-3 flex gap-4 t-caption text-finance-muted"><span><i className="mr-1.5 inline-block h-[2px] w-3.5 bg-[var(--chart-1)] align-middle" />평가금액</span><span><i className="mr-1.5 inline-block h-[2px] w-3.5 bg-[var(--chart-2)] align-middle" />투입원금</span></p></div>}
        </article>
        <article className="min-w-0 xl:border-l xl:border-finance-border xl:pl-10">
          <div><h2 className="t-section text-finance-ink">비중</h2><p className="mt-1 t-caption text-finance-faint">평가금액 기준 · 원화 환산 · 시장</p></div>
          {inputs.fx === null && <p className="mt-2 t-caption text-finance-amber">환율이 없어 해외·달러 항목은 0으로 보입니다.</p>}
          <AllocationBars items={trend.allocation} />
          <p className="mt-3 t-caption text-finance-faint">섹터·통화 노출·소유자·계좌 기준은 헬스체크가 섹터를 채우는 3단계에서 추가합니다.</p>
        </article>
      </section>
    </InvestmentPageShell>
  )
}
```

`src/app/investment/advisor/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

import { formatMoney } from '@/features/investment/format'
import { KpiBand } from '@/features/investment/kpi-band'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getHoldingsData, getTrendData } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentAdvisorPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const [holdings, trend] = await Promise.all([getHoldingsData(household.householdId), getTrendData(household.householdId, '3m', 'total')])
  const cashPct = trend.allocation.filter((a) => a.label.includes('예수금')).reduce((s, a) => s + a.pct, 0)
  const kr = trend.allocation.find((a) => a.label === '국내 주식')?.pct ?? 0
  const us = trend.allocation.find((a) => a.label === '해외 주식')?.pct ?? 0
  return (
    <InvestmentPageShell active="investment-advisor" email={household.email} eyebrow="Advisor" title="어드바이저" subtitle="포트폴리오 리포트 · 종목 발굴"
      status={holdings.status} owners={[]} owner={null} ownerHref={() => '/investment/advisor'}>
      <KpiBand items={[
        { label: '최대 섹터 집중', value: '–', caption: '섹터는 헬스체크가 채웁니다 (3단계)' },
        { label: '현금 비중', value: `${cashPct.toFixed(1)}%`, caption: <>₩{formatMoney(holdings.summary.cashKRW, 'KRW')} · {formatMoney(holdings.summary.cashUSD, 'USD')}</> },
        { label: '국내 · 해외', value: `${kr.toFixed(0)} · ${us.toFixed(0)}%`, caption: '평가금액 기준' },
        { label: '마지막 리포트', value: '–', caption: '아직 실행한 리포트가 없습니다' },
      ]} />
      <section className="border-b border-finance-border py-7">
        <h2 className="t-section text-finance-ink">포트폴리오 리포트</h2>
        <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">어드바이저는 로컬 Mac 워커와 Codex를 연결하는 3단계에서 켜집니다. 지금은 보유·거래·관심 데이터를 쌓아 두는 단계입니다.</p>
        <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white disabled:opacity-40" disabled title="3단계에서 연결" type="button">어드바이저 실행</button>
      </section>
      <section className="py-7">
        <h2 className="t-section text-finance-ink">종목 발굴</h2>
        <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">조건을 적어 후보 종목을 찾는 기능도 3단계에서 켜집니다.</p>
      </section>
    </InvestmentPageShell>
  )
}
```

`src/app/investment/[securityId]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { formatMoney, formatPct, formatSigned } from '@/features/investment/format'
import { HoldingMemoForm } from '@/features/investment/holding-memo-form'
import { KpiBand } from '@/features/investment/kpi-band'
import { MarketChip } from '@/features/investment/market-chip'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getSecurityDetail, loadPortfolioInputs } from '@/features/investment/queries'
import { TransactionsTable } from '@/features/investment/transactions-table'
import { requireHousehold } from '@/lib/household'

type Props = { params: Promise<{ securityId: string }> }

export default async function InvestmentSecurityPage({ params }: Props) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const { securityId } = await params
  const id = Number(securityId)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const [detail, inputs] = await Promise.all([getSecurityDetail(household.householdId, id), loadPortfolioInputs(household.householdId)])
  if (!detail) notFound()
  const { security, positions } = detail
  const c = security.currency
  const quantity = positions.reduce((s, p) => s + p.quantity, 0)
  const cost = positions.reduce((s, p) => s + p.costBasis, 0)
  const avg = quantity > 0 ? cost / quantity : null
  const value = positions.every((p) => p.marketValue !== null) ? positions.reduce((s, p) => s + (p.marketValue ?? 0), 0) : null
  const unrealized = value === null ? null : value - cost
  const weight = positions[0]?.weightPct ?? null
  const byOwner = positions.map((p) => `${inputs.accounts.find((a) => a.id === p.accountId)?.owner ?? '?'} ${p.quantity}`).join(' · ')
  const discrepancy = positions.find((p) => p.discrepancy)?.discrepancy ?? null
  return (
    <InvestmentPageShell active="investment" email={household.email} eyebrow={`${security.market} · ${security.symbol}${security.businessType ? ` · ${security.businessType}` : ''}`} title={security.name}
      subtitle={<>{detail.price === null ? '시세 없음' : <>{formatMoney(detail.price, c)}{c === 'KRW' ? '원' : ''} <span className={detail.changeRate === null ? 'text-finance-faint' : detail.changeRate >= 0 ? 'text-finance-blue' : 'text-finance-red'}>{formatPct(detail.changeRate)}</span></>}</>}
      status={{ quotedAt: inputs.quotedAt, fx: inputs.fx, lastSyncedAt: inputs.lastSyncedAt, workerConnected: false }} owners={[]} owner={null} ownerHref={() => '/investment'}>
      <nav className="mt-3 flex flex-wrap items-center gap-3 t-caption text-finance-muted" aria-label="이동">
        <Link className="font-semibold text-finance-blue" href="/investment">‹ 보유</Link>
        <span className="ml-auto flex gap-3">
          {detail.neighbors.prev && <Link className="font-semibold text-finance-blue" href={`/investment/${detail.neighbors.prev.id}`}>‹ {detail.neighbors.prev.name}</Link>}
          {detail.neighbors.next && <Link className="font-semibold text-finance-blue" href={`/investment/${detail.neighbors.next.id}`}>{detail.neighbors.next.name} ›</Link>}
        </span>
      </nav>
      <KpiBand items={[
        { label: '보유', value: quantity === 0 ? '미보유' : <>{quantity}<span className="ml-1 t-body font-medium text-finance-muted">주</span></>, caption: quantity === 0 ? (security.watching ? '관심 종목' : '') : <>{byOwner}{weight !== null && <> · 비중 {weight.toFixed(1)}%</>}</> },
        { label: '평균단가', value: avg === null ? '–' : formatMoney(avg, c), caption: discrepancy ? <span className="text-finance-amber">증권사 {formatMoney(discrepancy.brokerAvg, c)} · {discrepancy.avgDiffPct?.toFixed(1)}% 차이</span> : '이동평균' },
        { label: '평가손익', value: unrealized === null ? '–' : formatSigned(unrealized, c), tone: unrealized === null ? 'ink' : unrealized >= 0 ? 'blue' : 'red', caption: value === null ? '시세 없음' : <>{formatPct(cost === 0 ? null : unrealized! / cost * 100)} · 평가 {formatMoney(value, c)}</> },
        { label: '다음 점검', value: security.nextCheckDate ? security.nextCheckDate.slice(5) : '–', caption: '헬스체크는 3단계에서 연결' },
      ]} />
      <div className="grid gap-8 py-7 xl:grid-cols-[1.6fr_1fr]">
        <article>
          <MarketChip market={security.market} />
          <h2 className="mt-3 t-section text-finance-ink">헬스체크</h2>
          <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">세 판정(기업 상태 · 가격 부담 · 보유 적합성), 매수 논지 검증, 기업 상태 5영역, 밸류에이션 역산은 로컬 워커와 Codex를 연결하는 3단계에서 이 자리에 표시됩니다. 지금은 아래 보유 메모를 채워 두면 첫 리포트의 입력이 됩니다.</p>
          <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white disabled:opacity-40" disabled title="3단계에서 연결" type="button">헬스체크 실행</button>
          <h3 className="mt-8 t-section text-finance-ink">이 종목 거래</h3>
          <TransactionsTable rows={detail.transactions} />
        </article>
        <aside className="xl:border-l xl:border-finance-border xl:pl-8">
          <div className="flex items-baseline justify-between"><h3 className="t-section text-finance-ink">보유 메모</h3><span className="t-caption text-finance-faint">헬스체크 v3 입력</span></div>
          <div className="mt-3"><HoldingMemoForm security={{ id: security.id, thesis: security.thesis, horizonYears: security.horizonYears, fundsNeededAt: security.fundsNeededAt, lossLimitPct: security.lossLimitPct, weightBasis: security.weightBasis }} /></div>
          <p className="mt-3 t-caption text-finance-faint">매수 논지가 없으면 리포트가 공시를 바탕으로 가설 초안을 만들되 사용자 논지로 단정하지 않습니다. 손실 한도가 없으면 임의로 만들지 않습니다.</p>
        </aside>
      </div>
    </InvestmentPageShell>
  )
}
```

`src/app/investment/settings/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

import { AccountForm } from '@/features/investment/account-form'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getInvestmentSettingsData } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentSettingsPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const { accounts } = await getInvestmentSettingsData(household.householdId)
  return (
    <InvestmentPageShell active="investment-settings" email={household.email} eyebrow="Settings" title="투자 설정" subtitle="증권 계좌"
      owners={[]} owner={null} ownerHref={() => '/investment/settings'}>
      <section className="py-7">
        <div><h2 className="t-section text-finance-ink">증권 계좌</h2><p className="mt-1 t-caption text-finance-faint">키움 계좌와 소유자. 앱키·시크릿은 여기 저장하지 않고 워커 Mac의 키체인에만 둡니다. 여기 적는 건 키체인 항목 이름입니다.</p></div>
        <div className="mt-4">
          {accounts.map((account) => <AccountForm account={account} key={account.id} />)}
          <h3 className="mt-6 t-caption-strong text-finance-muted">새 계좌</h3>
          <AccountForm />
        </div>
      </section>
      <section className="border-t border-finance-border py-7">
        <h2 className="t-section text-finance-ink">AI 지침 · 기업 상태 영역 · 일일 상한</h2>
        <p className="mt-2 t-caption text-finance-muted">헬스체크·어드바이저·발굴 지침 편집과 영역 편집기는 3단계에서 이 자리에 들어갑니다.</p>
      </section>
    </InvestmentPageShell>
  )
}
```

- [ ] **Step 5: 통과 확인과 화면 확인**

Run: `NODE_OPTIONS= pnpm exec vitest run --project unit tests/finance/investment-detail.test.tsx`
Expected: 3 passed.

Run: `NODE_OPTIONS= pnpm exec tsc --noEmit && NODE_OPTIONS= pnpm lint && NODE_OPTIONS= pnpm test && NODE_OPTIONS= pnpm test:db`

`NODE_OPTIONS= pnpm dev`로 띄워 로그인 후: `/investment/settings`에서 계좌 추가 → `/investment/transactions`에서 입금·매수 입력 → `/investment`에 계좌 행·국내 소그룹·종목 행이 나오고 KPI가 맞는지 → 종목 행 클릭 → 상세에서 보유 메모 저장 → `/investment/trend`에 빈 상태와 비중 막대 → `/investment/advisor` 빈 상태. 1440px과 390px 폭에서 각각 확인하고 dev 서버를 종료한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/investment/trend/page.tsx src/app/investment/advisor/page.tsx "src/app/investment/[securityId]/page.tsx" src/app/investment/settings/page.tsx src/features/investment/trend-chart.tsx src/features/investment/allocation-bars.tsx src/features/investment/holding-memo-form.tsx src/features/investment/account-form.tsx src/features/investment/queries.ts tests/finance/investment-detail.test.tsx
git commit -m "feat(investment): add trend, advisor, security detail and settings pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: E2E와 최종 게이트

**Files:**
- Create: `tests/e2e/investment.spec.ts`

- [ ] **Step 1: E2E 작성**

`tests/e2e/investment.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

test('investment space: account, manual trades, holdings totals, collapse, detail memo', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const databaseUrl = process.env.DATABASE_URL!
  for (const value of [supabaseUrl, databaseUrl]) if (!['localhost', '127.0.0.1'].includes(new URL(value).hostname)) throw new Error('investment E2E requires local Supabase')
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const database = postgres(databaseUrl, { prepare: false, max: 1 })
  const email = `investment-e2e-${crypto.randomUUID()}@example.com`
  const password = randomBytes(20).toString('base64url')
  const auth = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error) throw auth.error
  let householdId: string | undefined
  try {
    const [household] = await database`insert into households (name) values ('investment E2E') returning id`
    householdId = household.id
    await database`insert into household_members (household_id, user_id) values (${householdId!}, ${auth.data.user.id})`
    await database`insert into fx_rates (household_id, date, pair, rate, source) values (${householdId!}, '2026-09-27', 'USDKRW', 1380.2, 'manual')`

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/login')
    await page.getByPlaceholder('이메일').fill(email)
    await page.getByPlaceholder('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')

    // 공간 전환
    await page.getByRole('button', { name: '공간 전환' }).click()
    await page.getByRole('menuitem', { name: /우리집 투자/ }).click()
    await expect(page).toHaveURL('/investment')
    await expect(page.getByRole('heading', { name: '보유', exact: true })).toBeVisible()
    await expect(page.getByText('계좌가 없습니다')).toBeVisible()

    // 계좌 추가
    await page.goto('/investment/settings')
    await page.getByLabel('소유자').fill('DJ')
    await page.getByLabel('계좌 이름').fill('DJ 키움 종합')
    await page.getByLabel('계좌번호').fill('12345678')
    await page.getByLabel('키체인 항목 이름').fill('dj-kiwoom')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await expect(page.getByText('계좌를 추가했습니다')).toBeVisible()

    // 관심 종목으로 종목 등록 후 거래 입력
    await page.goto('/investment/watch')
    await page.getByLabel('종목코드').fill('005930')
    await page.getByLabel('이름').fill('삼성전자')
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await expect(page.getByText('관심 종목을 추가했습니다')).toBeVisible()

    await page.goto('/investment/transactions')
    await page.getByLabel('종류').selectOption('deposit')
    await page.getByLabel('금액').fill('10000000')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('거래를 저장했습니다')).toBeVisible()
    await page.getByLabel('종류').selectOption('buy')
    await page.getByLabel('종목').selectOption({ label: '삼성전자 (005930)' })
    await page.getByLabel('수량').fill('120')
    await page.getByLabel('단가').fill('71200')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('거래를 저장했습니다')).toBeVisible()
    await page.getByLabel('종류').selectOption('sell')
    await page.getByLabel('종목').selectOption({ label: '삼성전자 (005930)' })
    await page.getByLabel('수량').fill('200')
    await page.getByLabel('단가').fill('80000')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('보유 120주보다 많이 팔 수 없습니다')).toBeVisible()

    // 보유 화면: 소그룹, 합계, 접기
    await page.goto('/investment')
    await expect(page.getByText('DJ 키움 종합')).toBeVisible()
    await expect(page.getByText('국내', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /삼성전자/ })).toBeVisible()
    await expect(page.getByText('시세 없음').first()).toBeVisible()
    await expect(page.getByText('71,200')).toBeVisible()
    const subgroup = page.locator('tr[aria-expanded="true"]').nth(1)
    await subgroup.click()
    await expect(page.getByRole('link', { name: /삼성전자/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('link', { name: /삼성전자/ })).toHaveCount(0)
    await page.locator('tr[aria-expanded="false"]').first().click()
    await expect(page.getByRole('link', { name: /삼성전자/ })).toBeVisible()

    // 상세: 보유 메모
    await page.getByRole('link', { name: /삼성전자/ }).click()
    await expect(page.getByRole('heading', { name: '삼성전자' })).toBeVisible()
    await page.getByLabel('매수 논지').fill('HBM 수요')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('보유 메모를 저장했습니다')).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/investment')
    await page.screenshot({ path: testInfo.outputPath('investment-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: testInfo.outputPath('investment-desktop.png'), fullPage: true })

    // 가계부로 복귀
    await page.getByRole('button', { name: '공간 전환' }).click()
    await page.getByRole('menuitem', { name: /우리집 가계부/ }).click()
    await expect(page).toHaveURL('/dashboard')
    await page.goto('/')
    await expect(page).toHaveURL('/dashboard')
  } finally {
    if (householdId) await database`delete from households where id = ${householdId}`
    await admin.auth.admin.deleteUser(auth.data.user.id)
    await database.end()
  }
})
```

시세가 없으면 평가금액 열은 `–`이고 국내 평가 KPI는 0이다. 위 단언은 그 상태를 검사한다(평균단가 열의 71,200과 "시세 없음" 표시).

- [ ] **Step 2: E2E 실행**

Run: `NODE_OPTIONS= pnpm e2e tests/e2e/investment.spec.ts`
Expected: 1 passed. 실패하면 실패 지점의 셀렉터·문구를 실제 렌더에 맞춰 고치되, 단언이 검사하는 동작 자체를 약화하지 않는다.

- [ ] **Step 3: 최종 게이트**

Run (순서대로, 결과를 실제 숫자로 기록):

```
NODE_OPTIONS= pnpm exec tsc --noEmit
NODE_OPTIONS= pnpm lint
NODE_OPTIONS= pnpm test
NODE_OPTIONS= pnpm test:db
NODE_OPTIONS= pnpm build
NODE_OPTIONS= pnpm e2e
```

Expected: 전부 통과. `pnpm e2e`가 `docs/design/budget-editor/result/`의 PNG를 다시 쓰면 그 파일들은 스테이징하지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add tests/e2e/investment.spec.ts
git commit -m "test(investment): add end-to-end coverage for the investment space

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 이 계획이 끝나면

- 명세 5절의 1단계가 끝난다. 다음 계획은 2단계(키움 어댑터·워커 RPC·동기화·스냅샷·실시간 시세, `diagnosis_workers.capabilities`)이고, 그 다음이 3단계(헬스체크 v3·어드바이저·발굴, AI 지침·영역 편집)다.
- 1단계에서 "3단계에서 연결"로 비워 둔 자리: 관심 화면 KPI 두 칸, 어드바이저 화면 전체, 종목 상세 헬스체크 블록과 다음 점검 KPI, 설정 화면 AI 섹션, 추이 화면 비중 기준(섹터·통화 노출·소유자·계좌)과 연환산 수익률.
- 1단계에서 "2단계에서 연결"로 비워 둔 자리: 상태 줄의 워커 연결·지금 동기화, 추이 차트 데이터, 보유 표의 증권사 괴리(broker_positions가 채워져야 나온다).

# 고정확도 반자동 분류 (Smart Classification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 내역(뱅샐/카드사 명세서)이 자가 축적 머천트 캐시 + 좁은 AI 폴백으로 반자동·고정확도 분류되고, 인박스에서 확신 항목은 접혀 일괄승인, 애매한 것만 확인하게 만든다.

**Architecture:** 분류 우선순위 = ① user-캐시 → ② 거래 이력(norm) → ③ ai-캐시 → ④ AI+웹서치 1회 배치(결과는 캐시로) → ⑤ 뱅샐 매핑 → ⑥ 빈칸. 모든 해석 결과에 확신도(high/review)를 붙이고, 인박스 UI가 그걸로 접기/펼치기를 나눈다. 애그리게이터(쿠팡 등)는 항상 review(정확금액 반복 구독만 예외).

**Tech Stack:** 기존 finance-web 스택(Next.js 15, TS, Drizzle, Supabase, Vitest, Playwright) + 신규: `xlsx`(SheetJS — 카드 파일의 xlsx/BIFF/HTML 3종 파싱), `openai`(AI 폴백 — 사용자 결정: OpenAI API, Responses API + `web_search` 툴, `gpt-5-mini`).

**Spec:** `docs/superpowers/specs/2026-09-01-smart-classification-design.md` (이 플랜의 논거. 실행자는 둘 다 읽을 것.)
카드 포맷 원명세: `/Users/leedj/workspace/Personal/finance/card_import.py` (구 Flask 파서 — 헤더 키워드·중단 규칙의 출처), 실파일: `/Users/leedj/workspace/Personal/finance/imports/` (개인정보 — repo에 복사 금지, 로컬 수동 검증만).

## Global Constraints

- **모든 Drizzle 쿼리는 `requireHousehold()`의 householdId로 명시 필터** — DATABASE_URL은 owner 접속이라 RLS 우회 (기반 플랜에서 상속).
- **일관성 원칙**: 같은 가맹점은 결정적으로 같은 분류. AI는 캐시/이력 miss인 가맹점에만, 결과는 캐시에 저장(가맹점당 1회).
- **AI 가드레일**: AI 제안은 인박스에서 절대 'high'가 되지 않는다. AI에 전송하는 것은 가맹점명·분류체계·확정예시뿐(금액·날짜 미전송).
- **자동 반영 없음**: 모든 항목은 인박스 경유. high는 접힘+일괄승인.
- **category_rules 동결**: 이 플랜부터 학습·조회 모두 merchant_lookup로. category_rules는 읽기/쓰기 모두 중단(테이블·기존 데이터는 유지).
- **sugSource 값**: 'user' | 'history' | 'ai' | 'banksalad' | null. **confidence 값**: 'high' | 'review'.
- **애그리게이터 시드**(norm 기준): 쿠팡, 네이버페이, 카카오페이, 지마켓, 옥션, 번가(11번가의 norm), 페이코, 토스, 네이버파이낸셜. 예외: '쿠팡이츠' 포함 문자열은 애그리게이터 아님(음식배달=식비 명확).
- **테스트**: 기존 vitest 설정 그대로(`pnpm test`), 실카드파일은 repo에 넣지 않는다(합성 픽스처만). 커밋은 태스크마다.
- 금액은 정수 KRW. 카드 명세서 행은 지출(expense)만 생성.

---

## File Structure

```
src/db/schema/lookup.ts                    # merchant_lookup 테이블 (신규)
src/db/schema/inbox.ts                     # confidence 컬럼 추가 (수정)
drizzle/00XX_*.sql + 00XX_lookup_rls.sql   # 마이그레이션 (자동 + RLS custom)
src/features/inbox/normalize.ts            # normalizeMerchant 추출 (banksalad.ts에서 이동)
src/features/inbox/merchant-lookup.ts      # 캐시 조회/upsert/애그리게이터 (신규)
src/features/inbox/confidence.ts           # assessConfidence 순수함수 (신규)
src/features/inbox/parsers/cards.ts        # 카드사 5종 파서 + 지문 (신규)
src/features/inbox/ai-classify.ts          # AI 폴백 (신규)
src/features/inbox/resolve-suggestion.ts   # 우선순위 해석 오케스트레이션 (신규)
src/features/inbox/banksalad.ts            # buildAmountRepeatIndex 추가, normalize import 전환 (수정)
src/features/inbox/upload-action.ts        # 뱅샐 스테이징 재배선 + 카드 업로드 액션 (수정)
src/features/inbox/actions.ts              # 커밋 학습을 merchant_lookup로 전환 (수정)
src/features/inbox/inbox-review-form.tsx   # 2단 UI + 배지 + 일괄승인 (수정)
src/app/inbox/page.tsx                     # high/review 분리 전달 (수정)
src/app/manage/…                           # 가맹점 사전 탭 (수정/신규)
tests/finance/{merchant-lookup,confidence,card-parsers,ai-classify,…}.test.ts
tests/e2e/smart-classification.spec.ts
```

---

### Task 1: merchant_lookup 스키마 + inbox.confidence + RLS

**Files:**
- Create: `src/db/schema/lookup.ts`, `drizzle/00XX_*.sql`(자동 생성), `drizzle/00XX_lookup_rls.sql`(custom)
- Modify: `src/db/schema/index.ts`, `src/db/schema/inbox.ts`
- Test: `tests/db/schema.test.ts`(확장)

**Interfaces:**
- Produces: `merchantLookup` Drizzle 테이블(컬럼: id, householdId, normMerchant, displayMerchant, businessType, categoryId, flow, source, confidence, aiNote, alwaysConfirm, hitCount, lastUsedAt; unique(householdId, normMerchant)). `importInbox.confidence`(text, NOT NULL, default 'review').

- [ ] **Step 1: 실패하는 스키마 테스트 추가**

`tests/db/schema.test.ts`의 기존 "all core tables exist" 테스트의 테이블 목록에 `'merchant_lookup'` 추가, 그리고 아래 테스트 추가:
```ts
test('import_inbox has confidence column', async () => {
  const rows = await db.execute<{ column_name: string }>(sql`
    select column_name from information_schema.columns
    where table_name = 'import_inbox'
  `)
  expect(rows.map((r) => r.column_name)).toContain('confidence')
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm test tests/db/schema.test.ts`
Expected: FAIL (merchant_lookup 없음, confidence 없음)

- [ ] **Step 3: 스키마 작성**

Create `src/db/schema/lookup.ts`:
```ts
import {
  pgTable, bigint, uuid, text, boolean, integer, timestamp, unique,
} from 'drizzle-orm/pg-core'
import { households } from './auth'
import { categories } from './taxonomy'
import { flowEnum } from '../enums'

/** 가맹점 사전(자가 축적 캐시): 사용자 확정(user)과 AI 조회 결과(ai)가 쌓인다.
 *  source 우선순위: user > ai — upsert에서 user 레코드를 ai가 덮지 못한다. */
export const merchantLookup = pgTable(
  'merchant_lookup',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    normMerchant: text('norm_merchant').notNull(),
    displayMerchant: text('display_merchant'),
    businessType: text('business_type'),          // "카페", "주유소" — 근거 표시용
    categoryId: bigint('category_id', { mode: 'number' }).references(() => categories.id),
    flow: flowEnum('flow').notNull().default('expense'),
    source: text('source').notNull(),             // 'user' | 'ai'
    confidence: text('confidence').notNull().default('high'), // 'high' | 'low' (AI 자신감)
    aiNote: text('ai_note'),
    alwaysConfirm: boolean('always_confirm').notNull().default(false), // 애그리게이터
    hitCount: integer('hit_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [unique('merchant_lookup_household_norm').on(t.householdId, t.normMerchant)],
)
```

Modify `src/db/schema/inbox.ts` — `importInbox` 컬럼 정의에 추가(`status` 바로 위):
```ts
    confidence: text('confidence').notNull().default('review'), // 'high' | 'review'
```

Modify `src/db/schema/index.ts` — 배럴에 추가:
```ts
export * from './lookup'
```

- [ ] **Step 4: 마이그레이션 생성 + RLS custom + 적용**

Run:
```bash
pnpm db:generate
pnpm exec drizzle-kit generate --custom --name lookup_rls
```
생성된 custom 파일(`drizzle/00XX_lookup_rls.sql`)에 작성:
```sql
grant select, insert, update, delete on merchant_lookup to authenticated;
--> statement-breakpoint
alter table "merchant_lookup" enable row level security;
--> statement-breakpoint
create policy "merchant_lookup_household_rls" on "merchant_lookup"
  for all to authenticated
  using (public.is_member(household_id))
  with check (public.is_member(household_id));
```
Run: `pnpm db:migrate`
Expected: 두 마이그레이션 적용 성공.

- [ ] **Step 5: 테스트 통과 확인 + 커밋**

Run: `pnpm test tests/db/schema.test.ts`
Expected: PASS
```bash
git add -A && git commit -m "feat(db): merchant_lookup table + inbox confidence column with RLS"
```

---

### Task 2: normalize 추출 + 머천트 캐시 모듈

**Files:**
- Create: `src/features/inbox/normalize.ts`, `src/features/inbox/merchant-lookup.ts`
- Modify: `src/features/inbox/banksalad.ts`(normalize 함수를 이동하고 import로 교체), `src/features/inbox/upload-action.ts`·`src/features/inbox/actions.ts`(같은 함수를 쓰고 있으면 import 경로만 교체)
- Test: `tests/finance/merchant-lookup.test.ts`

**Interfaces:**
- Consumes: Task 1의 `merchantLookup`.
- Produces:
  - `normalizeMerchant(s: string | null | undefined): string` — **기존 banksalad.ts의 정규화 함수를 그대로 이동**(동작 변경 금지 — 기존 이력 서제스터/중복감지와 키가 같아야 함).
  - `type LookupSource = 'user' | 'ai'`
  - `type MerchantLookupEntry = { normMerchant: string; displayMerchant: string | null; businessType: string | null; categoryId: number | null; flow: 'expense' | 'income' | 'saving'; source: LookupSource; confidence: 'high' | 'low'; aiNote: string | null; alwaysConfirm: boolean }`
  - `lookupMerchants(householdId: string, norms: string[]): Promise<Map<string, MerchantLookupEntry>>`
  - `upsertMerchantLookup(householdId: string, entry: { normMerchant: string; displayMerchant?: string | null; categoryId: number | null; flow: 'expense' | 'income' | 'saving'; businessType?: string | null; aiNote?: string | null; confidence?: 'high' | 'low' }, source: LookupSource): Promise<void>`
  - `isAggregatorNorm(norm: string): boolean`, `AGGREGATOR_NORMS: string[]`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/finance/merchant-lookup.test.ts` (기존 tests/finance/*의 셋업 패턴 — 테스트 가구 생성/정리 헬퍼가 있으면 재사용, 없으면 raw insert로 가구 생성 후 afterAll 삭제):
```ts
import { beforeAll, afterAll, expect, test } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  lookupMerchants, upsertMerchantLookup, isAggregatorNorm,
} from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'

let hid: string
let catId: number

beforeAll(async () => {
  const [h] = await db.execute<{ id: string }>(
    sql`insert into households (name) values ('TEST-lookup') returning id`)
  hid = h.id
  const [c] = await db.execute<{ id: number }>(sql`
    insert into categories (household_id, kind, major, sub)
    values (${hid}, 'expense', '식비', '카페') returning id`)
  catId = c.id
})

afterAll(async () => {
  await db.execute(sql`delete from households where id = ${hid}`)
})

test('ai upsert then user upsert: user wins; ai cannot overwrite user', async () => {
  const norm = normalizeMerchant('포스톤즈(FOURSTONES)')
  await upsertMerchantLookup(hid, { normMerchant: norm, categoryId: catId, flow: 'expense', businessType: '카페' }, 'ai')
  await upsertMerchantLookup(hid, { normMerchant: norm, categoryId: catId, flow: 'expense' }, 'user')
  await upsertMerchantLookup(hid, { normMerchant: norm, categoryId: null, flow: 'expense' }, 'ai') // 무시돼야 함
  const m = await lookupMerchants(hid, [norm])
  expect(m.get(norm)?.source).toBe('user')
  expect(m.get(norm)?.categoryId).toBe(catId)
})

test('aggregator detection with exceptions', () => {
  expect(isAggregatorNorm(normalizeMerchant('쿠팡_쿠페이'))).toBe(true)
  expect(isAggregatorNorm(normalizeMerchant('네이버페이 주식회사'))).toBe(true)
  expect(isAggregatorNorm(normalizeMerchant('11번가'))).toBe(true)   // norm이 숫자를 제거해 '번가'
  expect(isAggregatorNorm(normalizeMerchant('쿠팡이츠'))).toBe(false) // 예외: 음식배달
  expect(isAggregatorNorm(normalizeMerchant('스타벅스'))).toBe(false)
})

test('lookupMerchants returns only requested norms for this household', async () => {
  const m = await lookupMerchants(hid, [normalizeMerchant('없는가게')])
  expect(m.size).toBe(0)
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm test tests/finance/merchant-lookup.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: normalize 추출**

Create `src/features/inbox/normalize.ts` — **banksalad.ts에 있는 기존 정규화 함수(공백·숫자·구분자 제거 + lowercase; 이력 서제스터와 중복감지가 쓰는 그 함수)를 함수 본문 그대로 옮기고** `export function normalizeMerchant`로 이름 통일. banksalad.ts(및 같은 함수를 인라인으로 가진 다른 파일이 있으면 전부)는 이 모듈을 import하도록 교체. **정규식/동작을 바꾸지 말 것** — 기존 committed 데이터와 키 호환이 깨진다.

- [ ] **Step 4: merchant-lookup 모듈 구현**

Create `src/features/inbox/merchant-lookup.ts`:
```ts
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

export type LookupSource = 'user' | 'ai'

export type MerchantLookupEntry = {
  normMerchant: string
  displayMerchant: string | null
  businessType: string | null
  categoryId: number | null
  flow: 'expense' | 'income' | 'saving'
  source: LookupSource
  confidence: 'high' | 'low'
  aiNote: string | null
  alwaysConfirm: boolean
}

// 애그리게이터(결제 항목이 안 보이는 가맹점) — norm 기준 부분일치.
// 주의: normalizeMerchant가 숫자를 제거하므로 '11번가' → '번가'.
export const AGGREGATOR_NORMS = [
  '쿠팡', '네이버페이', '카카오페이', '지마켓', '옥션', '번가', '페이코', '토스', '네이버파이낸셜',
]
const AGGREGATOR_EXCEPTIONS = ['쿠팡이츠'] // 음식배달 — 분류가 명확

export function isAggregatorNorm(norm: string): boolean {
  if (!norm) return false
  if (AGGREGATOR_EXCEPTIONS.some((e) => norm.includes(e))) return false
  return AGGREGATOR_NORMS.some((a) => norm.includes(a))
}

export async function lookupMerchants(
  householdId: string, norms: string[],
): Promise<Map<string, MerchantLookupEntry>> {
  const out = new Map<string, MerchantLookupEntry>()
  const unique = [...new Set(norms.filter(Boolean))]
  if (unique.length === 0) return out
  const rows = await db.execute<{
    norm_merchant: string; display_merchant: string | null; business_type: string | null
    category_id: number | null; flow: 'expense' | 'income' | 'saving'
    source: LookupSource; confidence: 'high' | 'low'; ai_note: string | null; always_confirm: boolean
  }>(sql`
    select norm_merchant, display_merchant, business_type, category_id, flow,
           source, confidence, ai_note, always_confirm
    from merchant_lookup
    where household_id = ${householdId} and norm_merchant in ${sql.raw(
      `(${unique.map((_, i) => `$${i + 2}`).join(',')})`,
    )}
  `.append ? sql`` : sql``)
  // 위 in-절 파라미터 바인딩이 번거로우므로 실제 구현은 drizzle 쿼리빌더 사용:
  return out
}
```
**주의: 위 스니펫의 raw in-절은 쓰지 말 것.** 실제 구현은 Drizzle 쿼리빌더로 한다(이 프로젝트의 기존 쿼리 스타일):
```ts
import { and, eq, inArray } from 'drizzle-orm'
import { merchantLookup } from '@/db/schema'

export async function lookupMerchants(
  householdId: string, norms: string[],
): Promise<Map<string, MerchantLookupEntry>> {
  const out = new Map<string, MerchantLookupEntry>()
  const unique = [...new Set(norms.filter(Boolean))]
  if (unique.length === 0) return out
  const rows = await db
    .select()
    .from(merchantLookup)
    .where(and(eq(merchantLookup.householdId, householdId), inArray(merchantLookup.normMerchant, unique)))
  for (const r of rows) {
    out.set(r.normMerchant, {
      normMerchant: r.normMerchant,
      displayMerchant: r.displayMerchant,
      businessType: r.businessType,
      categoryId: r.categoryId,
      flow: r.flow,
      source: r.source as LookupSource,
      confidence: r.confidence as 'high' | 'low',
      aiNote: r.aiNote,
      alwaysConfirm: r.alwaysConfirm,
    })
  }
  return out
}

export async function upsertMerchantLookup(
  householdId: string,
  entry: {
    normMerchant: string; displayMerchant?: string | null
    categoryId: number | null; flow: 'expense' | 'income' | 'saving'
    businessType?: string | null; aiNote?: string | null; confidence?: 'high' | 'low'
  },
  source: LookupSource,
): Promise<void> {
  // 우선순위: 기존 user 레코드를 ai가 덮지 못한다. always_confirm은 보존.
  await db.execute(sql`
    insert into merchant_lookup
      (household_id, norm_merchant, display_merchant, business_type, category_id,
       flow, source, confidence, ai_note, always_confirm, hit_count, last_used_at)
    values
      (${householdId}, ${entry.normMerchant}, ${entry.displayMerchant ?? null},
       ${entry.businessType ?? null}, ${entry.categoryId}, ${entry.flow}, ${source},
       ${entry.confidence ?? 'high'}, ${entry.aiNote ?? null},
       ${isAggregatorNorm(entry.normMerchant)}, 1, now())
    on conflict (household_id, norm_merchant) do update set
      display_merchant = coalesce(excluded.display_merchant, merchant_lookup.display_merchant),
      business_type    = coalesce(excluded.business_type, merchant_lookup.business_type),
      category_id      = excluded.category_id,
      flow             = excluded.flow,
      source           = excluded.source,
      confidence       = excluded.confidence,
      ai_note          = coalesce(excluded.ai_note, merchant_lookup.ai_note),
      hit_count        = merchant_lookup.hit_count + 1,
      last_used_at     = now()
    where not (merchant_lookup.source = 'user' and excluded.source = 'ai')
  `)
}
```
(첫 번째 잘못된 스니펫 블록은 파일에 넣지 않는다 — 쿼리빌더 버전만 구현.)

- [ ] **Step 5: 실행 → 통과 확인 + 기존 스위트 회귀**

Run: `pnpm test tests/finance/merchant-lookup.test.ts && pnpm test`
Expected: 신규 3 tests PASS, 기존 전체 스위트 PASS(normalize 이동으로 인한 회귀 없음).

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "feat(inbox): merchant lookup cache with user>ai precedence + aggregator detection"
```

---

### Task 3: 확신도 판정 + 정확금액 반복 인덱스

**Files:**
- Create: `src/features/inbox/confidence.ts`
- Modify: `src/features/inbox/banksalad.ts`(`buildAmountRepeatIndex` 추가; 이력 로딩 쿼리에 amount 포함)
- Test: `tests/finance/confidence.test.ts`

**Interfaces:**
- Produces:
  - `type SugSource = 'user' | 'history' | 'ai' | 'banksalad' | null`
  - `type ConfidenceInput = { sugSource: SugSource; historyMatch: 'norm' | 'token' | null; alwaysConfirm: boolean; hasDup: boolean; kind: 'normal' | 'transfer'; categoryId: number | null; exactAmountRepeat: boolean }`
  - `assessConfidence(i: ConfidenceInput): 'high' | 'review'`
  - `buildAmountRepeatIndex(rows: { merchant: string; amount: number; categoryId: number | null }[]): Map<string, { count: number; categoryId: number | null }>` — 키 `` `${norm}|${amount}` ``, categoryId는 해당 조합의 분류가 단일일 때만 채움(복수면 null).
- Consumes: `normalizeMerchant`(Task 2).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/finance/confidence.test.ts`:
```ts
import { expect, test } from 'vitest'
import { assessConfidence } from '@/features/inbox/confidence'
import { buildAmountRepeatIndex } from '@/features/inbox/banksalad'
import { normalizeMerchant } from '@/features/inbox/normalize'

const base = {
  sugSource: 'history' as const, historyMatch: 'norm' as const,
  alwaysConfirm: false, hasDup: false, kind: 'normal' as const,
  categoryId: 1, exactAmountRepeat: false,
}

test('history norm match on normal row → high', () => {
  expect(assessConfidence(base)).toBe('high')
})
test('user cache → high', () => {
  expect(assessConfidence({ ...base, sugSource: 'user', historyMatch: null })).toBe('high')
})
test('token match → review (오염 전례)', () => {
  expect(assessConfidence({ ...base, historyMatch: 'token' })).toBe('review')
})
test('ai / banksalad / blank → review', () => {
  expect(assessConfidence({ ...base, sugSource: 'ai', historyMatch: null })).toBe('review')
  expect(assessConfidence({ ...base, sugSource: 'banksalad', historyMatch: null })).toBe('review')
  expect(assessConfidence({ ...base, sugSource: null, historyMatch: null, categoryId: null })).toBe('review')
})
test('aggregator → review, 단 정확금액 반복이면 high', () => {
  expect(assessConfidence({ ...base, alwaysConfirm: true })).toBe('review')
  expect(assessConfidence({ ...base, alwaysConfirm: true, exactAmountRepeat: true })).toBe('high')
})
test('dup / transfer / no category → 무조건 review', () => {
  expect(assessConfidence({ ...base, hasDup: true })).toBe('review')
  expect(assessConfidence({ ...base, kind: 'transfer' })).toBe('review')
  expect(assessConfidence({ ...base, categoryId: null })).toBe('review')
})

test('buildAmountRepeatIndex: 2회+ 단일분류만 categoryId, 복수분류는 null', () => {
  const rows = [
    { merchant: '배민클럽_우아한형제들', amount: 1990, categoryId: 5 },
    { merchant: '배민클럽_우아한형제들', amount: 1990, categoryId: 5 },
    { merchant: '쿠팡', amount: 30000, categoryId: 7 },
    { merchant: '쿠팡', amount: 30000, categoryId: 9 },
    { merchant: '쿠팡', amount: 12345, categoryId: 7 },
  ]
  const idx = buildAmountRepeatIndex(rows)
  const k1 = `${normalizeMerchant('배민클럽_우아한형제들')}|1990`
  const k2 = `${normalizeMerchant('쿠팡')}|30000`
  expect(idx.get(k1)).toEqual({ count: 2, categoryId: 5 })
  expect(idx.get(k2)?.categoryId).toBeNull()        // 분류가 갈림 → 승격 불가
  expect(idx.has(`${normalizeMerchant('쿠팡')}|12345`)).toBe(false) // 1회는 미등재
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm test tests/finance/confidence.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

Create `src/features/inbox/confidence.ts`:
```ts
export type SugSource = 'user' | 'history' | 'ai' | 'banksalad' | null

export type ConfidenceInput = {
  sugSource: SugSource
  historyMatch: 'norm' | 'token' | null
  alwaysConfirm: boolean
  hasDup: boolean
  kind: 'normal' | 'transfer'
  categoryId: number | null
  exactAmountRepeat: boolean
}

/** high = 접힘·일괄승인 대상. 스펙 §확신도 판정.
 *  순서 중요: 강등 조건(이체/중복/무분류) → 애그리게이터 → 출처. */
export function assessConfidence(i: ConfidenceInput): 'high' | 'review' {
  if (i.kind === 'transfer') return 'review'
  if (i.hasDup) return 'review'
  if (!i.categoryId) return 'review'
  if (i.alwaysConfirm) return i.exactAmountRepeat ? 'high' : 'review'
  if (i.sugSource === 'user') return 'high'
  if (i.sugSource === 'history' && i.historyMatch === 'norm') return 'high'
  return 'review'
}
```

Modify `src/features/inbox/banksalad.ts` — `buildHistorySuggester`가 소비하는 이력 rows에 `amount`가 포함되도록 로딩 쿼리(upload-action.ts에서 이력을 select하는 부분)를 확장하고, 같은 파일에 추가:
```ts
import { normalizeMerchant } from './normalize'

/** (정규화 가맹점, 정확금액) 조합의 반복 인덱스.
 *  2회 이상 + 단일 분류일 때만 categoryId를 채운다(구독 승격용). */
export function buildAmountRepeatIndex(
  rows: { merchant: string; amount: number; categoryId: number | null }[],
): Map<string, { count: number; categoryId: number | null }> {
  const tally = new Map<string, { count: number; cats: Set<number | null> }>()
  for (const r of rows) {
    const norm = normalizeMerchant(r.merchant)
    if (!norm) continue
    const key = `${norm}|${r.amount}`
    const t = tally.get(key) ?? { count: 0, cats: new Set() }
    t.count += 1
    t.cats.add(r.categoryId)
    tally.set(key, t)
  }
  const out = new Map<string, { count: number; categoryId: number | null }>()
  for (const [key, t] of tally) {
    if (t.count < 2) continue
    const cats = [...t.cats]
    out.set(key, { count: t.count, categoryId: cats.length === 1 ? cats[0] : null })
  }
  return out
}
```
(주: `buildHistorySuggester`의 기존 반환/동작은 바꾸지 않는다. `historyMatch` 구분('norm'|'token')이 현재 반환값에 없으면, 반환 객체에 `matched: 'norm' | 'token'` 필드를 추가한다 — norm 테이블 히트면 'norm', 토큰 테이블 히트면 'token'.)

- [ ] **Step 4: 실행 → 통과 + 회귀**

Run: `pnpm test tests/finance/confidence.test.ts && pnpm test`
Expected: PASS 전체.

- [ ] **Step 5: 커밋**

```bash
git add -A && git commit -m "feat(inbox): confidence assessment + exact-amount repeat index"
```

---

### Task 4: 카드사 명세서 파서 5종

**Files:**
- Create: `src/features/inbox/parsers/cards.ts`
- Modify: `package.json`(xlsx 의존성)
- Test: `tests/finance/card-parsers.test.ts`

**Interfaces:**
- Produces:
  - `type CardIssuer = 'samsung' | 'hyundai' | 'kookmin' | 'shinhan' | 'nonghyup'`
  - `const CARD_ISSUERS: { key: CardIssuer; label: string }[]` (삼성카드/현대카드/국민카드/신한카드/농협카드)
  - `type CardRow = { date: string; merchant: string; amount: number }` — date는 'YYYY-MM-DD'
  - `parseCardStatement(buffer: Buffer, issuer: CardIssuer): CardRow[]`
  - `cardFingerprint(issuer: CardIssuer, owner: string, row: CardRow, occurrenceIdx: number): string` — `sha1('card:'+issuer+'|'+owner+'|'+date+'|'+amount+'|'+merchant+'|'+occurrenceIdx)`
  - `looksLikeBanksalad(buffer: Buffer): boolean` — 업로드 분기용(뱅샐 xlsx는 '가계부 내역' 시트 보유)

- [ ] **Step 1: SheetJS 설치**

Run: `pnpm add xlsx`
(SheetJS CE. 카드 파일은 실측상 3종 혼합 — 진짜 xlsx(삼성·NH), HTML 위장 .xls(현대·신한), 레거시 BIFF .xls(KB). `XLSX.read`가 셋 다 읽는다. 확장자를 믿지 말고 버퍼를 그대로 넘긴다.)

- [ ] **Step 2: 실패하는 테스트 작성 (합성 픽스처 — 실파일 복사 금지)**

Create `tests/finance/card-parsers.test.ts`:
```ts
import { expect, test } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCardStatement, cardFingerprint } from '@/features/inbox/parsers/cards'

function xlsxBuffer(rows: (string | number)[][], bookType: 'xlsx' | 'xls' = 'xlsx'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
}

// 현대카드: .xls 확장자의 HTML 테이블 (실측 포맷)
const HYUNDAI_HTML = Buffer.from(`
<html><body><table>
<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
<tr><td>2026.08.03</td><td>네이버 현대카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>2026.08.05</td><td>네이버 현대카드</td><td>GS25 역삼점</td><td>3,200</td><td>3,200</td></tr>
<tr><td>합계</td><td></td><td></td><td>9,700</td><td>9,700</td></tr>
<tr><td>2026.08.09</td><td>취소</td><td>뒤섹션은무시</td><td>1,000</td><td>1,000</td></tr>
</table></body></html>`, 'utf-8')

test('hyundai: HTML-as-xls parsed, stops at 합계', () => {
  const rows = parseCardStatement(HYUNDAI_HTML, 'hyundai')
  expect(rows).toEqual([
    { date: '2026-08-03', merchant: '스타벅스 강남점', amount: 6500 },
    { date: '2026-08-05', merchant: 'GS25 역삼점', amount: 3200 },
  ])
})

test('samsung: real xlsx with 이용일/가맹점/이용금액', () => {
  const buf = xlsxBuffer([
    ['삼성카드 이용내역'],
    ['이용일', '이용구분', '가맹점', '이용금액', '원금'],
    ['2026-08-01', '일시불', '쿠팡', '34,500', '34,500'],
    ['2026-08-02', '일시불', '올리브영', 12000, 12000],
    ['합계', '', '', '46,500', ''],
  ])
  expect(parseCardStatement(buf, 'samsung')).toEqual([
    { date: '2026-08-01', merchant: '쿠팡', amount: 34500 },
    { date: '2026-08-02', merchant: '올리브영', amount: 12000 },
  ])
})

test('kookmin: legacy BIFF .xls with 이용하신곳', () => {
  const buf = xlsxBuffer([
    ['이용일', '이용카드', '이용하신곳', '결제방법', '이용금액', '청구원금'],
    ['20260810', 'KB카드', '이마트 용산점', '일시불', '85,930', '85,930'],
    ['합계', '', '', '', '85,930', ''],
  ], 'xls')
  expect(parseCardStatement(buf, 'kookmin')).toEqual([
    { date: '2026-08-10', merchant: '이마트 용산점', amount: 85930 },
  ])
})

test('nonghyup: 이용금액 0인 export라 청구원금 사용', () => {
  const buf = xlsxBuffer([
    ['이용일자', '이용카드', '이용가맹점', '이용금액', '청구원금'],
    ['2026년 08월 12일', 'NH카드', '늘편한약국', 0, '4,000'],
    ['합계', '', '', '', '4,000'],
  ])
  expect(parseCardStatement(buf, 'nonghyup')).toEqual([
    { date: '2026-08-12', merchant: '늘편한약국', amount: 4000 },
  ])
})

test('fingerprint: 동일 행 2건은 occurrenceIdx로 구분, 재파싱 시 동일 uid', () => {
  const row = { date: '2026-08-03', merchant: '스타벅스', amount: 6500 }
  const a0 = cardFingerprint('hyundai', 'DJ', row, 0)
  const a1 = cardFingerprint('hyundai', 'DJ', row, 1)
  expect(a0).not.toBe(a1)
  expect(cardFingerprint('hyundai', 'DJ', row, 0)).toBe(a0)
  expect(a0).toMatch(/^[0-9a-f]{40}$/)
})
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `pnpm test tests/finance/card-parsers.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 파서 구현**

Create `src/features/inbox/parsers/cards.ts`:
```ts
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'

export type CardIssuer = 'samsung' | 'hyundai' | 'kookmin' | 'shinhan' | 'nonghyup'

export const CARD_ISSUERS: { key: CardIssuer; label: string }[] = [
  { key: 'samsung', label: '삼성카드' },
  { key: 'hyundai', label: '현대카드' },
  { key: 'kookmin', label: '국민카드' },
  { key: 'shinhan', label: '신한카드' },
  { key: 'nonghyup', label: '농협카드' },
]

export type CardRow = { date: string; merchant: string; amount: number }

// 카드사별 헤더 키워드 (구 Flask card_import.py 명세; 공백 무시 비교)
const SPECS: Record<CardIssuer, {
  dateKeys: string[]; merchantKeys: string[]; amountKeys: string[]; fallbackKeys: string[]
}> = {
  samsung:  { dateKeys: ['이용일'],   merchantKeys: ['가맹점'],     amountKeys: ['이용금액'], fallbackKeys: ['원금'] },
  hyundai:  { dateKeys: ['이용일'],   merchantKeys: ['이용가맹점'], amountKeys: ['이용금액'], fallbackKeys: ['결제원금'] },
  kookmin:  { dateKeys: ['이용일'],   merchantKeys: ['이용하신곳'], amountKeys: ['이용금액'], fallbackKeys: ['청구원금'] },
  shinhan:  { dateKeys: ['이용일'],   merchantKeys: ['이용가맹점'], amountKeys: ['이용금액'], fallbackKeys: [] },
  // NH: 이용금액이 0으로 export되므로 청구원금이 주 금액
  nonghyup: { dateKeys: ['이용일자'], merchantKeys: ['이용가맹점'], amountKeys: ['청구원금'], fallbackKeys: [] },
}

const STOP_MARKS = ['합계', '소계', '없습니다']

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const m = String(v).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** 버퍼를 문자열 그리드로. SheetJS가 xlsx/BIFF/HTML을 모두 읽는다(확장자 불신). */
function toGrid(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const grid: string[][] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    for (const r of rows) {
      grid.push(r.map((c) => {
        if (c instanceof Date) return toIso(c) ?? ''
        return String(c ?? '').trim()
      }))
    }
  }
  return grid
}

const norm = (s: string) => s.replace(/\s+/g, '')

export function parseCardStatement(buffer: Buffer, issuer: CardIssuer): CardRow[] {
  const spec = SPECS[issuer]
  const grid = toGrid(buffer)

  // 헤더 행 탐색 (공백 무시, 부분일치 — 카드 export는 헤더가 줄바꿈되기도 함)
  let headerIdx = -1
  const col: Record<string, number> = {}
  for (let i = 0; i < grid.length; i++) {
    const normed = grid[i].map(norm)
    const hasDate = spec.dateKeys.some((k) => normed.some((c) => c.includes(k)))
    const hasMerchant = spec.merchantKeys.some((k) => normed.some((c) => c.includes(k)))
    if (hasDate && hasMerchant) {
      headerIdx = i
      normed.forEach((c, idx) => { if (c && !(c in col)) col[c] = idx })
      break
    }
  }
  if (headerIdx === -1) return []

  const pick = (keys: string[]): number | null => {
    for (const k of keys) {
      const exact = col[k]
      if (exact !== undefined) return exact
      const partial = Object.keys(col).find((c) => c.includes(k))
      if (partial) return col[partial]
    }
    return null
  }
  const ciDate = pick(spec.dateKeys)
  const ciMerchant = pick(spec.merchantKeys)
  const ciAmt = pick(spec.amountKeys)
  const ciFallback = pick(spec.fallbackKeys)

  const out: CardRow[] = []
  for (const r of grid.slice(headerIdx + 1)) {
    const joined = r.filter(Boolean).join(' ')
    // 합계/소계에서 중단 — 뒤따르는 할인/취소 섹션 오독 방지 (신한이 특히 중요)
    if (STOP_MARKS.some((m) => joined.includes(m))) break
    const merchant = ciMerchant !== null ? (r[ciMerchant] ?? '').trim() : ''
    if (!merchant) continue
    const date = toIso(ciDate !== null ? r[ciDate] : null)
    if (!date) continue
    let amount = toInt(ciAmt !== null ? r[ciAmt] : null)
    if ((amount === null || amount === 0) && ciFallback !== null) amount = toInt(r[ciFallback])
    if (amount === null || amount <= 0) continue
    out.push({ date, merchant, amount })
  }
  return out
}

export function cardFingerprint(
  issuer: CardIssuer, owner: string, row: CardRow, occurrenceIdx: number,
): string {
  return createHash('sha1')
    .update(`card:${issuer}|${owner}|${row.date}|${row.amount}|${row.merchant}|${occurrenceIdx}`)
    .digest('hex')
}

/** 뱅샐 export 판별: xlsx이고 '가계부 내역' 시트가 있다. 카드/뱅샐 업로드 분기용. */
export function looksLikeBanksalad(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', bookSheets: true })
    return wb.SheetNames.some((n) => n.includes('가계부'))
  } catch {
    return false
  }
}
```

- [ ] **Step 5: 실행 → 통과 확인**

Run: `pnpm test tests/finance/card-parsers.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: 로컬 실파일 수동 검증 (repo 반영 없음, 결과만 리포트에 기록)**

Run (임시 스크립트로 각 실파일 파싱 건수 확인 — 파일은 커밋 금지):
```bash
pnpm tsx -e "
import { readFileSync } from 'node:fs'
import { parseCardStatement } from './src/features/inbox/parsers/cards'
const base = '/Users/leedj/workspace/Personal/finance/imports/'
const cases: [string, any][] = [
  ['hyundaicard_20260607.xls', 'hyundai'],
  ['kookmin.xls', 'kookmin'],
  ['shinhan.xls', 'shinhan'],
  ['nh.xlsx', 'nonghyup'],
  ['samsungcard_20260613.xlsx', 'samsung'],
]
for (const [f, issuer] of cases) {
  try { console.log(f, issuer, parseCardStatement(readFileSync(base + f), issuer).length, 'rows') }
  catch (e) { console.log(f, 'ERROR', (e as Error).message) }
}
"
```
Expected: 각 파일에서 0건 초과 파싱(파일이 없으면 skip으로 기록). 0건이거나 에러면 해당 카드사의 헤더 키워드/그리드 처리(HTML의 중첩 테이블 등)를 실파일 구조에 맞게 수정 후 합성 픽스처도 갱신.

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "feat(inbox): card statement parsers (5 issuers, xlsx/BIFF/HTML via SheetJS)"
```

---

### Task 5: AI 폴백 모듈

**Files:**
- Create: `src/features/inbox/ai-classify.ts`
- Modify: `package.json`(openai), `.env.example`(+`OPENAI_API_KEY`), `README.md`(환경변수 표에 한 줄)
- Test: `tests/finance/ai-classify.test.ts`

**Interfaces:**
- Produces:
  - `type TaxonomyEntry = { flow: 'expense' | 'income' | 'saving'; major: string; sub: string }`
  - `type AiMerchantResult = { merchant: string; businessType: string; major: string; sub: string; flow: 'expense' | 'income' | 'saving'; confidence: 'high' | 'low'; note: string }`
  - `classifyUnknownMerchants(input: { merchants: string[]; taxonomy: TaxonomyEntry[]; examples: { merchant: string; major: string; sub: string }[] }, client?: OpenAI): Promise<AiMerchantResult[]>` — 실패/빈 입력 시 `[]`, throw하지 않음.
  - `aiFallbackEnabled(settingValue: string | null | undefined): boolean` — settings 'ai_fallback_enabled' !== '0' && `OPENAI_API_KEY` 존재.

- [ ] **Step 1: SDK 설치**

Run: `pnpm add openai`

- [ ] **Step 2: 실패하는 테스트 작성 (클라이언트 주입 mock — 실호출 없음)**

Create `tests/finance/ai-classify.test.ts`:
```ts
import { expect, test } from 'vitest'
import { classifyUnknownMerchants, aiFallbackEnabled } from '@/features/inbox/ai-classify'

const taxonomy = [
  { flow: 'expense' as const, major: '식비', sub: '카페' },
  { flow: 'expense' as const, major: '건강', sub: '병원/약국' },
]

function mockClient(text: string, shouldThrow = false) {
  return {
    responses: {
      create: async () => {
        if (shouldThrow) throw new Error('api down')
        return { output_text: text }
      },
    },
  } as never
}

test('parses fenced JSON and validates against taxonomy', async () => {
  const text = '조사 결과입니다.\n```json\n' + JSON.stringify([
    { merchant: '포스톤즈', businessType: '카페', major: '식비', sub: '카페', flow: 'expense', confidence: 'high', note: '웹서치: 마포구 카페' },
    { merchant: '이상한곳', businessType: '?', major: '없는대분류', sub: '없음', flow: 'expense', confidence: 'low', note: '' },
  ]) + '\n```'
  const out = await classifyUnknownMerchants(
    { merchants: ['포스톤즈', '이상한곳'], taxonomy, examples: [] }, mockClient(text))
  expect(out).toHaveLength(1)                      // taxonomy에 없는 분류는 버림
  expect(out[0]).toMatchObject({ merchant: '포스톤즈', major: '식비', sub: '카페' })
})

test('api failure → [] (업로드는 계속되어야 함)', async () => {
  const out = await classifyUnknownMerchants(
    { merchants: ['포스톤즈'], taxonomy, examples: [] }, mockClient('', true))
  expect(out).toEqual([])
})

test('empty merchants → [] without calling api', async () => {
  const out = await classifyUnknownMerchants({ merchants: [], taxonomy, examples: [] }, mockClient('SHOULD NOT PARSE'))
  expect(out).toEqual([])
})

test('aiFallbackEnabled respects setting and env', () => {
  const saved = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'sk-test'
  expect(aiFallbackEnabled(null)).toBe(true)       // 기본 on
  expect(aiFallbackEnabled('0')).toBe(false)       // 토글 off
  delete process.env.OPENAI_API_KEY
  expect(aiFallbackEnabled(null)).toBe(false)      // 키 없으면 off
  if (saved) process.env.OPENAI_API_KEY = saved
})
```

- [ ] **Step 3: 실행 → 실패 확인**

Run: `pnpm test tests/finance/ai-classify.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현**

Create `src/features/inbox/ai-classify.ts`:
```ts
import OpenAI from 'openai'

export type TaxonomyEntry = { flow: 'expense' | 'income' | 'saving'; major: string; sub: string }
export type AiMerchantResult = {
  merchant: string; businessType: string; major: string; sub: string
  flow: 'expense' | 'income' | 'saving'; confidence: 'high' | 'low'; note: string
}

// 사용자 결정(2026-09-01): OpenAI API 사용. Responses API + web_search 내장 툴.
// 저가 모델로 충분(호출량 월 5~15 가맹점). 구현 시점에 모델명이 바뀌었으면
// OpenAI 모델 목록에서 web_search 지원하는 최신 mini급으로 교체.
const MODEL = 'gpt-5-mini'

export function aiFallbackEnabled(settingValue: string | null | undefined): boolean {
  if (settingValue === '0') return false
  return Boolean(process.env.OPENAI_API_KEY)
}

function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 캐시/이력이 못 잡은 가맹점들을 1회 배치로 분류. 가맹점명만 전송(금액·날짜 없음).
 *  어떤 실패도 throw하지 않고 [] — 업로드 플로우는 AI 없이도 성공해야 한다. */
export async function classifyUnknownMerchants(
  input: {
    merchants: string[]
    taxonomy: TaxonomyEntry[]
    examples: { merchant: string; major: string; sub: string }[]
  },
  client?: OpenAI,
): Promise<AiMerchantResult[]> {
  const merchants = [...new Set(input.merchants.filter(Boolean))]
  if (merchants.length === 0) return []

  const valid = new Set(input.taxonomy.map((t) => `${t.flow}|${t.major}|${t.sub}`))
  const taxonomyText = input.taxonomy.map((t) => `${t.flow} / ${t.major} / ${t.sub}`).join('\n')
  const examplesText = input.examples.slice(0, 20)
    .map((e) => `- "${e.merchant}" → ${e.major}/${e.sub}`).join('\n')

  const prompt = [
    '아래는 한국 가계부의 카드/계좌 결제 가맹점명 목록이다. 각 가맹점이 어떤 업종인지 판단하고',
    '(모르는 곳은 웹검색으로 확인), 주어진 분류체계에서 가장 알맞은 항목 하나를 골라라.',
    '',
    '## 분류체계 (이 목록에 있는 조합만 사용)',
    taxonomyText,
    '',
    examplesText ? `## 이 가계부의 분류 예시\n${examplesText}\n` : '',
    '## 가맹점 목록',
    merchants.map((m) => `- ${m}`).join('\n'),
    '',
    '## 출력 형식',
    '```json 펜스 안에 JSON 배열만. 각 원소:',
    '{"merchant": "<입력 그대로>", "businessType": "<업종 한두 단어>", "major": "...", "sub": "...",',
    ' "flow": "expense|income|saving", "confidence": "high|low", "note": "<한 줄 근거>"}',
    '확실하지 않으면 confidence를 "low"로. 웹검색으로도 정체를 모르면 low + 가장 그럴듯한 분류.',
  ].join('\n')

  try {
    const openai = client ?? new OpenAI()
    const response = await openai.responses.create({
      model: MODEL,
      tools: [{ type: 'web_search' }],
      input: prompt,
    })
    const text = response.output_text ?? ''
    const arr = extractJsonArray(text)
    if (!arr) return []
    const out: AiMerchantResult[] = []
    for (const item of arr) {
      const r = item as Partial<AiMerchantResult>
      if (!r.merchant || !r.major || !r.sub) continue
      const flow = (r.flow === 'income' || r.flow === 'saving') ? r.flow : 'expense'
      if (!valid.has(`${flow}|${r.major}|${r.sub}`)) continue   // 분류체계 밖은 버림
      out.push({
        merchant: r.merchant, businessType: r.businessType ?? '',
        major: r.major, sub: r.sub, flow,
        confidence: r.confidence === 'high' ? 'high' : 'low',
        note: r.note ?? '',
      })
    }
    return out
  } catch {
    return []   // AI 실패는 기능 저하일 뿐, 업로드 실패가 아니다
  }
}
```
(주: `tools: [{ type: 'web_search' }]`의 타입이 SDK 버전에 따라 다르면 `as never` 캐스트 허용 — SDK가 정식 타입을 제공하면 사용. `response.output_text`는 openai SDK의 텍스트 집계 헬퍼.)

- [ ] **Step 5: env 문서화**

`.env.example`에 추가:
```bash
# AI 분류 폴백 (선택 — 없으면 AI 층만 비활성, 나머지는 정상)
OPENAI_API_KEY=""
```
README 환경변수 표에 같은 내용 한 줄 추가. Vercel 대시보드에 등록하라는 주석 포함.

- [ ] **Step 6: 실행 → 통과 + 커밋**

Run: `pnpm test tests/finance/ai-classify.test.ts`
Expected: PASS (4 tests)
```bash
git add -A && git commit -m "feat(inbox): AI merchant classification fallback (openai responses + web search, injectable client)"
```

---

### Task 6: 제안 해석기 + 뱅샐 스테이징 재배선

**Files:**
- Create: `src/features/inbox/resolve-suggestion.ts`
- Modify: `src/features/inbox/upload-action.ts`(`uploadBanksaladFiles` 내 분류 결정 블록 — 기존 "history → banksalad → blank" 로직을 교체), `src/app/inbox/…`(스테이징 결과 요약 문구에 확신/확인필요 건수)
- Test: `tests/finance/resolve-suggestion.test.ts`

**Interfaces:**
- Consumes: Task 2(`lookupMerchants`/`upsertMerchantLookup`/`isAggregatorNorm`/`normalizeMerchant`), Task 3(`assessConfidence`/`buildAmountRepeatIndex`/`SugSource`), Task 5(`classifyUnknownMerchants`/`aiFallbackEnabled`), 기존 `buildHistorySuggester`(matched: 'norm'|'token' 포함).
- Produces:
  - `type ResolvedSuggestion = { categoryId: number | null; flow: 'expense' | 'income' | 'saving'; sugSource: SugSource; historyMatch: 'norm' | 'token' | null; businessType: string | null; aiNote: string | null; alwaysConfirm: boolean; exactAmountRepeat: boolean }`
  - `resolveSuggestions(args: { householdId: string; items: { merchant: string; amount: number; baseFlow: 'expense' | 'income' | 'saving'; bsSuggestCategoryId: number | null }[]; historySuggest: (merchant: string) => ({ flow: string; major: string; sub: string; matched: 'norm' | 'token' } | null); amountRepeatIndex: Map<string, { count: number; categoryId: number | null }>; taxonomy: TaxonomyEntry[]; examples: { merchant: string; major: string; sub: string }[]; findCategoryId: (flow: string, major: string, sub: string) => number | null; aiSetting: string | null }): Promise<ResolvedSuggestion[]>` — items와 같은 순서로 반환. AI 결과는 내부에서 `upsertMerchantLookup(..., 'ai')`로 캐시에 저장.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/finance/resolve-suggestion.test.ts` (DB 사용 — Task 2 테스트와 같은 가구 셋업 패턴):
```ts
import { beforeAll, afterAll, expect, test, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { resolveSuggestions } from '@/features/inbox/resolve-suggestion'
import { upsertMerchantLookup } from '@/features/inbox/merchant-lookup'
import { normalizeMerchant } from '@/features/inbox/normalize'

// AI 층은 모킹 — resolve가 미지의 가맹점만 AI에 넘기는지 검증
vi.mock('@/features/inbox/ai-classify', async (orig) => ({
  ...(await orig()),
  aiFallbackEnabled: () => true,
  classifyUnknownMerchants: vi.fn(async ({ merchants }: { merchants: string[] }) =>
    merchants.map((m) => ({
      merchant: m, businessType: '카페', major: '식비', sub: '카페',
      flow: 'expense' as const, confidence: 'low' as const, note: 'mock',
    }))),
}))
import { classifyUnknownMerchants } from '@/features/inbox/ai-classify'

let hid: string
let cafeId: number

beforeAll(async () => {
  const [h] = await db.execute<{ id: string }>(
    sql`insert into households (name) values ('TEST-resolve') returning id`)
  hid = h.id
  const [c] = await db.execute<{ id: number }>(sql`
    insert into categories (household_id, kind, major, sub)
    values (${hid}, 'expense', '식비', '카페') returning id`)
  cafeId = c.id
})
afterAll(async () => { await db.execute(sql`delete from households where id = ${hid}`) })

const taxonomy = [{ flow: 'expense' as const, major: '식비', sub: '카페' }]
const findCategoryId = (f: string, m: string, s: string) =>
  f === 'expense' && m === '식비' && s === '카페' ? cafeId : null

test('priority: user-cache > history > ai; unknown goes to AI and lands in ai-cache', async () => {
  await upsertMerchantLookup(hid,
    { normMerchant: normalizeMerchant('단골카페'), categoryId: cafeId, flow: 'expense' }, 'user')

  const out = await resolveSuggestions({
    householdId: hid,
    items: [
      { merchant: '단골카페', amount: 5000, baseFlow: 'expense', bsSuggestCategoryId: null },   // → user
      { merchant: '이력집', amount: 8000, baseFlow: 'expense', bsSuggestCategoryId: null },     // → history
      { merchant: '완전미지', amount: 4000, baseFlow: 'expense', bsSuggestCategoryId: null },   // → ai
    ],
    historySuggest: (m) => m === '이력집'
      ? { flow: 'expense', major: '식비', sub: '카페', matched: 'norm' } : null,
    amountRepeatIndex: new Map(),
    taxonomy, examples: [], findCategoryId, aiSetting: null,
  })

  expect(out[0]).toMatchObject({ sugSource: 'user', categoryId: cafeId })
  expect(out[1]).toMatchObject({ sugSource: 'history', historyMatch: 'norm', categoryId: cafeId })
  expect(out[2]).toMatchObject({ sugSource: 'ai', categoryId: cafeId })
  // AI에는 미지의 가맹점만 갔는지
  expect(vi.mocked(classifyUnknownMerchants).mock.calls[0][0].merchants).toEqual(['완전미지'])
  // AI 결과가 ai-캐시에 저장됐는지 → 두 번째 호출에선 AI 없이 캐시 히트
  vi.mocked(classifyUnknownMerchants).mockClear()
  const again = await resolveSuggestions({
    householdId: hid,
    items: [{ merchant: '완전미지', amount: 4000, baseFlow: 'expense', bsSuggestCategoryId: null }],
    historySuggest: () => null, amountRepeatIndex: new Map(),
    taxonomy, examples: [], findCategoryId, aiSetting: null,
  })
  expect(again[0].sugSource).toBe('ai')             // ai-캐시 히트
  expect(classifyUnknownMerchants).not.toHaveBeenCalled()
})

test('aggregator: prefill되지만 alwaysConfirm=true; 정확금액 반복이면 exactAmountRepeat', async () => {
  const idx = new Map([[`${normalizeMerchant('네이버페이멤버십')}|4900`, { count: 3, categoryId: cafeId }]])
  const out = await resolveSuggestions({
    householdId: hid,
    items: [
      { merchant: '쿠팡', amount: 33000, baseFlow: 'expense', bsSuggestCategoryId: cafeId },
      { merchant: '네이버페이멤버십', amount: 4900, baseFlow: 'expense', bsSuggestCategoryId: null },
    ],
    historySuggest: (m) => m === '쿠팡'
      ? { flow: 'expense', major: '식비', sub: '카페', matched: 'norm' } : null,
    amountRepeatIndex: idx, taxonomy, examples: [], findCategoryId, aiSetting: null,
  })
  expect(out[0].alwaysConfirm).toBe(true)
  expect(out[0].exactAmountRepeat).toBe(false)
  expect(out[1].alwaysConfirm).toBe(true)
  expect(out[1].exactAmountRepeat).toBe(true)
  expect(out[1].categoryId).toBe(cafeId)            // 반복 인덱스의 분류로 프리필
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm test tests/finance/resolve-suggestion.test.ts`
Expected: FAIL

- [ ] **Step 3: resolveSuggestions 구현**

Create `src/features/inbox/resolve-suggestion.ts`:
```ts
import { normalizeMerchant } from './normalize'
import { lookupMerchants, upsertMerchantLookup, isAggregatorNorm } from './merchant-lookup'
import { classifyUnknownMerchants, aiFallbackEnabled, type TaxonomyEntry } from './ai-classify'
import type { SugSource } from './confidence'

export type ResolvedSuggestion = {
  categoryId: number | null
  flow: 'expense' | 'income' | 'saving'
  sugSource: SugSource
  historyMatch: 'norm' | 'token' | null
  businessType: string | null
  aiNote: string | null
  alwaysConfirm: boolean
  exactAmountRepeat: boolean
}

type Item = { merchant: string; amount: number; baseFlow: 'expense' | 'income' | 'saving'; bsSuggestCategoryId: number | null }

export async function resolveSuggestions(args: {
  householdId: string
  items: Item[]
  historySuggest: (merchant: string) => ({ flow: string; major: string; sub: string; matched: 'norm' | 'token' } | null)
  amountRepeatIndex: Map<string, { count: number; categoryId: number | null }>
  taxonomy: TaxonomyEntry[]
  examples: { merchant: string; major: string; sub: string }[]
  findCategoryId: (flow: string, major: string, sub: string) => number | null
  aiSetting: string | null
}): Promise<ResolvedSuggestion[]> {
  const norms = args.items.map((i) => normalizeMerchant(i.merchant))
  const cache = await lookupMerchants(args.householdId, norms)

  // 1차 패스: user-캐시 → 이력 → ai-캐시. miss는 AI 후보로 수집.
  const results: (ResolvedSuggestion | null)[] = args.items.map(() => null)
  const unknownIdx: number[] = []

  args.items.forEach((item, i) => {
    const norm = norms[i]
    const aggregator = cache.get(norm)?.alwaysConfirm ?? isAggregatorNorm(norm)
    const repeat = args.amountRepeatIndex.get(`${norm}|${item.amount}`)
    const exactAmountRepeat = Boolean(repeat && repeat.categoryId !== null)
    const base = { alwaysConfirm: aggregator, exactAmountRepeat, businessType: null, aiNote: null }

    const cached = cache.get(norm)
    if (cached?.source === 'user' && cached.categoryId !== null) {
      results[i] = { ...base, categoryId: cached.categoryId, flow: cached.flow,
        sugSource: 'user', historyMatch: null,
        businessType: cached.businessType, aiNote: cached.aiNote }
      return
    }
    const hist = args.historySuggest(item.merchant)
    if (hist) {
      const cid = args.findCategoryId(hist.flow, hist.major, hist.sub)
      if (cid !== null) {
        results[i] = { ...base, categoryId: cid,
          flow: hist.flow as ResolvedSuggestion['flow'],
          sugSource: 'history', historyMatch: hist.matched }
        return
      }
    }
    if (cached?.source === 'ai' && cached.categoryId !== null) {
      results[i] = { ...base, categoryId: cached.categoryId, flow: cached.flow,
        sugSource: 'ai', historyMatch: null,
        businessType: cached.businessType, aiNote: cached.aiNote }
      return
    }
    unknownIdx.push(i)
  })

  // 2차 패스: AI 배치 (설정 on + 미지 존재 시) → ai-캐시 저장 후 적용
  if (unknownIdx.length > 0 && aiFallbackEnabled(args.aiSetting)) {
    const merchants = [...new Set(unknownIdx.map((i) => args.items[i].merchant))]
    const aiResults = await classifyUnknownMerchants(
      { merchants, taxonomy: args.taxonomy, examples: args.examples })
    const byMerchant = new Map(aiResults.map((r) => [r.merchant, r]))
    for (const r of aiResults) {
      const cid = args.findCategoryId(r.flow, r.major, r.sub)
      await upsertMerchantLookup(args.householdId, {
        normMerchant: normalizeMerchant(r.merchant), displayMerchant: r.merchant,
        categoryId: cid, flow: r.flow, businessType: r.businessType,
        aiNote: r.note, confidence: r.confidence,
      }, 'ai')
    }
    for (const i of unknownIdx) {
      const r = byMerchant.get(args.items[i].merchant)
      if (!r) continue
      const cid = args.findCategoryId(r.flow, r.major, r.sub)
      if (cid === null) continue
      const norm = norms[i]
      results[i] = {
        categoryId: cid, flow: r.flow, sugSource: 'ai', historyMatch: null,
        businessType: r.businessType, aiNote: r.note,
        alwaysConfirm: cache.get(norm)?.alwaysConfirm ?? isAggregatorNorm(norm),
        exactAmountRepeat: false,
      }
    }
  }

  // 3차 패스: 뱅샐 매핑 → 빈칸. 애그리게이터의 정확금액 반복은 그 분류로 프리필.
  return args.items.map((item, i) => {
    const norm = norms[i]
    const aggregator = cache.get(norm)?.alwaysConfirm ?? isAggregatorNorm(norm)
    const repeat = args.amountRepeatIndex.get(`${norm}|${item.amount}`)
    const exactAmountRepeat = Boolean(repeat && repeat.categoryId !== null)
    let r = results[i]
    if (!r) {
      r = {
        categoryId: item.bsSuggestCategoryId, flow: item.baseFlow,
        sugSource: item.bsSuggestCategoryId !== null ? 'banksalad' : null,
        historyMatch: null, businessType: null, aiNote: null,
        alwaysConfirm: aggregator, exactAmountRepeat,
      }
    }
    // 애그리게이터 구독(정확금액 반복): 반복 인덱스의 단일 분류가 최우선 프리필
    if (aggregator && exactAmountRepeat && repeat!.categoryId !== null) {
      r = { ...r, categoryId: repeat!.categoryId, exactAmountRepeat: true }
    }
    return r
  })
}
```

- [ ] **Step 4: 뱅샐 업로드 액션 재배선**

Modify `src/features/inbox/upload-action.ts`의 `uploadBanksaladFiles`:
1. 이력 로딩부에서 `buildHistorySuggester`와 함께 `buildAmountRepeatIndex`(amount 포함 rows)를 만든다.
2. 기존 행별 분류 결정 블록(history→banksalad→blank로 categoryId/sugSource를 정하던 부분)을 제거하고, 스테이징 대상 행 전체를 모아 **한 번의 `resolveSuggestions` 호출**로 바꾼다. `items[i].bsSuggestCategoryId`는 기존 뱅샐 매핑 로직(classifyBanksaladRow의 suggestMajor → '기타' 우선 sub 선택)의 결과를 그대로 전달. `taxonomy`는 가구의 hidden=false 카테고리 전체, `examples`는 최근 커밋 거래 중 가맹점·분류가 있는 것 상위 20개, `aiSetting`은 settings의 'ai_fallback_enabled' 값.
3. 각 행의 인박스 insert에 추가: `sugSource`(확장된 값), `confidence: assessConfidence({ sugSource, historyMatch, alwaysConfirm, hasDup: false, kind, categoryId, exactAmountRepeat })`. (hasDup은 스테이징 후 `refreshDuplicateFlags`가 정하므로 여기선 false — 아래 4번.)
4. `refreshDuplicateFlags`가 dupNote를 세팅/해제할 때 **confidence도 재계산**하도록 수정: dupNote가 생기면 무조건 `confidence='review'`로 강등, dupNote가 사라져도 자동 승격은 하지 않는다(안전 우선, 사용자가 볼 것).
5. 업로드 결과 flash/요약 문구에 "자동 분류 N건 · 확인 필요 M건" 추가.

- [ ] **Step 5: 실행 → 통과 + 전체 회귀**

Run: `pnpm test tests/finance/resolve-suggestion.test.ts && pnpm test`
Expected: 신규 PASS + 기존 인박스/업로드 테스트 PASS(뱅샐 3단계 동작은 user/ai 캐시가 비어 있으면 기존과 동일해야 함 — 기존 테스트가 sugSource 값을 단언하면 'history'/'banksalad'는 그대로라 통과).

- [ ] **Step 6: 커밋**

```bash
git add -A && git commit -m "feat(inbox): unified suggestion resolver (cache→history→ai→banksalad) wired into banksalad upload"
```

---

### Task 7: 카드 업로드 액션 + 업로드 UI

**Files:**
- Modify: `src/features/inbox/upload-action.ts`(카드 업로드 서버 액션 추가), 업로드 폼 컴포넌트(현 업로드 UI가 있는 파일 — `src/app/inbox/` 또는 `src/features/inbox/`에서 뱅샐 업로드 폼을 찾는다)
- Test: `tests/finance/card-upload.test.ts`

**Interfaces:**
- Consumes: Task 4(`parseCardStatement`/`cardFingerprint`/`looksLikeBanksalad`/`CARD_ISSUERS`), Task 6(`resolveSuggestions`), Task 3(`assessConfidence`).
- Produces: `uploadCardStatement(formData: FormData): Promise<{ error?: string }>` — FormData 필드: `file`(1개), `issuer`(CardIssuer), `owner`('DJ'|'YJ'). 지출 행만 생성, `source = 'card:'+issuer`, importUid = cardFingerprint(파일 내 동일행 occurrence 순번 포함). 멱등: uid가 transactions/inbox에 있으면 skip. 스테이징 후 `refreshDuplicateFlags` 호출(카드↔뱅샐 교차중복이 여기서 잡힘).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/finance/card-upload.test.ts` (기존 업로드 액션 테스트 파일이 있으면 그 패턴을 따라 FormData/가구 셋업 재사용):
```ts
import { beforeAll, afterAll, expect, test, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { uploadCardStatement } from '@/features/inbox/upload-action'

vi.mock('@/features/inbox/ai-classify', async (orig) => ({
  ...(await orig()), aiFallbackEnabled: () => false,   // 이 테스트는 AI 없이
}))
// requireHousehold를 테스트 가구로 모킹 — 기존 액션 테스트의 모킹 패턴을 따른다
let hid: string
vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({ userId: 'test-user', householdId: hid }),
}))

const HYUNDAI_HTML = Buffer.from(`
<html><body><table>
<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
<tr><td>2026.08.03</td><td>카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>2026.08.03</td><td>카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>합계</td><td></td><td></td><td>13,000</td><td></td></tr>
</table></body></html>`, 'utf-8')

function makeFormData(): FormData {
  const fd = new FormData()
  fd.set('file', new File([HYUNDAI_HTML], 'hyundai.xls'))
  fd.set('issuer', 'hyundai')
  fd.set('owner', 'DJ')
  return fd
}

beforeAll(async () => {
  const [h] = await db.execute<{ id: string }>(
    sql`insert into households (name) values ('TEST-cardup') returning id`)
  hid = h.id
})
afterAll(async () => { await db.execute(sql`delete from households where id = ${hid}`) })

test('stages card rows into inbox with card source; same-row duplicates preserved', async () => {
  const res = await uploadCardStatement(makeFormData())
  expect(res.error).toBeUndefined()
  const rows = await db.execute<{ merchant: string; amount: number; import_uid: string }>(sql`
    select merchant, amount, import_uid from import_inbox
    where household_id = ${hid} and status = 'pending' order by id`)
  expect(rows).toHaveLength(2)                          // 같은 날 같은 금액 2건 보존
  expect(rows[0].import_uid).not.toBe(rows[1].import_uid)
})

test('re-upload is idempotent (0 new)', async () => {
  await uploadCardStatement(makeFormData())
  const [{ n }] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from import_inbox where household_id = ${hid}`)
  expect(n).toBe(2)
})
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `pnpm test tests/finance/card-upload.test.ts`
Expected: FAIL (uploadCardStatement 없음)

- [ ] **Step 3: 카드 업로드 액션 구현**

`src/features/inbox/upload-action.ts`에 추가 (기존 `uploadBanksaladFiles`의 구조 — requireHousehold, done-uid 수집, 스테이징 insert, refreshDuplicateFlags 호출 — 를 재사용/공용화하되 기존 함수 시그니처는 유지):
```ts
export async function uploadCardStatement(formData: FormData): Promise<{ error?: string }> {
  const household = await requireHousehold()
  if (!household) return { error: '가구 연결이 필요합니다.' }

  const file = formData.get('file')
  const issuer = String(formData.get('issuer') ?? '') as CardIssuer
  const owner = String(formData.get('owner') ?? '')
  if (!(file instanceof File)) return { error: '파일을 선택하세요.' }
  if (!CARD_ISSUERS.some((c) => c.key === issuer)) return { error: '카드사를 선택하세요.' }
  if (owner !== 'DJ' && owner !== 'YJ') return { error: '소유자를 선택하세요.' }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (looksLikeBanksalad(buffer)) return { error: '뱅크샐러드 파일입니다 — 뱅샐 업로드를 사용하세요.' }

  let rows: CardRow[]
  try {
    rows = parseCardStatement(buffer, issuer)
  } catch (e) {
    return { error: `파일을 읽지 못했습니다: ${(e as Error).message}` }
  }
  if (rows.length === 0) return { error: '거래 행을 찾지 못했습니다. 카드사 선택이 맞는지 확인하세요.' }

  // occurrence 순번(파일 내 동일 날짜·금액·가맹점의 n번째)으로 지문 — 재업로드 멱등 + 동일행 보존
  const seen = new Map<string, number>()
  const staged = rows.map((row) => {
    const key = `${row.date}|${row.amount}|${row.merchant}`
    const idx = seen.get(key) ?? 0
    seen.set(key, idx + 1)
    return { row, uid: cardFingerprint(issuer, owner, row, idx) }
  })

  // 이하 기존 뱅샐 스테이징과 동일 골격:
  // 1) transactions/import_inbox의 기존 uid 수집 → 이미 있는 것 skip
  // 2) resolveSuggestions로 분류/확신도 결정 (bsSuggestCategoryId는 null — 카드엔 뱅샐 분류가 없다)
  // 3) import_inbox insert: owner, date, merchant, amount, flow='expense', kind='normal',
  //    pay=CARD_ISSUERS label, source 구분을 위해 bsCat1/bsCat2는 null,
  //    importUid=uid, sugSource/confidence/businessType(aiNote는 dupNote와 별개로 표시용 컬럼이 없으므로
  //    memo에 businessType을 넣지 말고 — sugSource='ai'면 UI가 merchant_lookup에서 aiNote를 조회)
  // 4) refreshDuplicateFlags(householdId) — 카드↔뱅샐 교차중복 감지 + confidence 강등
  // (기존 uploadBanksaladFiles의 해당 부분을 공용 함수로 추출해 양쪽에서 사용)
  …
  return {}
}
```
(주: `…` 부분은 기존 `uploadBanksaladFiles`의 스테이징 골격을 `stageInboxRows(householdId, rows)` 류의 공용 내부 함수로 추출해 구현한다 — 중복 구현 금지. 추출 시 기존 뱅샐 테스트가 깨지지 않아야 한다.)

- [ ] **Step 4: 업로드 UI 확장**

업로드 폼에 탭 또는 라디오: "뱅크샐러드" | "카드사 명세서". 카드사 선택 시 `CARD_ISSUERS` 드롭다운 + 소유자(DJ/YJ) 드롭다운 표시, `uploadCardStatement` 액션으로 제출. 파일 accept는 `.xls,.xlsx` (내용 스니핑은 서버에서).

- [ ] **Step 5: 실행 → 통과 + 회귀 + 커밋**

Run: `pnpm test tests/finance/card-upload.test.ts && pnpm test`
Expected: PASS 전체.
```bash
git add -A && git commit -m "feat(inbox): card statement upload action + issuer/owner UI"
```

---

### Task 8: 커밋 학습을 merchant_lookup로 전환 (category_rules 동결)

**Files:**
- Modify: `src/features/inbox/actions.ts`(`processInbox`의 규칙 학습부, `classifyTransaction`의 학습부)
- Test: `tests/finance/inbox-actions.test.ts`(기존 테스트 수정/확장 — 파일명이 다르면 processInbox를 커버하는 기존 테스트 파일)

**Interfaces:**
- Consumes: Task 2(`upsertMerchantLookup`, `normalizeMerchant`).
- Produces: 인박스 반영(apply) 시 각 행에 대해 `upsertMerchantLookup(householdId, { normMerchant, displayMerchant: merchant, categoryId, flow }, 'user')` 호출. category_rules에는 더 이상 쓰지 않는다(기존 학습 코드 삭제).

- [ ] **Step 1: 실패하는 테스트 작성/수정**

processInbox를 커버하는 기존 테스트에 추가(없으면 신규 파일):
```ts
test('processInbox apply learns into merchant_lookup as user source', async () => {
  // (기존 테스트의 셋업 재사용: 가구 + 카테고리 + pending inbox 행 1개 생성 후 apply)
  // apply 후:
  const rows = await db.execute<{ source: string; category_id: number }>(sql`
    select source, category_id from merchant_lookup
    where household_id = ${hid} and norm_merchant = ${normalizeMerchant('학습가게')}`)
  expect(rows).toHaveLength(1)
  expect(rows[0].source).toBe('user')
})

test('processInbox no longer writes category_rules', async () => {
  const [{ n }] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from category_rules where household_id = ${hid}`)
  expect(n).toBe(0)
})
```

- [ ] **Step 2: 실행 → 실패 확인 → 구현 → 통과**

Run: `pnpm test <해당 테스트 파일>`
구현: `processInbox`(및 `classifyTransaction`)에서 category_rules insert/update 코드를 제거하고 `upsertMerchantLookup(..., 'user')` 호출로 교체. account_aliases 학습은 그대로 유지.
Expected: PASS. 전체 스위트도 PASS(`pnpm test`) — category_rules를 단언하던 기존 테스트가 있으면 merchant_lookup 단언으로 갱신.

- [ ] **Step 3: 커밋**

```bash
git add -A && git commit -m "feat(inbox): commit-time learning writes merchant_lookup; freeze category_rules"
```

---

### Task 9: 인박스 2단 UI + 일괄승인

**Files:**
- Modify: `src/app/inbox/page.tsx`(high/review 분리 조회 + aiNote/businessType 조인), `src/features/inbox/inbox-review-form.tsx`(2단 렌더), `src/features/inbox/actions.ts`(일괄승인)
- Test: `tests/finance/bulk-approve.test.ts`

**Interfaces:**
- Consumes: `importInbox.confidence`, `merchantLookup`(aiNote/businessType 표시), 기존 `processInbox`.
- Produces: `approveHighConfidence(): Promise<{ error?: string; applied?: number }>` — 현재 가구의 `status='pending' and confidence='high'` 행 전부를 **각 행에 저장된 categoryId/flow/accountId 그대로** 반영(기존 processInbox의 반영 경로 재사용 — 학습 포함). UI: 상단 접힘 섹션 "✓ 자동 분류됨 N건 · 합계 X원" + [N건 일괄 승인] + 펼쳐보기(행 클릭 시 review로 강등하는 `demoteToReview(id)` 액션), 하단 "확인 필요 M건" 기존 폼 + 배지(sugSource: 캐시/이력/AI/뱅샐) + AI 근거 툴팁(businessType · aiNote) + 애그리게이터 배지.

- [ ] **Step 1: 실패하는 테스트 작성 (일괄승인 서버 액션)**

Create `tests/finance/bulk-approve.test.ts`:
```ts
// 셋업: 가구 + 카테고리 + pending 행 3개
//   A: confidence='high' categoryId 있음
//   B: confidence='high' categoryId 있음
//   C: confidence='review'
test('approveHighConfidence applies only high rows', async () => {
  const res = await approveHighConfidence()
  expect(res.applied).toBe(2)
  const [{ done }] = await db.execute<{ done: number }>(sql`
    select count(*)::int as done from import_inbox
    where household_id = ${hid} and status = 'done'`)
  expect(done).toBe(2)
  const [{ tx }] = await db.execute<{ tx: number }>(sql`
    select count(*)::int as tx from transactions where household_id = ${hid}`)
  expect(tx).toBe(2)
  const [{ pending }] = await db.execute<{ pending: number }>(sql`
    select count(*)::int as pending from import_inbox
    where household_id = ${hid} and status = 'pending'`)
  expect(pending).toBe(1)                             // review 행은 남는다
})
```
(requireHousehold 모킹·가구 셋업은 Task 7 테스트와 동일 패턴.)

- [ ] **Step 2: 실행 → 실패 → 구현 → 통과**

`approveHighConfidence`는 기존 `processInbox`의 반영 경로(transactions insert + merchant_lookup 학습 + status='done' + refreshDuplicateFlags)를 재사용해 구현 — 별도 insert 로직 중복 금지. `demoteToReview(id)`는 `update import_inbox set confidence='review' where id and household_id and status='pending'`.

- [ ] **Step 3: UI 구현**

- `src/app/inbox/page.tsx`: pending 행을 confidence로 분리해 두 리스트로 전달. sugSource='ai'인 행은 merchant_lookup에서 businessType/aiNote를 조인해 함께 전달.
- `inbox-review-form.tsx`: 상단에 접힘 `<details>` 스타일 섹션(건수·합계 요약 + 일괄승인 버튼 + 펼치면 read-only 행 목록, 각 행에 "수정" 버튼 → demoteToReview). 하단 기존 폼은 review 행만. 배지: `sugSource`별 라벨(캐시=초록 "확정", 이력=초록 "이력", AI=보라 "AI", 뱅샐=회색 "뱅샐") + `title` 툴팁에 businessType·aiNote, alwaysConfirm이면 노랑 "확인 필요(애그리게이터)" 배지. 기존 dupNote 배지·자동해제 동작 유지.

- [ ] **Step 4: 수동 확인 + 전체 회귀 + 커밋**

Run: `pnpm dev`로 인박스 화면 확인(접힘/펼침/일괄승인/배지), `pnpm test` 전체 PASS.
```bash
git add -A && git commit -m "feat(inbox): two-tier inbox UI (folded high-confidence + bulk approve + source badges)"
```

---

### Task 10: /manage 가맹점 사전 탭

**Files:**
- Modify: `src/app/manage/` 하위(기존 관리 페이지 패턴에 탭/섹션 추가), `src/features/manage/actions.ts`(또는 해당 위치)
- Test: `tests/finance/merchant-dictionary.test.ts`

**Interfaces:**
- Consumes: `merchantLookup`.
- Produces: 서버 액션 3개 — `updateMerchantLookupCategory(id, categoryId, flow)`, `toggleAlwaysConfirm(id)`, `deleteMerchantLookup(id)` (전부 householdId 필터 필수). UI: merchant_lookup 목록(display/norm, 업종, 분류, 출처 배지, alwaysConfirm 토글, hitCount, 삭제) — 기존 /manage의 항목/별칭 관리 UI 패턴을 따른다.

- [ ] **Step 1: 실패하는 테스트 (액션 3개 — householdId 격리 포함)**

```ts
test('update/toggle/delete scoped to own household', async () => {
  // 가구 A에 lookup 1행. 가구 B의 컨텍스트(requireHousehold 모킹 전환)로 update 시도 → 영향 0행.
  // 가구 A 컨텍스트로 toggleAlwaysConfirm → true 반전 확인. delete → 행 제거 확인.
})
```
(구체 셋업은 Task 2 테스트의 가구 생성 패턴 재사용. "영향 0행" 단언은 update 반환 rowCount 또는 재조회로.)

- [ ] **Step 2: 실행 → 실패 → 구현 → 통과 → 커밋**

Run: `pnpm test tests/finance/merchant-dictionary.test.ts && pnpm test`
```bash
git add -A && git commit -m "feat(manage): merchant dictionary tab (edit/toggle/delete lookup entries)"
```

---

### Task 11: E2E — 업로드→접힘→일괄승인→가계부 반영

**Files:**
- Create: `tests/e2e/smart-classification.spec.ts`
- Test: 그 자체.

**Interfaces:**
- Consumes: 전체. 로컬 Supabase + dev 서버(기존 playwright.config 재사용). 테스트 유저/가구는 기존 auth e2e의 셋업 패턴을 따른다(가입 → link 스크립트 or 기존 시드 유저).

- [ ] **Step 1: spec 작성**

```ts
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// 이력이 없는 신규 가맹점만 있는 합성 현대카드 HTML → AI off 환경에선 전부 '확인 필요'로,
// 이력을 먼저 심으면 '자동 분류'로 접히는지가 핵심 시나리오.
const CARD_HTML = `<html><body><table>
<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
<tr><td>2026.08.20</td><td>카드</td><td>E2E테스트카페</td><td>5,000</td><td>5,000</td></tr>
<tr><td>합계</td><td></td><td></td><td>5,000</td><td></td></tr>
</table></body></html>`

test('card upload → review → classify → next upload folds as high confidence', async ({ page }) => {
  const file = path.join(tmpdir(), 'e2e-card.xls')
  writeFileSync(file, CARD_HTML)

  // (로그인: 기존 auth e2e 헬퍼/패턴 재사용)
  await page.goto('/inbox')
  // 1차 업로드: 카드사 탭 → 현대카드/DJ 선택 → 파일 업로드
  await page.getByRole('radio', { name: '카드사 명세서' }).check()
  await page.getByLabel('카드사').selectOption('hyundai')
  await page.getByLabel('소유자').selectOption('DJ')
  await page.setInputFiles('input[type=file]', file)
  await page.getByRole('button', { name: '업로드' }).click()
  // 신규 가맹점 → 확인 필요 섹션에 표시
  await expect(page.getByText('E2E테스트카페')).toBeVisible()
  // 분류 지정 후 반영
  // (기존 인박스 폼의 셀렉터 사용 — 분류 드롭다운에서 식비 계열 선택 후 반영 버튼)
  // 반영 후: 가계부에 존재
  await page.goto('/ledger?month=2026-08')
  await expect(page.getByText('E2E테스트카페')).toBeVisible()
})
```
(주: 정확한 셀렉터·버튼 문구는 Task 7/9에서 구현된 UI 텍스트에 맞춰 작성한다. 시나리오 골격 — 업로드→확인필요 표시→분류·반영→가계부 확인 — 은 유지. 여력이 되면 2차 업로드에서 같은 가맹점이 '자동 분류됨' 섹션으로 접히고 일괄승인이 동작하는 것까지 확장.)

- [ ] **Step 2: 실행 → 통과 → 커밋**

Run: `pnpm e2e`
Expected: 기존 auth spec + 신규 spec PASS.
```bash
git add -A && git commit -m "test(e2e): smart classification happy path (upload→review→apply→ledger)"
```

---

## Self-Review

**1. 스펙 커버리지**
- merchant_lookup 스키마/우선순위/애그리게이터 → Task 1, 2 ✅
- 확신도 판정(HIGH 조건, 토큰=review, 구독 승격) → Task 3 ✅
- 카드 파서 5종 + 3종 포맷 + 지문/멱등 + 실파일 검증 → Task 4, 7 ✅
- AI 폴백(OpenAI Responses+웹서치, 가맹점명만, 실패 무해, 토글, 캐시 저장, 절대 high 아님) → Task 5, 6(assessConfidence가 'ai'를 review로) ✅
- 우선순위 파이프라인(user→history→ai캐시→AI→뱅샐→빈칸) → Task 6 ✅
- category_rules 동결 + user 학습 전환 → Task 8 ✅
- 2단 UI/일괄승인/배지/강등 → Task 9 ✅
- 가맹점 사전 관리 → Task 10 ✅
- E2E → Task 11 ✅
- 비목표(자동 반영 없음) → approveHighConfidence는 명시 버튼 — 자동 커밋 없음 ✅

**2. 플레이스홀더 스캔**: Task 6 Step 4와 Task 7 Step 3의 기존 코드 통합부는 대상 파일을 구현자가 읽어야 하는 Modify 지점이라 동작 명세+골격으로 기술했고(신규 코드는 전부 완전体), "TBD/적절히" 류 없음. Task 2 Step 4에 잘못된 예시 스니펫을 "넣지 말 것"으로 명시.

**3. 타입 일관성**: `normalizeMerchant`, `MerchantLookupEntry`, `lookupMerchants/upsertMerchantLookup(…, source)`, `SugSource`('user'|'history'|'ai'|'banksalad'|null), `assessConfidence(ConfidenceInput)`, `buildAmountRepeatIndex`(키 `norm|amount`), `CardRow/CardIssuer/parseCardStatement/cardFingerprint(issuer, owner, row, occurrenceIdx)`, `classifyUnknownMerchants/aiFallbackEnabled`, `resolveSuggestions/ResolvedSuggestion`, `approveHighConfidence/demoteToReview` — 정의 Task와 사용 Task에서 동일 서명 확인.

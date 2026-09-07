# Finance Web 신뢰성 우선 리팩터링 설계

- 작성일: 2026-09-07
- 대상: `finance-web`
- 기준 커밋: `3bd4824331143df5d0f8b864649b68cfb5f24843`
- 상태: 사용자 승인 설계
- 접근법: 신뢰성 우선 수직 슬라이스

## 1. 목적

`finance-web`의 현재 제품 기능과 Swiss Ledger 정보 구조를 유지하면서 데이터 무결성, 가구 격리, 가져오기 안정성, 조회 성능, 코드 경계, 테스트와 배포 절차를 함께 단단하게 만든다.

이 작업은 프레임워크 교체나 재작성 작업이 아니다. Next.js, Supabase, Drizzle, Chart.js와 현재 서버 렌더링 구조를 유지한다. 순저축률, 예산 페이스, 지출 예측, 자산 계산, 분류 신뢰도 같은 기존 업무 계산식도 의도적으로 변경하지 않는다.

## 2. 현재 상태

현재 저장소는 다음 강점을 갖는다.

- 업무 데이터가 `household_id`를 보유하며 현재 애플리케이션 쿼리는 대체로 이를 명시적으로 제한한다.
- 인박스 반영은 거래 생성, 별칭 학습, 가맹점 학습, 상태 변경을 하나의 트랜잭션으로 처리한다.
- OpenAI 분류는 선택적이며 실패 시 사용자 검토 상태로 안전하게 내려간다.
- 지문과 인박스 상태, 정기거래 잠금, RLS 테스트 등 주요 안전장치가 이미 존재한다.
- 기준 커밋에서 lint, TypeScript 검사, production build가 통과한다.
- 로컬 Supabase가 꺼진 상태에서도 DB 비의존 테스트 137개가 통과한다.

동시에 다음 구조적 문제가 확인됐다.

- owner DB 연결이 RLS를 우회하므로 가구 격리가 27개 애플리케이션 모듈의 수동 규칙에 의존한다.
- 홈, 통계, 내역이 같은 거래·예산·자산 데이터를 여러 번 조회한다.
- 서버 액션이 FormData 해석, 인증, 업무 규칙, SQL, redirect와 revalidation을 함께 담당한다.
- 공통 재무 규칙과 타입이 기능 폴더 사이에 중복되고 일부 반올림 동작이 이미 갈라졌다.
- 가져오기 저장 과정 일부가 여러 트랜잭션으로 나뉘고 전체 이력을 매번 스캔한다.
- 테스트가 unit과 integration으로 구분되지 않아 로컬 DB가 꺼지면 전체 실행 결과를 해석하기 어렵다.
- 현재 정보 구조 개편 이전의 E2E와 사용되지 않는 UI 코드가 남아 있다.

## 3. 설계 원칙

### 3.1 신뢰성을 먼저 고정한다

구조를 옮기기 전에 현재 계산 결과와 핵심 사용 흐름을 characterization 테스트로 고정한다. 확인된 데이터 결함은 같은 슬라이스에서 회귀 테스트를 먼저 추가한 뒤 수정한다.

### 3.2 수직 슬라이스로 배포한다

각 슬라이스는 테스트, 스키마 또는 코드 변경, 검증, 문서 갱신을 함께 포함한다. 모든 슬라이스는 독립적으로 배포 가능해야 하며 다음 슬라이스를 기다리지 않아도 안전해야 한다.

### 3.3 업무 복잡성과 우발적 복잡성을 구분한다

카드사별 파서, 사용자 검토형 AI 분류, 월·연간 분석은 필요한 복잡성이다. 이를 하나의 범용 파서나 전역 상태로 억지로 합치지 않는다. 중복 SQL, 흩어진 tenant 조건, 비대한 서버 액션과 화면 coordinator만 제거한다.

### 3.4 데이터 격리는 타입과 DB가 함께 보장한다

`householdId`를 주석과 코드 리뷰에만 의존시키지 않는다. 애플리케이션 경계, TypeScript 타입, SQL 제약, 권한 검사와 자동 테스트가 같은 규칙을 보장한다.

### 3.5 계산식 변경과 구조 변경을 분리한다

공통 계산 함수를 이동할 때 입력과 출력의 golden test가 먼저 존재해야 한다. 서로 다른 반올림 의미는 이름으로 구분하고, 단순히 중복처럼 보인다는 이유로 합치지 않는다.

## 4. 목표 구조

```text
src/domain/
  finance/            기간, Flow, 금액, 저축률, 반올림
  budgets/            목표 저축률, 예산 override, 지출 상한
  merchants/          가맹점 정규화와 추천 정책
  imports/            source identity와 import plan 타입

src/server/data/
  household/          인증된 가구 scope 생성
  ledger/             거래 조회와 저장
  dashboard/          홈 전용 snapshot loader
  annual-stats/       통계 전용 snapshot loader
  imports/            인박스와 import run 저장
  assets/             월 기준 effective balance 조회
  taxonomy/           계정·카테고리 소유권 조회

src/server/use-cases/
  stage-import.ts
  apply-inbox.ts
  classify-transactions.ts
  post-recurring.ts
  archive-asset-account.ts

src/features/
  화면 UI, 순수 view model, 얇은 server-action adapter

src/app/
  인증, 라우팅, compatibility redirect, 페이지 조립
```

모든 테이블에 범용 repository class를 만들지는 않는다. 가치가 있는 경계만 둔다.

- 원시 `db` import는 `src/server/data`, DB 초기화, scripts와 tests에서만 허용한다.
- 모든 tenant-owned data 함수는 `HouseholdScope`를 받는다.
- use case는 transaction 경계를 소유하고 Next.js API를 import하지 않는다.
- server action은 입력 해석, use case 호출, 결과 변환만 담당한다.
- 화면 loader는 화면이 실제 사용하는 read model만 반환한다.

## 5. 핵심 타입과 계약

### 5.1 HouseholdScope

```ts
type HouseholdId = string & { readonly __householdId: unique symbol }

type HouseholdScope = {
  userId: string
  householdId: HouseholdId
  email: string
  role: 'owner' | 'member'
}
```

`HouseholdScope`는 인증 및 membership 확인을 통과한 단일 함수에서만 생성한다. 데이터 함수가 임의 문자열을 tenant 식별자로 받지 않게 한다.

현재 제품은 한 사용자가 하나의 가구에 속하는 모델로 고정한다. `household_members.user_id`에 unique 제약을 추가하고, membership 조회는 단일 결과를 요구한다. 다중 가구 전환은 별도 제품 기능으로 다룬다.

현재 DJ/YJ 사용자는 재무 기능에서 동등한 권한을 유지한다. `owner/member` 값은 이번 범위에서 업무 권한 차이로 사용하지 않으며 membership 추가·삭제는 브라우저 업무 테이블 DML이 아니라 관리 script를 통해서만 수행한다.

### 5.2 ActionResult

redirect가 필요 없는 mutation은 공통 결과 계약을 사용한다.

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; traceId: string }
```

사용자에게는 안정된 한국어 메시지만 전달한다. parser, DB, OpenAI의 원문 오류는 `traceId`와 함께 서버 로그에 구조화해 남긴다. redirect 기반 폼은 이 결과를 받은 adapter가 redirect를 수행한다.

### 5.3 Domain events

mutation은 다음 이벤트 중 필요한 항목을 반환한다.

- `transactionsChanged`
- `inboxChanged`
- `assetsChanged`
- `budgetsChanged`
- `taxonomyChanged`
- `recurringChanged`

Next.js adapter가 중앙 매핑을 통해 관련 경로를 revalidate한다. 개별 action에 경로 문자열을 반복하지 않는다.

## 6. 데이터 무결성 설계

### 6.1 Tenant 참조 무결성

부모 테이블의 `(household_id, id)`에 unique 제약을 추가하고 tenant-owned 참조를 복합 FK로 교체한다.

적용 대상은 다음과 같다.

- 거래 → 카테고리, 결제수단, import batch, 정기거래
- 인박스 → 카테고리, 결제수단, import run
- 정기거래 → 카테고리, 결제수단
- 카테고리 규칙 → 카테고리, 결제수단
- 결제수단 별칭 → 결제수단
- 가맹점 lookup → 카테고리
- 잔액 snapshot → 자산 계정

기존 단일 ID FK는 복합 FK 검증 후 제거한다. migration 전에 cross-household 참조가 없는지 진단 쿼리를 실행하고, 한 건이라도 발견되면 자동 수정하지 않고 migration을 중단한다.

런타임 업무 데이터는 owner DB 연결만 사용하므로 `authenticated` 역할의 public 업무 테이블 및 sequence 직접 DML 권한을 회수한다. RLS는 방어층으로 유지하되 미래 테이블에 자동 DML 권한을 부여하는 default privilege도 제거한다.

월 단위 column에는 DB check를 추가한다. `balance_snapshots.month`와 `asset_accounts.archived_month`는 `YYYY-MM`, `budgets.month`는 `YYYY-MM` 또는 `*`만 허용한다. `asset_accounts.kind`는 `asset | liability`, 정기거래의 `day`는 1~31만 허용한다.

### 6.2 자산 snapshot

뱅크샐러드 업로드 폼에 `기준 월`을 추가한다.

- 기본값은 한국 시간의 현재 월이다.
- 같은 요청에 포함된 DJ/YJ 파일은 같은 기준 월을 사용한다.
- 파일에서 신뢰할 수 있는 기준일을 읽더라도 추천값으로만 사용하며 사용자가 확인한 월이 최종값이다.
- 마지막 거래 날짜로 자산 월을 추론하지 않는다.

파서는 파일에 실제로 관찰된 계좌를 금액이 0이어도 반환한다. 명시적으로 관찰된 0원만 snapshot으로 저장하고, 파일에 존재하지 않는 계좌를 임의로 0원 처리하지 않는다.

`asset_accounts`에는 nullable `archived_month`를 추가한다. 계정을 보관하면 `active=false`와 한국 현재 월을 함께 저장한다. 특정 월의 자산 집계는 `archived_month is null or archived_month > targetMonth`인 계정만 포함한다. 보관 전 월의 과거 snapshot은 유지한다.

모든 자산 화면은 하나의 `loadEffectiveBalances(scope, asOfMonth)` 계약을 사용한다. 미래 snapshot은 해당 기준 월 집계에 포함하지 않는다.

### 6.3 거래 identity와 환불

뱅크샐러드의 기존 첫 번째 지문은 호환성을 위해 유지한다. 같은 파일 안에서 동일 identity가 두 번 이상 나타나면 두 번째부터 deterministic occurrence suffix를 붙인 versioned UID를 만든다. 재업로드 시 같은 순서라면 같은 UID가 생성되어 멱등성을 유지한다.

카드 파서는 signed amount를 반환한다.

- 일반 사용 행은 양수 지출이다.
- 카드사별로 명확히 확인된 취소·환불 행은 음수 지출이다.
- 할인, 혜택, 소계 표를 취소로 오인하지 않는다.
- 의미가 불명확한 음수 행은 버리지 않고 review 상태로 staging한다.

각 카드사의 취소 형식은 개인정보를 제거한 fixture로 고정한다.

### 6.4 정기거래 identity

정기거래 생성 transaction의 `import_uid`에 `recurring:v1:<ruleId>:<YYYY-MM>`을 저장한다. 기존 `(household_id, import_uid)` unique 제약을 authoritative idempotency guard로 사용한다. 사용자가 생성된 거래 날짜를 다른 월로 옮겨도 원래 occurrence identity는 바뀌지 않는다.

### 6.5 처리 시각

`import_inbox`에 nullable `processed_at`을 추가한다. `done` 또는 `dismissed`로 전환하는 transaction 안에서 현재 시각을 저장하고, pending으로 되돌릴 때는 null로 복원한다. 처리 기록은 `created_at`이 아니라 `processed_at`을 사용한다.

## 7. 가져오기 파이프라인

가져오기는 다음 단계로 통일한다.

```text
authenticate
  → validate request
  → create import run
  → parse source-specific files
  → normalize identities
  → resolve account/category suggestions
  → optional OpenAI classification
  → build immutable ImportPlan
  → persist plan in one transaction
  → return stable result
```

### 7.1 Import run

새 `import_runs` 테이블은 다음 정보를 가진다.

- `id`, `household_id`, `source`, 요청에 포함된 파일 metadata JSON
- `status`: `parsing | classifying | persisting | completed | failed`
- parsed, staged, skipped, duplicate, asset snapshot 건수
- 안전한 `error_code`, `started_at`, `completed_at`

파일 metadata에는 원본 binary나 내용은 저장하지 않고 owner, source와 표시용 filename만 저장한다. `import_inbox.import_run_id`는 기존 행 호환을 위해 nullable로 추가한다.

run 생성과 단계 상태 갱신은 짧은 독립 mutation이다. 실제 인박스 행, duplicate note와 자산 snapshot은 하나의 persistence transaction에서 저장한다. 실패한 run은 부분 성공으로 표시하지 않는다.

Vercel background worker나 별도 queue는 도입하지 않는다. 기존 요청-응답 모델과 클라이언트 단계 표시를 유지하며 run은 감사와 안전한 재시도 기준으로 사용한다.

### 7.2 ImportPlan

파서와 분류기는 DB를 직접 수정하지 않고 불변 `ImportPlan`을 반환한다. plan은 다음을 포함한다.

- source metadata와 기준 월
- staged rows와 source UID
- 명시적으로 관찰된 자산 balances
- 신규 alias 또는 merchant learning 후보
- skip 및 review 사유

OpenAI cache 조회·저장은 별도 data gateway를 통하며 외부 호출 중 DB transaction을 유지하지 않는다.

### 7.3 저장과 성능

- 전체 UID를 메모리로 미리 읽지 않고 입력 UID 집합만 DB에 조회한다.
- 최종 충돌 판정은 unique 제약을 기준으로 한다.
- duplicate 후보는 새 행의 날짜·금액 범위만 조회한다.
- inbox insert는 chunk를 사용해도 하나의 상위 transaction에 속한다.
- duplicate note와 merchant learning은 행별 update 대신 bulk operation을 사용한다.
- 분류 이력은 현재 업로드에 등장한 normalized merchant만 DB에서 집계한다. 전체 기간의 분류 의미는 유지하되 관련 없는 거래 행을 애플리케이션 메모리로 읽지 않는다.

## 8. 조회 모델

### 8.1 홈

`getDashboardPageData(scope, month)`가 홈에 필요한 단일 read model을 반환한다.

- 요청 범위의 거래 projection을 한 번 읽는다.
- 예산, 목표 저축률, irregular metadata, 인박스 요약과 자산 snapshot을 필요한 범위로만 읽는다.
- 현재 순수 계산 함수가 KPI, 할 일, 예산 페이스와 차트를 만든다.
- pending inbox count를 header와 홈이 각각 다시 조회하지 않는다.
- 현재 페이지에서 사용하지 않는 financial-health 데이터는 조회하지 않는다.

### 8.2 통계

`getAnnualStatsPageData(scope, year)`는 현재·전년도 범위를 하나의 일관된 snapshot으로 조립한다. 홈 loader를 재사용하지 않는다. 거래 projection, taxonomy와 기준 월 자산만 읽고 기존 통계 계산 함수에 전달한다.

### 8.3 내역

내역은 shell과 탭별 loader로 나눈다.

- shell: 선택 월, 사용 가능한 월, 필터 option, 최소 요약
- summary/category/merchant: 선택된 탭에 필요한 집계만 조회
- list: `{ rows, total, nextCursor }`
- recurring: 해당 탭 또는 action에 필요한 상태만 조회

목록은 `(date, id)` cursor pagination을 사용한다. 한 페이지는 100건이며 사용자가 더 불러올 수 있다. 전체 건수와 현재 표시 건수를 구분하고 500건을 초과해도 조용히 잘리지 않는다.

### 8.4 캐시

이번 리팩터링의 첫 단계에서는 persistent data cache를 추가하지 않는다. 중복 loader를 제거하고 invalidation 경계를 확정한 뒤 실제 측정 결과가 필요할 때만 캐시를 도입한다.

## 9. Mutation과 UI 구조

### 9.1 Server actions

대형 action 파일을 업무 단위 adapter로 나눈다.

- FormData와 URL 입력 검증
- `HouseholdScope` 획득
- use case 호출
- `ActionResult` 또는 redirect 변환
- domain event 기반 revalidation

소유권 검증, merchant learning, category/account lookup은 공통 data 함수로 이동한다.

### 9.2 통계 화면

`StatsMonthlySection`의 현재 데이터 모델과 상호작용은 유지하면서 다음 단위로 분리한다.

- `useStatsViewState`: URL, flow, axis, chart, 선택과 제외 상태
- `useCellTransactionsTooltip`: fetch, cache, timer와 위치 계산
- `StatsControls`
- `StatsChartPane`
- `StatsDetailGrid`
- `StatsTooltip`

전역 store는 추가하지 않는다. 상태는 통계 섹션 안에 유지한다.

### 9.3 Compatibility와 dead code

`/analysis`, `/category` compatibility redirect는 유지한다. 앱 내부 링크는 현재 정보 구조의 canonical URL만 사용한다.

미사용 후보 파일은 정적 import 검색, 현재 E2E, production build를 모두 통과한 뒤 삭제한다. `category_rules`는 실제 production 데이터 사용 여부를 확인하기 전에는 schema나 migration에서 제거하지 않는다.

## 10. 테스트 전략

### 10.1 테스트 계층

- unit: DB와 네트워크 없이 domain 계산, parser, view model 검증
- integration: 로컬 Supabase에서 schema, RLS, repository, transaction 검증
- E2E: 현재 홈·내역·통계·가져오기 핵심 흐름 검증
- migration: 빈 DB와 production 구조를 복제한 DB 모두에서 forward migration 검증

DB 의존 파일은 `*.integration.test.ts`로 구분한다. 명령은 다음 의미를 갖는다.

- `pnpm test:unit`: 외부 서비스 없이 빠르게 실행
- `pnpm test:integration`: Supabase preflight 후 DB 테스트 실행
- `pnpm test`: unit과 integration 전체 실행
- `pnpm verify`: lint, typecheck, unit, build
- `pnpm verify:full`: integration과 핵심 E2E까지 포함

Supabase가 꺼져 있으면 integration test는 수십 개의 connection error를 출력하지 않고 한 번의 명확한 preflight 오류로 종료한다.

### 10.2 필수 회귀 fixture

- 순저축률, 예산 페이스, 예측과 완료 월 평균의 기존 golden 값
- 명시적 0원 예금·투자와 완납 대출
- 거래가 없는 현재 월의 자산 업로드
- 미래 snapshot과 보관 계정
- 완전히 동일한 뱅샐 거래 두 건과 재업로드
- 카드사별 취소·환불 및 할인 표 구분
- 날짜가 이동된 정기거래 재반영
- 모든 tenant 복합 참조의 cross-household 쓰기 거부
- import persistence 중간 실패 rollback
- 500건을 넘는 내역 pagination
- 현재 정보 구조의 redirect와 탭 URL 보존

### 10.3 Architecture test

자동 검사로 다음을 막는다.

- 허용 디렉터리 밖의 `@/db/client` import
- public 업무 테이블의 RLS 또는 권한 누락
- tenant-owned FK의 복합 가구 제약 누락
- migration journal과 schema compatibility 불일치
- client component에서 server-only module import

## 11. 환경과 배포

### 11.1 환경변수

환경변수 접근은 server/client별 typed module로 모은다. 필수 키 누락은 해당 모듈 초기화 시 변수 이름과 실행 환경을 포함한 오류로 실패한다. secret 값은 로그에 출력하지 않는다.

`packageManager`와 CI에서 사용하는 Supabase CLI 버전을 고정해 로컬과 Vercel의 도구 선택 차이를 줄인다.

### 11.2 CI

GitHub Actions에서 다음 순서를 실행한다.

```text
install with frozen lockfile
  → lint
  → typecheck
  → unit tests
  → start local Supabase
  → apply migrations
  → integration tests
  → production build
  → core E2E
```

E2E는 과거 `/analysis` 화면이 아니라 현재 홈·내역·통계·가져오기 흐름을 검사한다.

### 11.3 Production migration

스키마 변경은 expand/contract 순서를 따른다.

1. production backup 또는 snapshot 확보
2. cross-household 참조와 기존 값 진단
3. nullable column, parent unique key와 새 테이블 추가
4. application dual-read 또는 backward-compatible code 배포
5. backfill 및 검증
6. 복합 FK, unique, check와 권한 제한 적용
7. 새 code path 전환
8. 사용하지 않는 단일 FK와 compatibility code 제거

각 단계는 non-mutating schema compatibility 검사와 row-count/invariant 검사를 통과해야 한다. 검증 실패 시 다음 단계로 진행하지 않는다.

보호된 route의 공통 server 경계는 process별로 한 번 schema compatibility를 확인한다. 기대 migration보다 DB가 뒤처지면 임의의 column 오류 대신 maintenance-safe 오류와 trace ID를 반환한다. production 배포 절차에는 direct 또는 session-pooler URL로 실행하는 `release:check`를 두고, migration 확인 없이 destructive contract 단계로 넘어가지 않는다.

## 12. 구현 슬라이스

### Slice 0 — 안전망과 현재 상태 고정

- package manager 고정
- unit/integration 명령 분리와 Supabase preflight
- 현재 IA 기준 E2E 갱신
- 핵심 계산 characterization test
- 잘못된 정기거래 설정 링크 수정
- 미사용 코드 삭제 전 참조 목록 확정

### Slice 1 — 가져오기와 자산 정확성

- explicit asset month
- 명시적 zero balance
- BankSalad occurrence UID
- 카드사별 refund/cancellation
- processed timestamp
- 관련 parser와 integration test

### Slice 2 — Tenant와 schema 불변식

- `HouseholdScope`와 단일 membership
- parent composite unique와 tenant FK
- authenticated direct DML 및 default privilege 회수
- 전체 RLS/권한/FK architecture test
- 자산 `archived_month`

### Slice 3 — 원자적 import와 정기거래

- import run과 ImportPlan
- 공통 stage persistence transaction
- 범위 dedupe와 bulk learning
- immutable recurring occurrence UID
- failure/rollback/retry test

### Slice 4 — 내역 read model

- shell과 탭 loader 분리
- cursor pagination
- 중복 ledger query 제거
- 탭별 query integration test

### Slice 5 — 홈과 통계 read model

- dashboard shared snapshot
- annual stats shared snapshot
- effective asset balance 공통화
- query 범위 및 page result regression test

### Slice 6 — Domain과 mutation 경계

- finance, budget, merchant 공통 규칙 이동
- raw/display rounding 계약 분리
- thin action adapter와 use case
- domain event 기반 revalidation
- 안정된 ActionResult와 구조화 오류

### Slice 7 — UI 분리와 정리

- 통계 coordinator 분리
- 검증된 dead UI 삭제
- stale feature 이름과 dependency 방향 정리
- compatibility redirect 유지

### Slice 8 — 운영 게이트

- 환경변수 검증
- migration compatibility 검사
- CI 전체 파이프라인
- production backup, migration, smoke test 문서

## 13. 완료 조건

### 데이터

- 명시적으로 0원이 된 계좌와 완납 대출이 다음 달에 이전 금액으로 살아나지 않는다.
- 자산 snapshot은 사용자가 확인한 기준 월에만 저장된다.
- 동일 내용의 실제 거래 두 건을 보존하면서 재업로드 멱등성이 유지된다.
- 지원 카드사의 명확한 환불이 지출에서 상계된다.
- 보관·미래 자산을 포함한 모든 화면이 같은 월 기준 잔액을 사용한다.
- 정기거래의 날짜 수정 후에도 같은 월 occurrence가 중복 생성되지 않는다.
- DB가 다른 가구의 category/account ID 참조를 거부한다.

### 구조

- runtime raw DB import는 허용된 server data 계층으로 제한된다.
- 홈, 통계, 내역은 화면 전용 read model을 사용한다.
- server action은 업무 transaction과 Next.js redirect/revalidation을 함께 구현하지 않는다.
- 공통 재무 규칙은 neutral domain module에 있고 기존 golden 값과 동일하다.
- 사용되지 않는 UI와 오래된 E2E 기대값이 제거된다.

### 성능과 UX

- 홈과 통계에서 동일 거래 범위를 여러 loader가 반복 조회하지 않는다.
- 내역 500건 초과 데이터가 조용히 잘리지 않는다.
- import는 전체 과거 UID와 전체 거래 이력을 매번 메모리에 올리지 않는다.
- 기존 Swiss Ledger 화면, 차트 hover, 셀 제외, 인박스 검토 상호작용이 유지된다.

### 검증과 운영

- lint, typecheck, unit, integration, production build와 핵심 E2E가 CI에서 통과한다.
- Supabase 미실행 오류와 환경변수 누락이 짧고 명확하게 보고된다.
- 모든 public 업무 테이블의 권한, RLS와 tenant FK가 자동 검사된다.
- production schema가 application 기대 버전보다 뒤처지면 배포 검증이 실패한다.

## 14. 위험과 완화

- **복합 FK migration 실패:** 적용 전 진단 쿼리로 오염 데이터를 검출하고 자동 수정하지 않는다.
- **기존 지문 호환성:** 첫 occurrence의 legacy UID를 유지하고 추가 occurrence만 versioning한다.
- **환불 오분류:** 카드사별 fixture로 확인된 행만 자동 음수 처리하고 나머지는 review로 보낸다.
- **반올림 회귀:** raw와 display rounding을 이름으로 분리하고 golden test 이후 이동한다.
- **조회 재구성 회귀:** 기존 loader와 신규 read model을 동일 fixture에서 비교한 뒤 전환한다.
- **대형 migration 위험:** expand/contract 단계마다 backup과 검증을 요구하고 destructive 변경은 마지막에 수행한다.
- **과도한 추상화:** 범용 repository, DI container, 전역 client state, 신규 runtime service를 도입하지 않는다.

## 15. 명시적 비범위

- Next.js, Supabase, Drizzle 또는 Chart.js 교체
- 별도 queue, worker, cache server 도입
- UI 정보 구조나 Swiss Ledger 시각 언어 재설계
- 저축률, 예산, 예측, 분류 confidence 정책 변경
- AI가 모호한 가맹점을 자동 확정하도록 변경
- 다중 가구 전환 UI
- compatibility redirect 즉시 제거

## 16. 승인된 결정

- 신뢰성 수정과 구조 리팩터링을 모두 수행한다.
- 신뢰성 우선 수직 슬라이스를 사용한다.
- raw DB 접근, 업무 use case, 화면 UI와 routing을 분리한다.
- 데이터 불변식은 애플리케이션과 PostgreSQL에서 함께 강제한다.
- 페이지별 read model로 중복 조회를 제거한다.
- 테스트, 오류 처리와 migration/CI gate를 구현 범위에 포함한다.

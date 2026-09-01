# 우리집 가계부

기존 Flask + SQLite 가계부를 온라인 운영용으로 옮기는 Next.js 앱입니다. 현재 기반 단계에는 다음이 포함됩니다.

- Next.js 15 App Router + TypeScript + Tailwind CSS
- Supabase Postgres/Auth + Drizzle ORM
- 모든 업무 데이터의 `household_id` 격리와 RLS 정책
- 기존 `finance.db` 전체 이관·검증 스크립트
- 이메일 가입/로그인, 보호 경로, 가구 멤버십 연결
- Vitest 통합 테스트와 Playwright 인증 E2E

## 로컬 실행

필수 도구는 Node.js 20+, pnpm, Docker Desktop입니다. Supabase CLI는 프로젝트 설정과 맞는 최신 버전을 일회성으로 실행합니다.

```bash
pnpm install
pnpm dlx supabase@latest start
cp .env.example .env.local
```

`pnpm dlx supabase@latest status`가 출력한 값으로 `.env.local`을 채웁니다.

```dotenv
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

그다음 스키마를 적용하고 앱을 실행합니다.

```bash
pnpm db:migrate
pnpm dev
```

앱은 [http://localhost:3000](http://localhost:3000), Supabase Studio는 [http://127.0.0.1:54323](http://127.0.0.1:54323)에서 열립니다.

## 기존 SQLite 데이터 이관

이관은 한 트랜잭션으로 실행됩니다. 실패하면 전체가 롤백되며, 성공 후에는 원본과 대상의 테이블별 건수 및 거래 참조 무결성을 검증합니다.

```bash
pnpm exec tsx scripts/run-migrate.ts /Users/leedj/workspace/Personal/finance/data/finance.db
pnpm exec tsx scripts/verify-migrate.ts /Users/leedj/workspace/Personal/finance/data/finance.db
```

로그인 계정을 이관된 가구에 연결하려면 먼저 `/login`에서 가입한 뒤 실행합니다.

```bash
pnpm exec tsx scripts/link-user.ts <email>
```

`SUPABASE_SERVICE_ROLE_KEY`는 이 로컬 관리 스크립트와 테스트에서만 사용합니다. 브라우저 코드나 Vercel 환경변수에는 넣지 않습니다.

## 검증

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm e2e
pnpm build
```

E2E는 로컬 Supabase와 `.env.local`이 필요하며, 테스트에서 만든 사용자는 종료 전에 삭제합니다. 실행 중인 `pnpm dev`와 `pnpm build`가 같은 `.next` 디렉터리를 동시에 쓰지 않도록 별도로 실행하세요.

## Supabase + Vercel 배포

배포 작업은 아래 순서를 지킵니다. 데이터 이관과 관리 명령에는 Supabase의 direct 연결 또는 session pooler(5432)를 사용하고, Vercel 런타임에는 transaction pooler(6543)를 사용합니다.

1. Supabase 프로젝트를 생성합니다.
2. 프로젝트의 session pooler URL로 스키마를 적용합니다.

   ```bash
   DATABASE_URL='<session-pooler-5432-url>' pnpm db:migrate
   ```

3. 같은 session pooler URL로 실데이터를 이관하고 검증합니다.

   ```bash
   DATABASE_URL='<session-pooler-5432-url>' pnpm exec tsx scripts/run-migrate.ts /Users/leedj/workspace/Personal/finance/data/finance.db
   DATABASE_URL='<session-pooler-5432-url>' pnpm exec tsx scripts/verify-migrate.ts /Users/leedj/workspace/Personal/finance/data/finance.db
   ```

4. Supabase Authentication에서 DJ/YJ 계정을 생성하고 이메일 확인을 완료한 뒤, 각 계정을 가구에 연결합니다.

   ```bash
   DATABASE_URL='<session-pooler-5432-url>' \
   NEXT_PUBLIC_SUPABASE_URL='<project-url>' \
   SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
   pnpm exec tsx scripts/link-user.ts '<email>'
   ```

5. Vercel 프로젝트에는 아래 세 변수만 설정합니다.

   - `DATABASE_URL`: transaction pooler URL(6543)
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key

6. Vercel에 배포한 후 `/` → `/login` 리다이렉트, DJ/YJ 로그인, `가구 연결됨` 표시를 확인합니다.

프로덕션 DB를 다시 이관하기 전에는 Supabase 백업 또는 별도 스냅샷을 먼저 확보해야 합니다. Drizzle의 서버 연결은 DB owner 권한으로 RLS를 우회하므로, 이후 작성하는 모든 서버 쿼리는 반드시 `household_id` 조건을 포함해야 합니다.

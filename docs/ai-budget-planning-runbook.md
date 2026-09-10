# AI 예산 추천 검증 및 배포 런북

이 문서는 통합 예산 화면과 AI 설정/예산 추천 기능의 로컬 검증 및 승인 후 운영 배포 순서를 분리한다. 문서에 적힌 운영 절차는 실행 승인이 난 뒤에만 수행한다. 현재 `0008_ai_diagnosis_settings.sql`과 `0009_budget_recommendations.sql`은 로컬 전용 상태이며, 이 문서는 운영 DB 반영이나 웹/워커 배포를 뜻하지 않는다.

## 안전 원칙

- 출력이나 기록에 DB URL 전체, anon/publishable key, service-role key, worker token, Codex 인증 정보, 보호된 설정 파일 내용 또는 비밀이 포함된 경로를 남기지 않는다.
- AI 진행률은 `queued`, `running`, `completed`, `failed`처럼 확인 가능한 상태만 기록하고 추정 백분율을 만들지 않는다.
- 기존 수동 예산과 내역 AI 진단을 배포 및 롤백 내내 사용할 수 있어야 한다. 추천 완료만으로 예산을 저장하지 않으며, 사용자가 선택하고 확인한 행만 기존 저장 경로로 반영한다.
- 설정이 포함된 작업의 불변 `prompt_input`, 완료 보고서, 저장된 추천 출처를 legacy 작업으로 변환하거나 삭제하지 않는다.
- 모델 smoke는 합성 스냅샷만 사용한다. 운영 큐/RPC/DB, 실제 가계 거래, worker token을 사용하지 않는다.

## 로컬 사전 확인

`supabase status`는 로컬 서비스 상태 확인용이다. 출력에는 키가 포함될 수 있으므로 원문을 복사하거나 보고서에 붙이지 말고, 실행 여부와 API/DB hostname만 남긴다.

```bash
supabase status
```

마이그레이션, DB 테스트, E2E 전에 `DATABASE_URL`과 `NEXT_PUBLIC_SUPABASE_URL`의 **hostname만** 확인한다. 허용값은 `localhost`, `127.0.0.1`, `::1`뿐이다. 하나라도 원격이거나 판별할 수 없으면 중단한다. URL 전체나 자격 증명은 출력하지 않는다. `.env.local`을 쓰는 일반 로컬 환경에서는 다음처럼 hostname만 출력할 수 있다.

```bash
node --env-file=.env.local -e 'for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) { const value = process.env[name]; console.log(`${name}_HOST=${value ? new URL(value).hostname : "unset"}`) }'
```

두 hostname이 loopback임을 확인한 뒤에만 로컬 마이그레이션을 적용한다.

```bash
pnpm db:migrate
```

보고할 때는 아래 값만 남긴다.

- Git commit: 전체 SHA
- DB/API: `local loopback` 또는 `aborted: remote/unset`
- Supabase: `running` 또는 `not running`
- 마이그레이션: `0008`, `0009` 적용 성공/실패
- 각 검증 명령: exit code, 테스트 수, 소요 시간, 실패 요약

## 로컬 최종 6개 게이트

아래 여섯 명령은 생략하거나 과거 결과로 대신하지 않고 최종 통합 상태에서 새로 실행한다. DB/E2E는 위 loopback 확인을 통과한 동일 로컬 Supabase를 사용한다. 실행 중인 `pnpm dev`와 `pnpm build`가 같은 `.next`를 동시에 쓰지 않게 한다.

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm test:db
pnpm build
pnpm e2e
```

원래 검토된 backend 수정 commit `29b3699`를 acceptance branch에 `5959a29f46f6c20355539f82c5238ecc124bbc53`로 cherry-pick한 뒤, Task 13 E2E와 문서 변경이 적용된 working tree에서 위 여섯 명령을 순서대로 한 번씩 실행했다. 이때 검증한 app/test 내용은 이후 `04a39ff1ad878df9f9f43ab2f842964a35a98dbf`로 변경 없이 commit됐다. warning suppression·retry·worker 수 override·instrumentation은 사용하지 않았다.

| 명령 | 최종 결과 |
| --- | --- |
| `pnpm lint` | exit 0, 5.51초 |
| `pnpm exec tsc --noEmit` | exit 0, 소요 시간 미보존 |
| `pnpm test` | 73 files / 654 tests 통과, 13.37초 |
| `pnpm test:db` | 39 files / 318 tests 통과, 소요 시간 미보존 |
| `pnpm build` | exit 0, 22 pages, tool wall 24.90초 (`next build` compile 5.3초) |
| `pnpm e2e` | 54/54 통과, 소요 시간 미보존 |

마지막 Playwright result는 `passed`와 빈 failed-test 목록을 기록했고 green 결과를 만들기 위한 재실행은 없었다. 실행 전에 DB/API hostname이 모두 loopback인지 다시 확인했다. 데스크톱, 390px 모바일, 다크 모드, month-close/statistics 스크린샷도 원본 크기로 직접 확인했으며 가로 넘침, 잘림, 불투명도 또는 가독성 결함을 발견하지 않았다.

검증 과정에서 확인된 두 저장 lifecycle 원인은 분리해서 수정·검토했다. backend는 전체 transaction을 SQLSTATE `40001`일 때만 최대 3회 재시도하고, 명시적 CAS·`23505`·`40P01`·기타 오류는 재시도하지 않는다. UI는 pending 상태를 요청 단위로 소유하고 단일 저장 action을 dedupe하며 활성 월 기준으로 결과 소유권을 제한한다. 두 수정 모두 별도 scoped review를 통과했다.

## 실제 CLI 어댑터 smoke

이 smoke는 보호된 기존 worker 설정을 loader로 읽되 실행 파일과 선택 모델만 runner에 전달한다. runner의 180초 기본 제한(300초 하드 상한), 읽기 전용 sandbox, 사용자 설정/규칙 무시, 도구·웹·MCP·스킬·플러그인·메모리 비활성화, 제한된 환경, 출력 크기/이벤트/JSON 검증을 그대로 사용한다.

먼저 기본 설정 파일이 읽기 가능한지만 확인하고 내용을 출력하지 않는다. 파일 또는 기존 CLI 인증을 사용할 수 없으면 별도 `not run` 또는 실패로 기록하며 로그인, 업데이트, 설정 수정을 이 검증에 섞지 않는다.

```bash
test -r "$HOME/.config/finance-web/diagnosis-worker.json"
pnpm exec tsx tests/smoke/budget-recommendation.ts
```

한 검증 회차에 실제 모델 호출은 한 번만 시도하며 자동 재시도하지 않는다. 성공 표식은 `budget_recommendation_smoke_passed`, 실패 표식은 `budget_recommendation_smoke_failed`뿐이다. 이 결과는 합성 자료의 live model 생성과 schema/근거 검증만 확인한다. 큐/RPC 완료, 저장, 충돌, stale 처리는 로컬 full-stack 테스트로 별도 검증해야 하며 결정적 fixture 테스트만으로 live model 생성을 증명할 수 없다.

이번 기능의 bounded smoke 이력은 이미 완료되었다. 최초 일반 smoke는 3.42초 뒤 exit 1과 `budget_recommendation_smoke_failed`만 남겼고, 통합 commit `83d7565`에서 승인된 단일 safe-code 진단은 4.19초 뒤 `cli_failed`로 분류됐다. Structured Outputs 참조 union을 `oneOf`에서 지원되는 `anyOf`로 바꾸되 strict parser는 유지한 수정이 `cb86ce7`에서 검토되었다. 수정 후 승인된 단 한 번의 합성 live 생성과 strict parsing은 26.73초에 통과했다. Task 13 인수를 위해 모델 호출을 반복하지 않으며, 로컬 큐/RPC/UI persistence는 별도 full-stack E2E로 증명한다.

## capability와 lease 확인

한 워커가 예산 protocol v1과 prompt protocol v1을 모두 지원하고, 두 capability heartbeat가 각각 최근 90초 안이어야 새 예산 추천을 `ready`로 판단한다. 서로 다른 워커의 capability를 합치지 않는다. 90초 capability freshness는 **새 작업을 안전하게 선점할 수 있는지**를 뜻한다.

작업을 선점하면 별도의 180초 lease가 생기고 처리 중 heartbeat로 갱신한다. 이는 이미 선점한 작업의 소유권/복구 경계다. 90초 capability 기준을 180초 lease와 동일한 값이나 동일한 상태로 해석하지 않는다. 단일 Mac 프로세스는 내역 진단과 예산 추천을 공정하게 번갈아 확인하되 동시에 두 lease를 보유하지 않아야 한다.

배포 검증에서는 비밀을 제외하고 다음만 기록한다.

- 같은 worker ID의 budget protocol v1 / prompt protocol v1
- 두 capability의 fresh/stale 판정과 관측 시각
- worker liveness와 실제 완료된 합성/승인된 검증 작업 상태
- legacy 내역 진단이 독립적으로 계속 enqueue/complete 되는지

worker 프로세스가 `running`이라는 사실만으로 준비 완료를 선언하지 않는다.

## 승인 후 운영 배포

아래 단계는 별도 운영 승인과 정확한 대상 확인 후 순서대로 진행한다. 각 단계의 증거가 없으면 다음 단계로 넘어가지 않는다.

1. **대상 고정과 복구점 확보**: 운영 Supabase project ref/hostname, Vercel project, 워커 checkout을 서로 대조한다. 복구 가능한 DB backup/snapshot을 만들고 복구 방법과 보존 위치를 확인한다.
2. **DB 확장**: owner/direct 또는 session-pooler(5432) 연결로 additive `0008`(AI settings), 이어서 `0009`(예산 큐, prompt 호환성, provenance)를 적용한다. 적용 전후 migration 상태만 기록하고 URL/키는 남기지 않는다.
3. **기존 Mac 워커 갱신**: 아래 기록표의 검증된 commit으로 기존 단일 워커를 갱신한다. 예산/prompt protocol v1 heartbeat, 90초 freshness, liveness, 내역 legacy/configured 처리, 예산 처리 능력을 확인한다. 지원되지 않는 configured 작업은 큐에서 기다리게 하며 `prompt_input`을 제거해 legacy로 낮추지 않는다.
4. **웹 배포**: DB와 호환 워커 확인 후 같은 검증 commit의 웹을 배포한다. Vercel 상태가 `Ready`가 될 때까지 기다리고 deployment ID를 기록한다.
5. **인증 UI 검증**: 실제 가구 계정으로 수동 예산 편집, AI 설정 조회/저장/실데이터 read-only preview, 예산 추천 생성/이전 결과 유지/근거 표시를 확인한다. 추천 완료 시 자동 저장되지 않는지 확인한 후 사용자가 선택한 추천만 가져와 명시적으로 저장하고 재접속 결과를 확인한다.
6. **호환성 확인**: 기존 내역 AI 진단이 독립적으로 enqueue/complete 되고, 수동 예산이 계속 저장되며, 워커가 동시에 두 lease를 잡지 않는지 확인한다.

운영 연결 예시는 승인 시 실제 값을 안전한 비밀 저장소에서 주입한다. 아래 placeholder는 실행 결과가 아니다.

```bash
DATABASE_URL='<verified-production-session-pooler-5432-url>' pnpm db:migrate
```

| 기록 항목 | 승인 후 실제 값 |
| --- | --- |
| 검증 commit | `<pending-verified-commit>` |
| DB backup/snapshot | `<pending-recoverable-backup-evidence>` |
| 적용 migrations | `<pending-0008-and-0009-outcome>` |
| worker version/checkout | `<pending-worker-version>` |
| capability/liveness | `<pending-budget-and-prompt-v1-evidence>` |
| Vercel deployment ID / 상태 | `<pending-deployment-id>` / `<pending-ready-status>` |
| 인증 UI 및 호환성 결과 | `<pending-validation-outcome>` |

## 롤백

문제가 웹 표시/저장 경로에 있으면 새 AI UI를 숨기거나 호환되는 이전 웹으로 되돌린다. 문제가 워커에 있으면 새 schema와 호환되는 검증 버전으로 워커를 되돌리거나 다시 연결한다. 웹/워커 어느 쪽이든 롤백 후 수동 예산과 legacy 내역 진단을 재확인한다.

`0008`/`0009`의 additive 테이블·열·RPC를 즉시 삭제하지 않는다. 대기/실행/완료 작업, 불변 `prompt_input`, 완료 보고서, 예산의 추천 provenance를 삭제하거나 재작성하지 않는다. 지원 워커가 없으면 configured 작업은 원형 그대로 기다리게 한다. 데이터 파괴나 마이그레이션 역행이 필요해 보이면 배포를 멈추고 별도 복구 승인을 받는다.

## 최종 인수 상태와 남은 운영 항목

- 최종 54/54 Playwright E2E는 실제 persistence/concurrency/stale/regeneration, manual-only/worker guidance, transport retry/idempotency, 단일 편집기, 모바일/다크/키보드, month-close/statistics browser 동작을 통과했다.
- 최종 unit/DB gate는 partial·missing·closed-zero snapshot 이력, 12월→1월 rollover, 수입 없음, 과거 월 조회와 client 늦은 응답 contract를 통과했다. 따라서 이 edge acceptance 묶음은 최종 여섯 게이트 전체에서 통과한 것이며 모두 Playwright 54건에 포함됐다는 뜻은 아니다.
- 데스크톱·390px 모바일·다크·month-close/statistics 스크린샷을 원본 크기로 확인했다.
- 로컬 상태 확인, 마이그레이션 이력, 최종 여섯 게이트, backend/UI scoped review가 완료됐다.
- 별도 승인이 있을 때만 운영 backup → DB → worker → web → 인증 UI 순서로 실행한다. 위 운영 기록표의 placeholder는 실제 증거가 생길 때까지 그대로 유지한다.

## 후속 검증 — 원래 요청 ID로 자동 복구

`87f8907` 이후 요청 ID 자동 복구 변경을 묶어서 구현한 뒤 최종 검증했다. GET의 선택적 `requestId`는 인증된 가구와 월 안에서만 원래 작업을 조회한다. 응답 유실 시 한 번 읽기 전용 조회하고, 같은 요청임이 확인되면 상태를 복구한다. 원래 요청을 확인하지 못하거나 구 서버 응답에 요청 ID가 없으면 기존 동일 UUID 재전송을 유지한다. DB 마이그레이션이나 자동 재실행은 추가하지 않았다.

- `pnpm lint`, `pnpm exec tsc --noEmit`: exit 0.
- `pnpm test`: 73파일 / 659개 통과.
- `pnpm test:db`: 39파일 / 318개 통과.
- 빌드: Playwright의 기존 `pnpm build && pnpm start --port 3101` 서버 기동 단계에서 통과. 별도 전체 빌드는 중복 실행하지 않았다.
- `pnpm e2e`: 53개 통과 / 1개 실패. 자동 복구 시나리오는 통과했다. 실패한 수동 저장 시나리오는 전월 거래 fixture 추가로 예산 상한이 낮아졌는데 초과 저장 동의가 누락되어 있었다. 애플리케이션의 차단은 정상이다.
- 테스트에 표시된 초과 저장 동의를 반영한 후 `pnpm exec playwright test tests/e2e/budget-recommendation-persistence.spec.ts --project=chromium --grep 'keeps manual saving available'`: 1개 통과 (27.8초, 테스트 본문 3.4초). 전체 54개를 재실행한 결과가 아니라, 기존 53개 통과와 수정한 1개 재검증 결과를 합친 인수 기록이다. 이 마지막 변경은 테스트의 동의 절차뿐이며 애플리케이션 코드는 전체 검증 때와 동일하다.

기존 Vite loader·Next workspace-root·색상 환경변수 경고는 남아 있으며 숨기지 않았다. 추가 리뷰·전체 검증 반복·운영 반영은 수행하지 않았다.

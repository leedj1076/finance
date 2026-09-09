# 월간 AI 진단과 Mac 연결

내역 탭은 **요약 → 목록 → AI 진단 → 카테고리 → 가맹점** 순서입니다. 보고서는 V1의 총평·변화·우리집 추세·확인 사항·다음 달 제안을 유지하고, 상단은 V2의 월급 − 지출 − 저축·투자 납입으로 구성했습니다.

## 동작

1. 로그인한 가족 구성원이 선택한 월의 `AI 진단하기`를 누릅니다.
2. 웹 서버가 이 가구의 전체 월 기록과 직전 3개월을 집계하고, 변경되지 않는 스냅샷과 작업을 Supabase에 저장합니다.
3. Mac 작업자가 외부로 Supabase에 접속해 자기 가구의 대기 작업 한 건을 가져옵니다. Mac에 포트를 열지 않습니다.
4. 작업자는 `codex exec`에 JSON 자료를 stdin으로 전달합니다. 기존 Codex 로그인으로 실행하며 진단용 OpenAI API 키는 필요하지 않습니다.
5. 형식·근거 ID·분류·출력 크기를 검사한 보고서를 저장합니다. 웹은 작업 중 5초 간격으로 상태를 조회합니다.

진단 후에도 다시 요청할 수 있습니다. 같은 월의 대기·실행 작업은 중복 생성하지 않으며 재진단 중이거나 실패해도 마지막 정상 보고서는 유지합니다. 원장·분류·예산이 달라지면 이전 보고서임을 표시합니다. Mac이 잠자기·전원 꺼짐·오프라인 상태이면 새 요청은 대기합니다.

CLI 실행 위치만 Mac입니다. 모델 처리는 연결된 OpenAI 서비스에서 이루어지고, ChatGPT/Codex 계정의 사용량·이용 제한이 적용됩니다. [공식 비대화형 실행 문서](https://developers.openai.com/codex/noninteractive), [인증 문서](https://developers.openai.com/codex/auth).

## 최초 연결

웹과 Mac 설정에 **같은 Supabase 프로젝트**를 사용해야 합니다. 프로젝트의 `.env.local`은 기본적으로 로컬 개발 DB를 가리킵니다. 운영에 연결할 때는 해당 프로젝트의 환경을 지정한 셸에서 아래 작업을 실행하세요. 등록 스크립트는 기존 환경 변수를 덮어쓰지 않습니다.

```sh
pnpm db:migrate
codex login status
pnpm diagnosis:setup --list
pnpm diagnosis:setup --household <우리집-UUID>
pnpm diagnosis:worker --once
pnpm diagnosis:worker
```

`codex login status`가 로그인되지 않았다고 하면 `codex login`으로 ChatGPT 로그인을 완료합니다. 웹 사용자 비밀번호를 작업자에 저장하지 않습니다.

등록에는 서버용 `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 사용합니다. 등록 후 작업자는 이 환경 파일을 읽지 않습니다. 기본 설정 파일은 `~/.config/finance-web/diagnosis-worker.json`이며 본인만 읽고 쓸 수 있는 `0600` 권한으로 생성합니다. 기존 파일은 덮어쓰지 않습니다.

설정 파일은 공개 Supabase 주소·anon/publishable 키, 가구 전용 연결 토큰, Codex 실행 경로만 담습니다. DB 비밀번호, Supabase 관리자 키, OpenAI API 키, 사용자 로그인 비밀번호는 포함하지 않습니다. 가구 연결 토큰 원문은 서버에 저장하지 않고 SHA256 해시만 저장합니다.

별도 환경은 파일을 나누어 사용합니다.

```sh
pnpm diagnosis:setup --household <우리집-UUID> --config /absolute/private/production-worker.json --codex /absolute/path/to/codex
pnpm diagnosis:worker --config /absolute/private/production-worker.json
```

선택적으로 등록 시 `--model <model-id>`를 지정할 수 있습니다. 생략하면 CLI의 기본 모델을 사용하며 개인 `config.toml`의 모델 설정은 읽지 않습니다. 계정에서 지원하는 모델을 사용하세요.

## Mac 로그인 후 자동 실행

수동 실행 확인 후 이 체크아웃을 유지할 위치에서 설치합니다. launchd는 설치 시의 Node·tsx·스크립트 절대 경로를 사용하므로 해당 폴더를 삭제하거나 옮기면 재설치가 필요합니다.

```sh
pnpm diagnosis:service install
pnpm diagnosis:service status
pnpm diagnosis:service uninstall
```

다른 설정 파일은 `install --config /absolute/private/production-worker.json`으로 지정합니다. 서비스는 `family.blissful.diagnosis-worker` 하나만 관리합니다. `KeepAlive`는 종료된 작업자를 다시 시작하는 설정이며 **Mac의 잠자기를 막지 않습니다**. 작업을 바로 처리하려면 Mac이 깨어 있어야 합니다.

로그는 `~/Library/Logs/finance-web/diagnosis-worker*.log`에 기록합니다. 상태와 작업 ID만 기록하며 프롬프트·보고서·토큰·상위 서비스 오류 본문은 기록하지 않습니다. 로그인 직후 네트워크가 없으면 연결될 때까지 재시도합니다.

## 연결 해제와 CLI 업데이트

등록 시 출력한 worker UUID로 해당 가구의 연결만 해제할 수 있습니다.

```sh
pnpm diagnosis:service uninstall
pnpm diagnosis:setup --household <우리집-UUID> --revoke <worker-UUID>
```

서비스 중지와 토큰 해제는 별개입니다. `uninstall`만으로 토큰을 지우거나 기존 보고서를 삭제하지 않습니다. 해제한 작업자의 실행 작업은 완료 권한을 잃고 임대 만료 후 실패 처리됩니다. 새 토큰은 새로운 `--config` 경로에 등록할 수 있습니다.

등록 시 Codex 실행 파일의 실제 경로를 저장해 검증한 바이너리를 사용합니다. CLI 업데이트로 이전 실행 파일이 없어졌다면 서비스를 중지하고 기존 연결을 해제한 뒤 새 경로로 등록·검증·설치하세요. 실행 옵션이 지원되지 않으면 안전 설정을 생략하지 않고 실패 처리합니다.

## 제한과 권한

- 웹 조회·요청은 로그인한 가구로 제한합니다. 브라우저는 작업 상태·결과를 직접 수정하거나 작업자 토큰 해시를 조회할 수 없습니다.
- 작업자 RPC는 토큰에 연결된 가구의 작업만 처리합니다. 작업 선점은 원자적이며 180초 임대, 30초 heartbeat, 완료 시 작업자·claim token·미만료 임대를 재검사합니다.
- Mac 연결이 끊기면 작업자 또는 웹 상태 조회가 만료된 작업을 실패 처리합니다. 자동 모델 재실행 대신 사용자가 다시 진단을 요청합니다.
- CLI 기본 제한 시간은 180초입니다. 실행 파일과 고정 인자를 사용하고 `shell:false`, 읽기 전용 sandbox, 사용자 설정·규칙·MCP·스킬·플러그인·실행 도구 비활성화를 적용합니다. 별도 임시 폴더와 제한된 환경 변수를 쓰며 작업 후 정리합니다.
- CLI의 정상 완료 이벤트와 최종 JSON을 모두 확인합니다. 도구 또는 알 수 없는 작업 이벤트가 나오면 중단합니다. 읽기 전용 sandbox 자체가 모든 파일 읽기를 금지하는 것은 아닙니다. 이 구조는 신뢰하는 개인 Mac의 가구 전용 분석용입니다.
- 전체 월 합계는 전체 거래로 계산합니다. 모델에 보내는 근거는 최대 300건이며 발췌 합계를 전체 합계로 사용하지 않습니다. 원본 행의 해시로 발췌 밖의 수정도 감지합니다.
- 다른 가구 평균·임의 저축 목표·비상 자금 개월 수를 만들지 않습니다. 대상 월이 진행 중이거나 비교 기록이 부족하면 그 한계를 표시합니다. 수입에서 남은 계산값은 실제 계좌 잔액·가용 현금과 다릅니다.

## 검증 명령

```sh
pnpm test
pnpm test:db tests/integration/diagnosis-queue.test.ts tests/integration/diagnosis-service.test.ts
pnpm exec playwright test tests/e2e/diagnosis.spec.ts --workers=1
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

진단의 DB·브라우저 테스트는 localhost Supabase만 허용하며 임시 가구를 삭제합니다. Worker 테스트는 가짜 실행 파일로 제한 시간·환경 분리·입출력·임대 상실·종료를 검증합니다. 실제 CLI 테스트는 별도 합성 자료로 진행하며 개인 원장을 자동 전송하지 않습니다.

운영에서 휴대폰으로 사용하려면 앱 배포, 같은 운영 DB의 `0005_diagnosis_queue` 마이그레이션, 그 가구로 등록한 Mac 작업자 실행이 모두 필요합니다.

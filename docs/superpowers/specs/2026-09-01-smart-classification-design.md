# 고정확도 반자동 분류 (Smart Classification) — Design Spec

승인일: 2026-09-01 (브레인스토밍 대화에서 사용자 승인)

## 배경과 목표

가계부의 결제 내역(뱅샐 export, 카드사 명세서)이 **반자동·고정확도로 분류**되게 한다. 사용자는 확실하지 않은 항목만 확인한다. 기존 rule-base(이력 서제스터 + 뱅샐 매핑)는 미지의 가맹점·지저분한 문자열에서 정확도가 떨어졌다.

**사용자 확정 요구사항:**
1. 소스 무관 — 뱅샐이든 카드 명세서든 같은 분류 품질. 카드사 명세서 업로드 채널 추가.
2. 전부 인박스 경유. **자동 반영은 없음** — 확신 항목은 접어서 원클릭 일괄승인, 애매한 것만 펼쳐서 확인.
3. 쿠팡·네이버페이처럼 결제 항목이 안 보이는 것들이 핵심 pain — 이런 건 물어봐 달라.

## 핵심 아키텍처: 자가 축적 머천트 DB + 좁은 AI 폴백

"DB냐 AI냐"는 대립이 아니라 순서다:

```
① 가구 이력/규칙(user-캐시 → 거래 이력)   — 반복 가맹점, 결정적, 무료
        ↓ miss
② 머천트 캐시(merchant_lookup)            — 과거 AI 결과·사용자 확정의 저장소
        ↓ miss
③ AI + 웹서치 폴백 (1회 배치 호출)         — 결과를 ②에 저장 → 가맹점당 평생 1회
        ↓ miss/실패
④ 뱅샐 카테고리 매핑(뱅샐 소스만) → 빈칸
   그리고 항상: ⑤ 사용자 확정 → ②에 source='user'로 저장 (최고 신뢰)
```

- **일관성 원칙**: 같은 가맹점은 매달 같은 분류로 — LLM 재분류 드리프트를 막기 위해 반복 가맹점은 캐시/이력이 결정적으로 처리하고, AI는 프런티어(미지 가맹점)에만 쓴다.
- **정직한 한계**: 애그리게이터(쿠팡·네이버페이 등)는 명세서에 구매 품목이 없어 어떤 기술로도 내용을 알 수 없다 → 항상 '확인 필요'(이력 최빈값 프리필). 유일한 예외는 정확금액 반복(구독).

## 데이터 모델

### 신규 테이블 `merchant_lookup` (가맹점 사전)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | bigint identity PK | |
| household_id | uuid NOT NULL → households | 가구 스코프 (RLS 대상) |
| norm_merchant | text NOT NULL | 정규화 키. unique(household_id, norm_merchant) |
| display_merchant | text | 마지막 본 원문 |
| business_type | text | "카페", "주유소" 등 — 근거 표시용 |
| category_id | bigint → categories | |
| flow | flow enum | |
| source | text CHECK ('user','ai') | **user가 ai를 항상 덮음, 역방향 금지** |
| confidence | text CHECK ('high','low') | AI가 자신 없으면 low |
| ai_note | text | AI 한 줄 근거 |
| always_confirm | boolean default false | 애그리게이터 플래그 — 켜지면 항상 '확인 필요' |
| hit_count int, last_used_at timestamptz | 사용 추적 |

- 사전 시드 없음. 애그리게이터 목록(쿠팡, 네이버페이, 카카오페이, 지마켓, 11번가, 옥션, 토스, 페이코)은 norm 매칭으로 `always_confirm=true` 자동 세팅.
- **category_rules 동결**: 학습만 되고 추천에 안 쓰이던 기존 테이블. 이 기능부터 학습·조회 모두 merchant_lookup로 일원화(두 저장소 분기 방지). category_rules는 읽기도 쓰기도 중단(테이블은 유지).

### `import_inbox` 확장

- `confidence` text CHECK ('high','review') NOT NULL DEFAULT 'review' — 스테이징 시 계산.
- `sug_source` 값 확장: 기존 'history'|'banksalad'에 **'user'(캐시)**, **'ai'** 추가.

## 확신도 판정 (assessConfidence)

**HIGH (접힘·일괄승인)** = 전부 충족:
- 출처가 user-캐시 **또는** 이력 norm-정확일치(단일 지배 분류). 토큰 매칭은 무조건 review(과거 오염 전례).
- alwaysConfirm 아님 · dupNote 없음 · kind='normal' · categoryId 존재.
- 애그리게이터 승격 예외: (normMerchant, 정확금액) 조합이 이력에 2회 이상 + 단일 분류 → high (구독 결제).

**REVIEW** = 나머지 전부 (AI 제안, 뱅샐 매핑만, 토큰 매칭, 빈칸, 애그리게이터, 중복의심, 이체후보).

## 카드사 명세서 파서

- 대상 5종 + 실측 파일 포맷 (구 Flask `card_import.py`가 명세, 실파일은 `finance/imports/`):
  - 삼성: 진짜 .xlsx — 헤더 `이용일 | 가맹점 | 이용금액` (fallback `원금`)
  - 현대: **.xls로 위장한 HTML 테이블** — `이용일 | 이용가맹점 | 이용금액` (fallback `결제원금`)
  - 신한: HTML(중첩 테이블) — `이용일 | 이용가맹점 | 이용금액`, `소계`에서 중단(뒤 섹션 오독 방지)
  - KB국민: **레거시 BIFF .xls** — `이용일 | 이용하신곳 | 이용금액` (fallback `청구원금`)
  - NH농협: .xlsx — `이용일자 | 이용가맹점 | 청구원금` (이용금액이 0인 export라 청구원금 사용)
- 공통 규칙: 헤더 행을 키워드(공백 무시)로 탐색, `합계/소계/없습니다`에서 중단, 날짜 없는 행·0원 이하 스킵.
- 구현: **SheetJS(`xlsx` 패키지)** 하나로 xlsx/BIFF/HTML 모두 읽음(내용 스니핑, 확장자 불신). 뱅샐은 기존 exceljs 유지.
- 업로드 UI에서 카드사·소유자(DJ/YJ) 선택(파일에 소유자 정보 없음).
- 지문: `sha1('card:'+issuer+'|'+owner+'|'+date+'|'+amount+'|'+merchant+'|'+occurrenceIdx)` — occurrenceIdx는 파일 내 동일(날짜·금액·가맹점) 행의 순번(같은 날 같은 가게 2번 결제 보존 + 재업로드 멱등).

## AI 폴백 (좁게)

- **대상**: user-캐시·이력·ai-캐시 모두 miss인 가맹점만(예상 월 5~15건). 업로드 서버 액션 내 **1회 배치 호출**.
- **모델/툴**: `claude-sonnet-5` + 서버 웹서치 툴 `web_search_20260209`(max_uses 제한). Haiku가 아닌 이유: 현행 웹서치 툴 변형이 Sonnet 5 이상에서 지원되고, 호출량이 적어 비용 차이가 무의미(월 수십 원 수준).
- **프롬프트 컨텍스트**: 가맹점명 목록(금액·날짜 미전송 — 프라이버시 최소화) + 가구의 분류체계 전체 + 가구의 확정 사례 몇 개. 출력: JSON 배열 `{merchant, businessType, major, sub, flow, confidence(high|low), note}`.
- **가드레일**: AI 결과는 ai-캐시(source='ai')에 저장되고 인박스에선 **항상 review**(확신으로 승격 불가). 분류체계에 없는 major/sub는 버림.
- **운영**: `ANTHROPIC_API_KEY` 서버 env. settings `ai_fallback_enabled`(기본 on) 토글. API 실패/키 없음 → 해당 행만 빈칸/review로 강등, 업로드는 성공.

## UI

- **인박스 2단**: 상단 "✓ 자동 분류됨 N건 · 합계" 접힘(펼쳐보기 가능, 행 클릭 시 review로 강등해 수정) + **[N건 일괄 승인]**. 하단 "확인 필요 M건" — 기존 폼 + 출처 배지(캐시/이력/AI/뱅샐) + AI 근거 툴팁(businessType·aiNote) + 애그리게이터 배지.
- **업로드**: 파일 내용 스니핑으로 뱅샐/카드 구분, 카드면 카드사+소유자 선택.
- **/manage "가맹점 사전" 탭**: merchant_lookup 목록 — 분류 수정, alwaysConfirm 토글, 삭제.

## 테스트 전략

- 파서: 포맷별 합성 픽스처(HTML 문자열, exceljs로 만든 xlsx, SheetJS로 만든 BIFF) 단위테스트. 실파일 검증은 로컬 수동(개인정보라 repo에 미포함).
- assessConfidence·머천트 캐시 우선순위: 순수함수/DB 유닛테스트.
- AI: 클라이언트 주입(mock) 테스트. 실호출 통합테스트는 없음(비용·비결정성).
- E2E 1개: 카드 합성파일 업로드 → 접힘/확인필요 분리 → 일괄승인 → 가계부 반영.

## 비목표 (Non-goals)

- 애그리게이터 내부 품목 식별(불가능 — 명세서에 정보 없음), 쿠팡/네이버 주문내역 연동, 전 항목 AI 분류(C안 기각), category_rules 마이그레이션(동결만), 자동 반영(사용자가 명시적으로 거부).

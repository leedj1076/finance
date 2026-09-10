# 예산 편집기 개편안 · 디자인 참고 자료

설계 문서: `docs/superpowers/specs/2026-09-11-budget-editor-redesign-design.md`

장면: 2026년 9월 27일, 다음 달(10월) 예산을 만드는 중. 지난달 실적은 진행 중인 9월의 27일까지 값, 3개월 평균은 끝난 6·7·8월, AI 추천은 14:02에 완료된 상태.

| 파일 | 내용 |
|---|---|
| `00-as-is-desktop-budgets.png` | 지금 화면(2026-09-10 캡처). 무엇이 사라지는지 비교용 |
| `01-desktop-editor.png` / `mockups/01-desktop-editor.html` | 데스크톱 1440. 헤더, 상한 줄, 출처 열 표 전체. 주거는 지난달 예산·실적 둘 다 선택 모양, 교통비는 3개월 평균, 식비는 AI 값을 고친 상태(보라 칸 + `AI 추천 650,000 → 조정`), 생활용품은 직접 입력(포커스) |
| `02-popovers.png` / `mockups/02-popovers.html` | 저축률 팝오버, 근거 팝오버, 추천 요약 팝오버 |
| `03-ai-request-dialog.png` / `mockups/03-ai-request-dialog.html` | AI 추천 요청 대화상자 |
| `04-states.png` / `mockups/04-states.html` | AI 열 머리 여섯 상태, 열 채우기 직후 한 줄, 손댄 행 확인 팝오버, 지난 세션 AI 값 캡션 |
| `05-mobile-390.png` / `mockups/05-mobile-390.html` | 모바일 390. 카드 + 칩, 묶음 채우기 메뉴 |

목업 HTML은 앱 토큰 값을 인라인 스타일로 그대로 씁니다(잉크 #18181b, 회색 #71717a/#a1a1aa, 헤어라인 #e4e4e7, 트랙 #f4f4f5, 파랑 #2563eb, 빨강 #dc2626, 초록 #16a34a, 주황 #d97706, 보라 #7c3aed, 컨트롤 34px, 모서리 0, IBM Plex Sans KR). 구현은 목업의 픽셀 값이 아니라 `src/app/globals.css`의 토큰과 `t-*` 타입 클래스를 쓰되, 간격·높이·정렬은 목업을 따릅니다.

캔버스(편집 가능, 로그인 필요): https://claude.ai/code/artifact/fcdc7a6a-70cd-4bab-be0d-9ebe49637d1a

# 예산 편집기 개편안 · 디자인 참고 자료

설계 문서: `docs/superpowers/specs/2026-09-11-budget-editor-redesign-design.md` (확정안 C2)

장면: 2026년 9월 27일, 다음 달(10월) 예산을 만드는 중. 지난달 실적은 진행 중인 9월의 27일까지 값, 3개월 평균은 끝난 6·7·8월, AI 추천은 14:02에 완료된 상태.

| 파일 | 내용 |
|---|---|
| `00-as-is-desktop-budgets.png` | 지금 화면(2026-09-10 캡처). 무엇이 사라지는지 비교용 |
| `01-desktop-editor.png` / `mockups/01-desktop-editor.html` | 데스크톱 1440 확정안. 헤더, 상한 줄, 도구 줄(전체 채우기 넷 + AI 상태), 항목·예산·참고 목록 전체. 주거·문화생활·여행·경조사는 지난달 예산 줄 선택, 교통비는 3개월 평균 줄, 건강은 AI 줄 선택, 식비는 AI 값을 고친 상태(`AI 추천 650,000에서 조정`), 생활용품은 직접 입력(포커스), 여행의 실적 0은 취소선 |
| `02-popovers.png` / `mockups/02-popovers.html` | 저축률 팝오버, 근거 팝오버(AI 근거 줄의 더 보기), 추천 요약 팝오버 |
| `03-ai-request-dialog.png` / `mockups/03-ai-request-dialog.html` | AI 추천 요청 대화상자 |
| `04-states.png` / `mockups/04-states.html` | AI 상태 여섯 가지, 전체 채우기 직후 한 줄, 손댄 행 확인 팝오버, 지난 세션 AI 값 캡션 |
| `05-mobile-390.png` / `mockups/05-mobile-390.html` | 모바일 390. 같은 목록 구조, 도구 줄의 `전체 채우기 ▾` 메뉴 |

목업 HTML은 앱 토큰 값을 인라인 스타일로 그대로 씁니다(잉크 #18181b, 회색 #71717a/#a1a1aa, 헤어라인 #e4e4e7, 트랙 #f4f4f5, 파랑 #2563eb, 빨강 #dc2626, 초록 #16a34a, 주황 #d97706, 보라 #7c3aed, 컨트롤 34px, 모서리 0, IBM Plex Sans KR). 구현은 목업의 픽셀 값이 아니라 `src/app/globals.css`의 토큰과 `t-*` 타입 클래스를 쓰되, 간격·높이·정렬은 목업을 따릅니다.

캔버스(편집 가능, 로그인 필요): https://claude.ai/code/artifact/fcdc7a6a-70cd-4bab-be0d-9ebe49637d1a · 1페이지가 확정안, 2페이지는 기각된 탐색안(A 출처 열 표, B 참고 목록 + 라디오, C1 타일).

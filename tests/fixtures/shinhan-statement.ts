// Synthetic values only. Mirrors Shinhan's HTML-as-XLS header structure,
// including billing subcolumns and benefit metadata on the charge table.
export const SHINHAN_STATEMENT_HTML = `<html><body>
  <table>
    <!-- 이용일자별 카드사용내역 -->
    <tr><th rowspan="2">이용일</th><th rowspan="2">이용카드</th><th rowspan="2">이용가맹점</th><th rowspan="2">이용금액</th><th rowspan="2">할부기간</th><th rowspan="2">회차</th><th colspan="2">이번달 납부금액</th><th rowspan="2">적용<br>구분</th><th rowspan="2">결제 후 잔액</th><th rowspan="2">포인트적립율(마이신한포인트)</th></tr>
    <tr><th>원금</th><th>수수료</th></tr>
    <tr><td>2026.08.03</td><td>본인100</td><td>신한형식 카페</td><td>6,500</td><td></td><td></td><td>6,500</td><td>0</td><td>할인</td><td>0</td><td>0.5%</td></tr>
    <tr><td>2026.08.05</td><td>본인100</td><td>신한형식 마트</td><td>20,000</td><td></td><td></td><td>19,000</td><td>0</td><td>할인</td><td>0</td><td>0.5%</td></tr>
    <tr><td>2026.08.06</td><td>본인100</td><td>신한형식 음수</td><td>-2,000</td><td></td><td></td><td>-2,000</td><td>0</td><td></td><td>0</td><td></td></tr>
    <tr><td colspan="3">일시불(일반) 소계</td><td>24,500</td></tr>
    <tr><td colspan="3">총합계</td><td>24,500</td></tr>
  </table>
  <table>
    <tr><th>이용일</th><th>이용카드</th><th>상품구분</th><th>이용가맹점</th><th>원거래금액</th><th>취소금액</th><th>취소일</th><th>처리일</th><th>처리결과</th></tr>
    <tr><td>2026.08.05</td><td>본인100</td><td>일시불</td><td>신한형식 마트</td><td>20,000</td><td>5,000</td><td>2026.08.07</td><td>2026.08.08</td><td>정상</td></tr>
  </table>
  <table>
    <tr><th>이용일</th><th>이용가맹점</th><th>적용구분</th><th>이용금액</th><th colspan="3">할인금액</th><th>할인내역</th></tr>
    <tr><td>2026.08.03</td><td>신한형식 카페</td><td>이용금액할인</td><td>6,500</td><td>0</td><td>650</td><td>0</td><td>카드 할인</td></tr>
    <tr><td>2026.08.05</td><td>신한형식 마트</td><td>이용금액할인</td><td>20,000</td><td>0</td><td>1,000</td><td>0</td><td>카드 할인</td></tr>
    <tr><td>합계</td><td>1,650</td></tr>
  </table>
  <table>
    <tr><th>이용일</th><th>이용카드</th><th>이용가맹점</th><th>이용금액</th><th>적립포인트</th></tr>
    <tr><td>2026.08.05</td><td>본인100</td><td>신한형식 포인트전용</td><td>20,000</td><td>500</td></tr>
  </table>
</body></html>`

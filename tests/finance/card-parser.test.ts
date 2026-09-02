import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { parseCardStatement } from '@/features/inbox/parsers/cards'

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }))
}

describe('card statement parsers', () => {
  it('reads the current KB header names and Excel date cells', () => {
    const buffer = workbookBuffer([
      ['KB국민카드 이용내역'],
      ['이용일자', '이용카드', '구분', '이용가맹점', '이용금액', '이번달 결제금액'],
      ['26.07.03', '국민카드', '일시불', '테스트 마트', 12_300, 12_300],
      ['26.07.04', '국민카드', '일시불', '테스트 카페', 4_500, 4_500],
      ['', '', '', '리볼빙이월금액 합계', 16_800, 16_800],
    ])

    expect(parseCardStatement(buffer, 'kookmin')).toEqual([
      { date: '2026-07-03', merchant: '테스트 마트', amount: 12_300, pay: '국민카드' },
      { date: '2026-07-04', merchant: '테스트 카페', amount: 4_500, pay: '국민카드' },
    ])
  })

  it('reads only the Shinhan card-use table before later benefit and cancellation sections', () => {
    const buffer = Buffer.from(`
      <html><body>
        <table>
          <tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>이번달 납부금액</td></tr>
          <tr><td>2026.07.03</td><td>본인200</td><td>테스트 병원</td><td>11,500</td><td>11,500</td></tr>
          <tr><td>2026.07.09</td><td>본인200</td><td>테스트 약국</td><td>4,900</td><td>4,900</td></tr>
          <tr><td>일시불(일반) 소계</td><td></td><td></td><td>16,400</td><td>16,400</td></tr>
        </table>
        <table>
          <tr><td>이용일</td><td>이용가맹점</td><td>적용구분</td><td>이용금액</td><td>할인금액</td></tr>
          <tr><td>2026.07.03</td><td>테스트 병원</td><td>이용금액할인</td><td>11,500</td><td>575</td></tr>
        </table>
        <table>
          <tr><td>이용일</td><td>이용카드</td><td>상품구분</td><td>이용가맹점</td><td>원거래금액</td><td>취소금액</td></tr>
          <tr><td>2026.07.10</td><td>본인200</td><td>일시불</td><td>취소된 거래</td><td>8,000</td><td>8,000</td></tr>
        </table>
      </body></html>
    `, 'utf8')

    expect(parseCardStatement(buffer, 'shinhan')).toEqual([
      { date: '2026-07-03', merchant: '테스트 병원', amount: 11_500, pay: '본인200' },
      { date: '2026-07-09', merchant: '테스트 약국', amount: 4_900, pay: '본인200' },
    ])
  })
})

import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { parseCardStatement } from '@/features/inbox/parsers/cards'
import { SHINHAN_STATEMENT_HTML } from '../fixtures/shinhan-statement'

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }))
}

describe('card statement parsers', () => {
  it('reads Shinhan billed charges with benefit metadata, but excludes benefit detail tables', () => {
    expect(parseCardStatement(Buffer.from(SHINHAN_STATEMENT_HTML), 'shinhan')).toEqual([
      { date: '2026-08-03', merchant: '신한형식 카페', amount: 6500, pay: '본인100' },
      { date: '2026-08-05', merchant: '신한형식 마트', amount: 20000, pay: '본인100' },
      { date: '2026-08-06', merchant: '신한형식 음수', amount: -2000, pay: '본인100' },
      { date: '2026-08-05', merchant: '신한형식 마트', amount: -5000, pay: '본인100' },
    ])
  })

  it.each(['적용 구분', '포인트적립율(마이신한포인트)', '포인트적립률'])('does not mistake the charge metadata %s for a benefit amount', (metadata) => {
    const buffer = workbookBuffer([
      ['이용일', '이용카드', '이용가맹점', '이용금액', metadata],
      ['2026.08.03', '본인100', '카드 이용', 6500, ''],
    ])
    expect(parseCardStatement(buffer, 'shinhan')).toEqual([
      { date: '2026-08-03', merchant: '카드 이용', amount: 6500, pay: '본인100' },
    ])
  })

  it('recognizes billed charges without a card column but keeps application-only benefit rows excluded', () => {
    const buffer = workbookBuffer([
      ['이용일', '이용가맹점', '이용금액', '이번달 납부금액', '적용 구분'],
      ['2026.08.03', '카드 이용', 6500, 6000, '할인'],
      ['이용일', '이용가맹점', '이용금액', '적용 구분'],
      ['2026.08.03', '혜택 중복', 6500, '할인'],
    ])
    expect(parseCardStatement(buffer, 'shinhan')).toEqual([
      { date: '2026-08-03', merchant: '카드 이용', amount: 6500, pay: null },
    ])
  })

  it.each(['포인트적립', '포인트적립(마이신한포인트)', '할인금액'])('excludes actual benefit amounts in %s even with a card column', (benefit) => {
    const buffer = workbookBuffer([
      ['이용일', '이용카드', '이용가맹점', '이용금액', benefit],
      ['2026.08.03', '본인100', '혜택 중복', 6500, 500],
    ])
    expect(parseCardStatement(buffer, 'shinhan')).toEqual([])
  })

  it('keeps a cancellation row as a negative charge and drops zero rows', () => {
    const buffer = workbookBuffer([
      ['KB국민카드 이용내역'],
      ['이용일자', '이용카드', '구분', '이용가맹점', '이용금액', '이번달 결제금액'],
      ['26.07.03', '국민카드', '일시불', '테스트 마트', 12_300, 12_300],
      ['26.07.05', '국민카드', '취소', '테스트 마트', -12_300, -12_300],
      ['26.07.06', '국민카드', '일시불', '무효 행', 0, 0],
    ])

    expect(parseCardStatement(buffer, 'kookmin')).toEqual([
      { date: '2026-07-03', merchant: '테스트 마트', amount: 12_300, pay: '국민카드' },
      { date: '2026-07-05', merchant: '테스트 마트', amount: -12_300, pay: '국민카드' },
    ])
  })

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

  it('includes the separate Shinhan cancellation table without importing benefits', () => {
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
      { date: '2026-07-10', merchant: '취소된 거래', amount: -8_000, pay: '본인200' },
    ])
  })

  it('uses the actual cancellation amount for partial refunds, including cancellation-only exports', () => {
    const buffer = workbookBuffer([
      ['이용일', '이용카드', '상품구분', '이용가맹점', '원거래금액', '취소금액'],
      ['2026.07.10', '본인200', '일시불', '부분 취소', 80_000, 8_000],
      ['2026.07.11', '본인200', '일시불', '이미 음수', 10_000, -2_000],
      ['2026.07.12', '본인200', '일시불', '취소 없음', 10_000, 0],
      ['2026.07.13', '본인200', '일시불', '취소금액 없음', 10_000, ''],
    ])

    expect(parseCardStatement(buffer, 'shinhan')).toEqual([
      { date: '2026-07-10', merchant: '부분 취소', amount: -8_000, pay: '본인200' },
      { date: '2026-07-11', merchant: '이미 음수', amount: -2_000, pay: '본인200' },
    ])
  })

  it('does not treat a benefit table as charges when there are no card-use rows', () => {
    const buffer = workbookBuffer([
      ['이용일', '이용가맹점', '적용구분', '이용금액', '할인금액'],
      ['2026.07.03', '테스트 병원', '이용금액할인', 11_500, 575],
      ['이용일', '이용카드', '상품구분', '이용가맹점', '원거래금액', '취소금액'],
      ['2026.07.10', '본인200', '일시불', '취소된 거래', 8_000, 8_000],
    ])
    expect(parseCardStatement(buffer, 'shinhan')).toEqual([
      { date: '2026-07-10', merchant: '취소된 거래', amount: -8_000, pay: '본인200' },
    ])
  })
})

import { expect, test } from 'vitest'
import * as XLSX from 'xlsx'

import {
  cardFingerprint,
  cardSourceFromPay,
  looksLikeBanksalad,
  parseCardStatement,
} from '@/features/inbox/parsers/cards'

function workbookBuffer(rows: (string | number)[][], bookType: 'xlsx' | 'xls' = 'xlsx') {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return XLSX.write(workbook, { type: 'buffer', bookType }) as Buffer
}

const HYUNDAI_HTML = Buffer.from(`
<html><body><table>
<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>결제원금</td></tr>
<tr><td>2026.08.03</td><td>카드</td><td>스타벅스 강남점</td><td>6,500</td><td>6,500</td></tr>
<tr><td>2026.08.05</td><td>카드</td><td>GS25 역삼점</td><td>3,200</td><td>3,200</td></tr>
<tr><td>합계</td><td></td><td></td><td>9,700</td><td>9,700</td></tr>
<tr><td>2026.08.09</td><td>취소</td><td>뒤섹션은무시</td><td>1,000</td><td>1,000</td></tr>
</table></body></html>`, 'utf8')

test('hyundai: HTML-as-XLS parsed and stops at total', () => {
  expect(parseCardStatement(HYUNDAI_HTML, 'hyundai')).toEqual([
    { date: '2026-08-03', merchant: '스타벅스 강남점', amount: 6500 },
    { date: '2026-08-05', merchant: 'GS25 역삼점', amount: 3200 },
  ])
})

test('samsung: XLSX with usage date, merchant, and amount', () => {
  const buffer = workbookBuffer([
    ['삼성카드 이용내역'],
    ['이용일', '이용구분', '가맹점', '이용금액', '원금'],
    ['2026-08-01', '일시불', '쿠팡', '34,500', '34,500'],
    ['2026-08-02', '일시불', '올리브영', 12000, 12000],
    ['합계', '', '', '46,500', ''],
  ])
  expect(parseCardStatement(buffer, 'samsung')).toEqual([
    { date: '2026-08-01', merchant: '쿠팡', amount: 34500 },
    { date: '2026-08-02', merchant: '올리브영', amount: 12000 },
  ])
})

test('kookmin: legacy BIFF XLS with merchant header', () => {
  const buffer = workbookBuffer([
    ['이용일', '이용카드', '이용하신곳', '결제방법', '이용금액', '청구원금'],
    ['20260810', 'KB카드', '이마트 용산점', '일시불', '85,930', '85,930'],
    ['합계', '', '', '', '85,930', ''],
  ], 'xls')
  expect(parseCardStatement(buffer, 'kookmin')).toEqual([
    { date: '2026-08-10', merchant: '이마트 용산점', amount: 85930 },
  ])
})

test('shinhan: HTML parser stops before later discount section', () => {
  const buffer = Buffer.from(`
  <html><body><table>
  <tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td></tr>
  <tr><td>2026.08.11</td><td>신한카드</td><td>서울식당</td><td>21,000</td></tr>
  <tr><td>소계</td><td></td><td></td><td>21,000</td></tr>
  <tr><td>2026.08.11</td><td>할인</td><td>무시할가맹점</td><td>1,000</td></tr>
  </table></body></html>`, 'utf8')
  expect(parseCardStatement(buffer, 'shinhan')).toEqual([
    { date: '2026-08-11', merchant: '서울식당', amount: 21000 },
  ])
})

test('nonghyup: billed principal is used when usage amount is zero', () => {
  const buffer = workbookBuffer([
    ['이용일자', '이용카드', '이용가맹점', '이용금액', '청구원금'],
    ['2026년 08월 12일', 'NH카드', '늘편한약국', 0, '4,000'],
    ['합계', '', '', '', '4,000'],
  ])
  expect(parseCardStatement(buffer, 'nonghyup')).toEqual([
    { date: '2026-08-12', merchant: '늘편한약국', amount: 4000 },
  ])
})

test('fingerprint preserves same-row occurrences and remains deterministic', () => {
  const row = { date: '2026-08-03', merchant: '스타벅스', amount: 6500 }
  const first = cardFingerprint('hyundai', 'DJ', row, 0)
  expect(first).not.toBe(cardFingerprint('hyundai', 'DJ', row, 1))
  expect(cardFingerprint('hyundai', 'DJ', row, 0)).toBe(first)
  expect(first).toMatch(/^[0-9a-f]{40}$/)
})

test('generic issuer label recognizes the transaction source', () => {
  expect(cardSourceFromPay('현대카드')).toBe('card:hyundai')
  expect(cardSourceFromPay('네이버 현대카드')).toBeNull()
  expect(cardSourceFromPay(null)).toBeNull()
})

test('BankSalad workbook is recognized by its sheet name', () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['날짜']]), '가계부 내역')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  expect(looksLikeBanksalad(buffer)).toBe(true)
  expect(looksLikeBanksalad(HYUNDAI_HTML)).toBe(false)
})

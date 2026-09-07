import ExcelJS from 'exceljs'
import { describe, expect, test } from 'vitest'

import { parseBanksaladStatus } from '@/features/inbox/banksalad'

function statusSheet(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('뱅샐현황')
  sheet.addRow([null, '이름'])
  sheet.addRow([null, '이동재'])
  for (const row of rows) sheet.addRow(row)
  return sheet
}

describe('Banksalad status sheet', () => {
  test('reads balances and loans', () => {
    const parsed = parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, null, '급여통장', null, 1_200_000],
      [null, '저축성 자산'],
      [null, null, '주택청약', null, 4_000_000],
      [null, null, '자유적금', null, 500_000],
      [null, '투자성 자산'],
      [null, null, '연금저축', null, 2_000_000],
      [null, '6.대출현황'],
      [null, '대출종류'],
      [null, '주택', '전세자금', '전세자금대출', null, null, 90_000_000, '3.1'],
    ]))

    expect(parsed.owner).toBe('DJ')
    expect(parsed.assets).toEqual([
      { group: '현금', label: 'DJ 예금(뱅샐)', amount: 1_200_000 },
      { group: '저축·투자', label: 'DJ 청약', amount: 4_000_000 },
      { group: '저축·투자', label: 'DJ 적금(뱅샐)', amount: 500_000 },
      { group: '저축·투자', label: 'DJ 주식(키움)', amount: 2_000_000 },
    ])
    expect(parsed.loans).toMatchObject([{ label: '전세자금대출', balance: 90_000_000 }])
  })

  test('reports a drained account as zero instead of leaving last month standing', () => {
    const parsed = parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, null, '급여통장', null, 0],
      [null, '저축성 자산'],
      [null, null, '자유적금', null, 0],
      [null, '6.대출현황'],
      [null, '주택', '전세자금', '전세자금대출', null, null, 0, '3.1'],
    ]))

    expect(parsed.assets).toEqual([
      { group: '현금', label: 'DJ 예금(뱅샐)', amount: 0 },
      { group: '저축·투자', label: 'DJ 적금(뱅샐)', amount: 0 },
    ])
    expect(parsed.loans).toMatchObject([{ label: '전세자금대출', balance: 0 }])
  })

  test('stays silent about groups the file never mentions', () => {
    const parsed = parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, null, '급여통장', null, 300_000],
      [null, '6.대출현황'],
    ]))

    expect(parsed.assets).toEqual([
      { group: '현금', label: 'DJ 예금(뱅샐)', amount: 300_000 },
    ])
    expect(parsed.loans).toEqual([])
  })

  test('skips a blank balance cell so it cannot erase a real one', () => {
    const parsed = parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '저축성 자산'],
      [null, null, '자유적금', null, null],
      [null, '6.대출현황'],
      [null, '주택', '전세자금', '전세자금대출', null, null, null, '3.1'],
    ]))

    expect(parsed.assets).toEqual([])
    expect(parsed.loans).toEqual([])
  })

  test.each([null, '', '   ', '조회 불가'])('does not zero deposit or investment groups with unreadable balances (%s)', (balance) => {
    const parsed = parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, null, '급여통장', null, balance],
      [null, '투자성 자산'],
      [null, null, '증권계좌', null, balance],
    ]))

    expect(parsed.assets).toEqual([])
  })

  test('requires a balance even when the file contains only group headings', () => {
    expect(parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, '전자금융 자산'],
      [null, '현금 자산'],
      [null, '투자성 자산'],
    ])).assets).toEqual([])
  })

  test('keeps explicit zero on both group and product rows', () => {
    expect(parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산', null, null, '0'],
      [null, '투자성 자산'],
      [null, null, '증권계좌', null, 0],
    ])).assets).toEqual([
      { group: '현금', label: 'DJ 예금(뱅샐)', amount: 0 },
      { group: '저축·투자', label: 'DJ 주식(키움)', amount: 0 },
    ])
  })

  test.each([0, 50_000])('does not replace complete snapshots with partial aggregates (%s known)', (known) => {
    expect(parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산'],
      [null, null, '연동 실패 통장', null, '조회 불가'],
      [null, null, '정상 통장', null, known],
      [null, '저축성 자산'],
      [null, null, '주택청약 A', null, null],
      [null, null, '주택청약 B', null, known],
      [null, null, '적금 A', null, '조회 불가'],
      [null, null, '적금 B', null, known],
      [null, '투자성 자산'],
      [null, null, '연동 실패 증권', null, null],
      [null, null, '정상 증권', null, known],
    ])).assets).toEqual([])
  })

  test('suppresses only incomplete aggregates, including products on group heading rows', () => {
    expect(parseBanksaladStatus(statusSheet([
      [null, '3.재무현황'],
      [null, '자유입출금 자산', '미연동 통장', null, null],
      [null, null, '정상 통장', null, 0],
      [null, '저축성 자산', '주택청약 A', null, null],
      [null, null, '주택청약 B', null, 0],
      [null, null, '정상 적금', null, 50_000],
      [null, '투자성 자산'],
      [null, null, '정상 증권', null, 0],
    ])).assets).toEqual([
      { group: '저축·투자', label: 'DJ 적금(뱅샐)', amount: 50_000 },
      { group: '저축·투자', label: 'DJ 주식(키움)', amount: 0 },
    ])
  })
})

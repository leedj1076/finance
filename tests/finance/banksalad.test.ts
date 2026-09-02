import ExcelJS from 'exceljs'
import { describe, expect, test } from 'vitest'

import {
  banksaladFingerprint,
  buildHistorySuggester,
  classifyBanksaladRow,
  duplicateMerchantSimilar,
  parseBanksaladWorkbook,
  type BanksaladRow,
} from '@/features/inbox/banksalad'

const baseRow: BanksaladRow = {
  date: '2026-06-11',
  time: null,
  typ: '지출',
  cat1: '식비',
  cat2: '외식',
  merchant: '동네식당',
  amount: -12000,
  currency: 'KRW',
  pay: null,
  memo: null,
}

describe('Banksalad classification', () => {
  test('maps ordinary expenses and excludes card payments', () => {
    expect(classifyBanksaladRow(baseRow)).toMatchObject({ action: 'expense', suggestMajor: '식비' })
    expect(
      classifyBanksaladRow({ ...baseRow, cat1: '금융', cat2: '카드' }),
    ).toMatchObject({ action: 'exclude', reason: '카드대금 이중계상' })
  })

  test('recognizes savings and external transfer candidates', () => {
    expect(
      classifyBanksaladRow({ ...baseRow, typ: '이체', cat1: '투자', cat2: null }),
    ).toMatchObject({ action: 'saving' })
    expect(
      classifyBanksaladRow({ ...baseRow, typ: '이체', cat1: '이체', merchant: '친구 김철수' }),
    ).toMatchObject({ action: 'transfer_candidate', suggestMajor: '경조사' })
  })

  test('keeps the legacy SHA-1 fingerprint format including Python None', () => {
    expect(banksaladFingerprint('DJ', baseRow)).toBe('3706922b59990c8531c5ad677a28e52668ec65cc')
  })
})

describe('Banksalad workbook parsing', () => {
  test('detects owner, reads ledger rows and skips foreign currency', async () => {
    const workbook = new ExcelJS.Workbook()
    const status = workbook.addWorksheet('뱅샐현황')
    status.addRow(['', '이름'])
    status.addRow(['', '이동재'])
    const ledger = workbook.addWorksheet('가계부 내역')
    ledger.addRow(['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '통화', '결제수단', '메모'])
    ledger.addRow([
      new Date(Date.UTC(2026, 5, 11)),
      new Date(Date.UTC(1899, 11, 30, 14, 5, 6)),
      '지출',
      '식비',
      '외식',
      '동네식당',
      -12000,
      'KRW',
      '쿠팡 와우 카드',
      null,
    ])
    ledger.addRow([new Date(Date.UTC(2026, 5, 12)), null, '지출', '여행', '', '해외', -20, 'USD'])

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const parsed = await parseBanksaladWorkbook(buffer)

    expect(parsed.owner).toBe('DJ')
    expect(parsed.skippedForeignCurrency).toBe(1)
    expect(parsed.rows).toEqual([
      {
        date: '2026-06-11',
        time: '14:05:06',
        typ: '지출',
        cat1: '식비',
        cat2: '외식',
        merchant: '동네식당',
        amount: -12000,
        currency: 'KRW',
        pay: '쿠팡 와우 카드',
        memo: null,
      },
    ])
  })
})

describe('recommendation and duplicate matching', () => {
  test('uses history majority but ignores generic payment-provider tokens', () => {
    const suggest = buildHistorySuggester([
      { flow: 'expense', fixed: false, major: '식비', sub: '외식', merchant: '스타벅스 강남1점', date: '2026-05-01' },
      { flow: 'expense', fixed: false, major: '식비', sub: '외식', merchant: '스타벅스 강남2점', date: '2026-05-02' },
      { flow: 'expense', fixed: false, major: '교통비', sub: '주차', merchant: '주식회사 A', date: '2026-05-03' },
      { flow: 'expense', fixed: false, major: '생활용품', sub: '기타', merchant: '주식회사 B', date: '2026-05-04' },
    ])

    expect(suggest('스타벅스 강남1점')).toMatchObject({
      major: '식비',
      sub: '외식',
      matched: 'norm',
    })
    expect(suggest('스타벅스 서초점')).toMatchObject({
      major: '식비',
      sub: '외식',
      matched: 'token',
    })
    expect(suggest('주식회사 C')).toBeNull()
  })

  test('matches normalized merchant names for cross-source duplicate warnings', () => {
    expect(duplicateMerchantSimilar('스타벅스 강남1점', '스타벅스강남점')).toBe(true)
    expect(duplicateMerchantSimilar('스타벅스', '이마트')).toBe(false)
  })
})

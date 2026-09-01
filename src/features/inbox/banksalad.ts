import { createHash } from 'node:crypto'

import ExcelJS from 'exceljs'

export type BanksaladOwner = 'DJ' | 'YJ'
export type TransactionFlow = 'expense' | 'income' | 'saving'

export type BanksaladRow = {
  date: string
  time: string | null
  typ: string | null
  cat1: string | null
  cat2: string | null
  merchant: string
  amount: number
  currency: string | null
  pay: string | null
  memo: string | null
}

export type ParsedBanksaladFile = {
  owner: BanksaladOwner
  rows: BanksaladRow[]
  skippedForeignCurrency: number
}

export type Classification = {
  action: TransactionFlow | 'exclude' | 'transfer_candidate'
  reason: string
  suggestMajor: string | null
}

export type HistoryRow = {
  flow: TransactionFlow
  fixed: boolean
  major: string
  sub: string
  merchant: string
  date: string
}

export type HistorySuggestion = Pick<HistoryRow, 'flow' | 'fixed' | 'major' | 'sub'>

const OWNER_MAP: Record<string, BanksaladOwner> = {
  이동재: 'DJ',
  김유진: 'YJ',
}

const EXPENSE_CATEGORY_MAP: Record<string, string> = {
  식비: '식비',
  '카페/간식': '식비',
  '술/유흥': '친목',
  생활: '생활용품',
  온라인쇼핑: '생활용품',
  '패션/쇼핑': '꾸밈비',
  '뷰티/미용': '꾸밈비',
  자동차: '교통비',
  교통: '교통비',
  '의료/건강': '건강',
  '교육/학습': '자기계발',
  '자녀/육아': '자녀',
  '여행/숙박': '여행',
  '문화/여가': '문화생활',
  '경조/선물': '경조사',
  기타: '기타',
  '주거/통신': '주거',
}

const INCOME_CATEGORY_MAP: Record<string, string> = {
  급여: '월급',
  금융수입: '기타수입',
  용돈: '기타수입',
  기타수입: '기타수입',
}

const INTERNAL_TRANSFER_SUBCATEGORIES = new Set(['내계좌이체', '카드대금'])
const INTERNAL_NAMES = ['이동재', '김유진', '농협이동재']
const INCOME_TRANSFER_PATTERN = /월급|급여|상여|연말정산|휴직급여/

const GENERIC_TOKENS = new Set([
  '주식회사',
  '주',
  '유한회사',
  '네이버페이',
  '카카오페이',
  '카카오',
  '네이버',
  'kcp',
  'nice',
  '페이코',
  'payco',
  '토스',
  '비씨',
  '스마트로',
  'kis',
  'kakaopay',
  'naverpay',
  'tosspay',
  '다날',
  '결제',
  '충전',
])

function pad(value: number) {
  return value.toString().padStart(2, '0')
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86_400_000))
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }

  const match = cellText(value).match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`
}

function formatTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const seconds = Math.round((value % 1) * 86_400) % 86_400
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
  }
  const text = cellText(value)
  const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  return match ? `${pad(Number(match[1]))}:${match[2]}:${match[3] ?? '00'}` : text.slice(0, 8)
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim()
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const candidate = value as {
      result?: unknown
      text?: unknown
      hyperlink?: unknown
      richText?: Array<{ text?: unknown }>
    }
    if (candidate.result !== undefined) return cellText(candidate.result)
    if (candidate.text !== undefined) return cellText(candidate.text)
    if (candidate.richText) return candidate.richText.map((part) => cellText(part.text)).join('').trim()
  }
  return String(value).trim()
}

function toInteger(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  const parsed = Number(cellText(value).replaceAll(',', ''))
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function optionalText(value: unknown): string | null {
  const text = cellText(value)
  return text ? text : null
}

export async function parseBanksaladWorkbook(buffer: Buffer): Promise<ParsedBanksaladFile> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer)

  const ledger = workbook.getWorksheet('가계부 내역')
  if (!ledger) throw new Error("'가계부 내역' 시트가 없는 파일입니다.")

  const status = workbook.getWorksheet('뱅샐현황')
  if (!status) throw new Error("'뱅샐현황' 시트가 없는 파일입니다.")

  let owner: BanksaladOwner | null = null
  status.eachRow((row) => {
    if (owner) return
    row.eachCell((cell) => {
      const mapped = OWNER_MAP[cellText(cell.value)]
      if (mapped) owner = mapped
    })
  })
  if (!owner) throw new Error('파일에서 이동재 또는 김유진 사용자 정보를 찾지 못했습니다.')

  const rows: BanksaladRow[] = []
  let skippedForeignCurrency = 0
  ledger.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const date = formatDate(row.getCell(1).value)
    if (!date) return

    const currency = optionalText(row.getCell(8).value)
    if (currency !== 'KRW') {
      skippedForeignCurrency += 1
      return
    }

    rows.push({
      date,
      time: formatTime(row.getCell(2).value),
      typ: optionalText(row.getCell(3).value),
      cat1: optionalText(row.getCell(4).value),
      cat2: optionalText(row.getCell(5).value),
      merchant: cellText(row.getCell(6).value),
      amount: toInteger(row.getCell(7).value),
      currency,
      pay: optionalText(row.getCell(9).value),
      memo: optionalText(row.getCell(10).value),
    })
  })

  if (rows.length > 10_000) throw new Error('한 파일에서 최대 10,000건까지만 가져올 수 있습니다.')
  return { owner, rows, skippedForeignCurrency }
}

function pythonString(value: string | number | null | undefined) {
  return value === null || value === undefined ? 'None' : String(value)
}

/** Keep byte-for-byte parity with the legacy Flask importer. */
export function banksaladFingerprint(owner: BanksaladOwner, row: BanksaladRow) {
  const raw = [owner, row.date, row.time, row.amount, row.merchant, row.pay]
    .map(pythonString)
    .join('|')
  return createHash('sha1').update(raw, 'utf8').digest('hex')
}

export function classifyBanksaladRow(row: BanksaladRow): Classification {
  const typ = row.typ ?? ''
  const cat1 = row.cat1 ?? ''
  const cat2 = row.cat2 ?? ''
  const merchant = row.merchant

  if (typ === '지출') {
    if (cat1 === '금융') {
      if (cat2 === '카드') return { action: 'exclude', reason: '카드대금 이중계상', suggestMajor: null }
      if (cat2 === '증권/투자') {
        return { action: 'exclude', reason: '저축 납입 — 반복거래가 관리', suggestMajor: null }
      }
      if (cat2 === '이자/대출') return { action: 'expense', reason: '대출이자', suggestMajor: '주거' }
      if (cat2 === '보험') return { action: 'expense', reason: '보험료', suggestMajor: '보험' }
      return { action: 'expense', reason: '금융 기타', suggestMajor: '기타' }
    }

    if (cat1 === '주거/통신') {
      if (['통신', '인터넷', '휴대폰'].some((keyword) => cat2.includes(keyword))) {
        return { action: 'expense', reason: '통신비', suggestMajor: '통신비' }
      }
      return { action: 'expense', reason: '주거', suggestMajor: '주거' }
    }

    return {
      action: 'expense',
      reason: `대분류 매핑: ${cat1}`,
      suggestMajor: EXPENSE_CATEGORY_MAP[cat1] ?? '기타',
    }
  }

  if (typ === '수입') {
    if (merchant.includes('상여')) return { action: 'income', reason: '상여 (내용 포함)', suggestMajor: '상여' }
    return {
      action: 'income',
      reason: `수입 대분류: ${cat1}`,
      suggestMajor: INCOME_CATEGORY_MAP[cat1] ?? '기타수입',
    }
  }

  if (typ === '이체') {
    if (INTERNAL_TRANSFER_SUBCATEGORIES.has(cat2) || INTERNAL_NAMES.some((name) => merchant.includes(name))) {
      return { action: 'exclude', reason: '내부 이체', suggestMajor: null }
    }
    if (cat1 === '투자' || cat2 === '저축') {
      return { action: 'saving', reason: '투자·저축 이체', suggestMajor: '저축_투자' }
    }
    if (INCOME_TRANSFER_PATTERN.test(merchant) && row.amount > 0) {
      return {
        action: 'transfer_candidate',
        reason: '수입 후보 (급여/상여류 이체)',
        suggestMajor: merchant.includes('상여') ? '상여' : '월급',
      }
    }
    if (row.amount < 0) {
      return { action: 'transfer_candidate', reason: '지출 후보 (외부 대상 이체)', suggestMajor: '경조사' }
    }
    return { action: 'exclude', reason: '이체 — 내부 또는 미분류', suggestMajor: null }
  }

  return { action: 'exclude', reason: `알 수 없는 타입: ${typ}`, suggestMajor: null }
}

export function normalizeMerchant(value: string) {
  return value.replace(/[\s\d]+/g, '').toLowerCase()
}

function merchantToken(value: string) {
  return value.trim().match(/^[0-9A-Za-z가-힣]+/)?.[0].toLowerCase() ?? ''
}

function bareToken(value: string) {
  return ['주식회사', '(주)', '㈜', '유한회사', '(유)'].reduce(
    (result, marker) => result.replaceAll(marker, ''),
    value,
  )
}

type TallyValue = { suggestion: HistorySuggestion; count: number; last: string }

function pickWinner(values: Map<string, TallyValue>) {
  return [...values.values()].sort(
    (left, right) => right.count - left.count || right.last.localeCompare(left.last),
  )[0]
}

export function buildHistorySuggester(rows: HistoryRow[]) {
  const normTallies = new Map<string, Map<string, TallyValue>>()
  const tokenTallies = new Map<string, Map<string, TallyValue>>()

  const tally = (target: Map<string, Map<string, TallyValue>>, key: string, row: HistoryRow) => {
    if (!key) return
    const values = target.get(key) ?? new Map<string, TallyValue>()
    const categoryKey = `${row.flow}|${row.fixed ? 1 : 0}|${row.major}|${row.sub}`
    const previous = values.get(categoryKey)
    values.set(categoryKey, {
      suggestion: { flow: row.flow, fixed: row.fixed, major: row.major, sub: row.sub },
      count: (previous?.count ?? 0) + 1,
      last: previous?.last && previous.last > row.date ? previous.last : row.date,
    })
    target.set(key, values)
  }

  for (const row of rows) {
    tally(normTallies, normalizeMerchant(row.merchant), row)
    tally(tokenTallies, merchantToken(row.merchant), row)
  }

  const byNorm = new Map<string, HistorySuggestion>()
  for (const [key, values] of normTallies) {
    if (GENERIC_TOKENS.has(bareToken(key))) continue
    byNorm.set(key, pickWinner(values).suggestion)
  }

  const byToken = new Map<string, HistorySuggestion>()
  for (const [key, values] of tokenTallies) {
    if (key.length < 2 || GENERIC_TOKENS.has(bareToken(key))) continue
    const winner = pickWinner(values)
    const total = [...values.values()].reduce((sum, value) => sum + value.count, 0)
    if (total >= 2 && winner.count / total >= 0.66) byToken.set(key, winner.suggestion)
  }

  return (merchant: string) =>
    byNorm.get(normalizeMerchant(merchant)) ?? byToken.get(merchantToken(merchant)) ?? null
}

export function duplicateMerchantSimilar(left: string | null, right: string | null) {
  const normalize = (value: string | null) =>
    (value ?? '').replace(/[\s\d()\-_./]+/g, '').toLowerCase()
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return false
  return a === b || (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a)))
}

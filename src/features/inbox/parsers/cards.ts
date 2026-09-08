import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'

import { decodeStatementHtml, hyundaiDateParser, isHtmlStatement, readHyundaiHtml, statementHtmlTokens } from './hyundai-html'

export type CardIssuer = 'samsung' | 'hyundai' | 'kookmin' | 'shinhan' | 'nonghyup'

export const CARD_ISSUERS: { key: CardIssuer; label: string }[] = [
  { key: 'samsung', label: '삼성카드' },
  { key: 'hyundai', label: '현대카드' },
  { key: 'kookmin', label: '국민카드' },
  { key: 'shinhan', label: '신한카드' },
  { key: 'nonghyup', label: '농협카드' },
]

export type CardRow = {
  date: string
  merchant: string
  amount: number
  pay: string | null
}

export const CARD_SOURCE_MARKER_PREFIX = '__source:card:'

const SPECS: Record<CardIssuer, {
  dateKeys: string[]
  merchantKeys: string[]
  payKeys: string[]
  amountKeys: string[]
  fallbackKeys: string[]
}> = {
  samsung: { dateKeys: ['이용일'], merchantKeys: ['가맹점'], payKeys: ['이용카드', '카드명'], amountKeys: ['이용금액'], fallbackKeys: ['원금'] },
  hyundai: { dateKeys: ['이용일'], merchantKeys: ['이용가맹점'], payKeys: ['이용카드', '카드명'], amountKeys: ['이용금액'], fallbackKeys: ['결제원금'] },
  kookmin: {
    dateKeys: ['이용일자', '이용일'],
    merchantKeys: ['이용가맹점', '이용하신곳'],
    payKeys: ['이용카드', '카드명'],
    amountKeys: ['이용금액'],
    fallbackKeys: ['이번달결제금액', '청구원금'],
  },
  shinhan: { dateKeys: ['이용일'], merchantKeys: ['이용가맹점'], payKeys: ['이용카드', '카드명'], amountKeys: ['이용금액'], fallbackKeys: [] },
  nonghyup: { dateKeys: ['이용일자'], merchantKeys: ['이용가맹점'], payKeys: ['이용카드', '카드명'], amountKeys: ['청구원금'], fallbackKeys: [] },
}

const STOP_MARKS = ['합계', '소계', '없습니다']

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) ? Math.trunc(amount) : null
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = value.getMonth() + 1
    const day = value.getDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const text = String(value).trim()
  const compact = text.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/)
  const match = compact ?? text.match(/(?:^|\D)(\d{4}|\d{2})\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/)
  if (!match) return null
  const year = match[1].length === 2 ? String(2000 + Number(match[1])) : match[1]
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity
    const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10
    const digits = radix === 16 ? code.slice(2) : code.slice(1)
    const point = Number.parseInt(digits, radix)
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

/** Tolerant HTML-table extraction matching the legacy Flask HTMLParser behavior. */
function htmlToGrid(source: string): string[][] {
  const rows: string[][] = []
  const rowStack: string[][] = []
  let cell: string[] | null = null

  for (const token of statementHtmlTokens(source)) {
    if (!token.startsWith('<')) {
      if (cell) cell.push(decodeHtml(token))
      continue
    }
    const closing = /^<\s*\//.test(token)
    const name = token.match(/^<\s*\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase()
    if (!name) continue
    if (!closing && name === 'tr') rowStack.push([])
    else if (!closing && (name === 'td' || name === 'th')) cell = []
    else if (closing && (name === 'td' || name === 'th')) {
      if (cell && rowStack.length > 0) {
        rowStack[rowStack.length - 1].push(cell.join('').replace(/\s+/g, ' ').trim())
      }
      cell = null
    } else if (closing && name === 'tr' && rowStack.length > 0) {
      rows.push(rowStack.pop() ?? [])
    }
  }
  return rows
}

/** Convert XLSX, legacy BIFF, or HTML-as-XLS into one flat row grid. */
function toGrid(buffer: Buffer): string[][] {
  if (isHtmlStatement(buffer)) return htmlToGrid(decodeStatementHtml(buffer))

  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true })
  const grid: string[][] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
    for (const row of rows) {
      grid.push(row.map((cell) => cell instanceof Date ? toIso(cell) ?? '' : String(cell ?? '').trim()))
    }
  }
  return grid
}

const normalizeHeader = (value: string) => value.replace(/\s+/g, '')

/** A Hyundai bill has per-card subtotals within one table, or repeated tables.
 * A subtotal is not the end of the statement. Each new header owns its indexes.
 */
function parseHyundaiGrid(grid: string[][], shortDate: ReturnType<typeof hyundaiDateParser> | null): CardRow[] {
  let section: { date: number; merchant: number; amount: number; fallback: number; fee: number; pay: number; installment: number } | null = null
  const parsed: CardRow[] = []
  const spec = SPECS.hyundai
  for (const row of grid) {
    const header = row.map(normalizeHeader)
    const pick = (keys: string[]) => {
      for (const key of keys) {
        const exact = header.indexOf(key)
        const found = exact === -1 ? header.findIndex((cell) => cell.includes(key)) : exact
        if (found !== -1) return found
      }
      return -1
    }
    const dateColumn = pick(spec.dateKeys)
    const merchantColumn = pick(spec.merchantKeys)
    if (dateColumn !== -1 && merchantColumn !== -1) {
      section = {
        date: dateColumn,
        merchant: merchantColumn,
        amount: pick(spec.amountKeys),
        fallback: pick(spec.fallbackKeys),
        fee: header.indexOf('수수료(이자)'),
        pay: pick(spec.payKeys),
        installment: pick(['할부']),
      }
      continue
    }
    if (!section) continue
    const dateValue = row[section.date] ?? ''
    const date = toIso(dateValue) ?? shortDate?.(dateValue, row[section.installment] ?? '')
    if (!date) {
      if (row.some((cell) => /합계|없습니다/.test(cell))) section = null
      continue
    }
    const merchant = row[section.merchant]?.trim()
    let amount = toInt(row[section.amount])
    if (amount === null || amount === 0) amount = toInt(row[section.fallback])
    if (amount === null || amount === 0) amount = toInt(row[section.fee])
    if (!merchant || amount === null || amount === 0) continue
    parsed.push({ date, merchant, amount, pay: row[section.pay]?.trim() || null })
  }
  return parsed
}

/** Shinhan exports charges, benefits and cancellations as separate tables.
 * Each header owns its column indexes; a subtotal ends only that section.
 */
function parseShinhanGrid(grid: string[][]): CardRow[] {
  let section: {
    date: number
    merchant: number
    pay: number
    amount: number
    refund: boolean
  } | null = null
  const parsed: CardRow[] = []

  for (const row of grid) {
    const header = row.map(normalizeHeader)
    const date = header.findIndex((cell) => cell === '이용일' || cell === '이용일자')
    const merchant = header.findIndex((cell) => cell === '이용가맹점' || cell === '이용가맹점명')
    if (date !== -1 && merchant !== -1) {
      const refund = header.includes('원거래금액') && header.includes('취소금액')
      const benefit = header.some((cell) => /할인금액|적립포인트|포인트적립|적용구분/.test(cell))
      const amount = header.indexOf(refund ? '취소금액' : '이용금액')
      section = benefit || amount === -1 ? null : {
        date,
        merchant,
        pay: header.findIndex((cell) => cell === '이용카드' || cell === '카드명'),
        amount,
        refund,
      }
      continue
    }
    if (STOP_MARKS.some((mark) => row.filter(Boolean).join(' ').includes(mark))) {
      section = null
      continue
    }
    if (!section) continue

    const transactionDate = toIso(row[section.date])
    const transactionMerchant = row[section.merchant]?.trim()
    const amount = toInt(row[section.amount])
    if (!transactionDate || !transactionMerchant || amount === null || amount === 0) continue
    parsed.push({
      date: transactionDate,
      merchant: transactionMerchant,
      // A positive cancellation amount is the amount returned, not a charge.
      // Never fall back to the original amount for partial/blank cancellations.
      amount: section.refund ? -Math.abs(amount) : amount,
      pay: section.pay === -1 ? null : row[section.pay]?.trim() || null,
    })
  }
  return parsed
}

export function parseCardStatement(buffer: Buffer, issuer: CardIssuer, options: { password?: string } = {}): CardRow[] {
  const spec = SPECS[issuer]
  const html = issuer === 'hyundai' ? readHyundaiHtml(buffer, options.password) : null
  const shortDate = html === null ? null : hyundaiDateParser(html)
  const grid = html === null ? toGrid(buffer) : htmlToGrid(html)
  if (issuer === 'hyundai') return parseHyundaiGrid(grid, shortDate)
  if (issuer === 'shinhan') return parseShinhanGrid(grid)
  let headerIndex = -1
  const columns: Record<string, number> = {}

  for (let index = 0; index < grid.length; index += 1) {
    const normalized = grid[index].map(normalizeHeader)
    const hasDate = spec.dateKeys.some((key) => normalized.some((cell) => cell.includes(key)))
    const hasMerchant = spec.merchantKeys.some((key) => normalized.some((cell) => cell.includes(key)))
    if (!hasDate || !hasMerchant) continue
    headerIndex = index
    normalized.forEach((cell, columnIndex) => {
      if (cell && !(cell in columns)) columns[cell] = columnIndex
    })
    break
  }
  if (headerIndex === -1) return []

  const pickColumn = (keys: string[]): number | null => {
    for (const key of keys) {
      if (columns[key] !== undefined) return columns[key]
      const partial = Object.keys(columns).find((column) => column.includes(key))
      if (partial) return columns[partial]
    }
    return null
  }
  const dateColumn = pickColumn(spec.dateKeys)
  const merchantColumn = pickColumn(spec.merchantKeys)
  const payColumn = pickColumn(spec.payKeys)
  const amountColumn = pickColumn(spec.amountKeys)
  const fallbackColumn = pickColumn(spec.fallbackKeys)
  const parsed: CardRow[] = []

  for (const row of grid.slice(headerIndex + 1)) {
    if (STOP_MARKS.some((mark) => row.filter(Boolean).join(' ').includes(mark))) break
    const merchant = merchantColumn === null ? '' : (row[merchantColumn] ?? '').trim()
    if (!merchant) continue
    const date = toIso(dateColumn === null ? null : row[dateColumn])
    if (!date) continue
    let amount = toInt(amountColumn === null ? null : row[amountColumn])
    if ((amount === null || amount === 0) && fallbackColumn !== null) amount = toInt(row[fallbackColumn])
    // A cancellation shows up as a negative charge and has to survive the
    // parse; only an unreadable or genuinely zero row is noise.
    if (amount === null || amount === 0) continue
    const pay = payColumn === null ? null : row[payColumn]?.trim() || null
    parsed.push({ date, merchant, amount, pay })
  }
  return parsed
}

export function cardFingerprint(
  issuer: CardIssuer,
  owner: string,
  row: Pick<CardRow, 'date' | 'merchant' | 'amount'>,
  occurrenceIdx: number,
): string {
  return createHash('sha1')
    .update(`card:${issuer}|${owner}|${row.date}|${row.amount}|${row.merchant}|${occurrenceIdx}`)
    .digest('hex')
}

export function cardSourceMarker(issuer: CardIssuer) {
  return `${CARD_SOURCE_MARKER_PREFIX}${issuer}`
}

export function cardSourceFromMarker(marker: string | null): `card:${CardIssuer}` | null {
  if (!marker?.startsWith(CARD_SOURCE_MARKER_PREFIX)) return null
  const issuer = marker.slice(CARD_SOURCE_MARKER_PREFIX.length) as CardIssuer
  return CARD_ISSUERS.some((card) => card.key === issuer) ? `card:${issuer}` : null
}

export function looksLikeBanksalad(buffer: Buffer): boolean {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', bookSheets: true })
    return workbook.SheetNames.some((name) => name.includes('가계부'))
  } catch {
    return false
  }
}

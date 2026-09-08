import { createHash, timingSafeEqual } from 'node:crypto'
import { KISA_SEED_CBC } from 'kisa-seed'

const MAX_BYTES = 2 * 1024 * 1024
const INVALID_FILE = '지원하지 않거나 손상된 현대카드 보안 HTML입니다. 명세서를 다시 내려받아 주세요.'
const INVALID_PASSWORD = '비밀번호가 맞지 않거나 보안 명세서가 손상되었습니다. 확인 후 다시 시도해 주세요.'

/** Messages are deliberately fixed: never return source HTML or crypto errors. */
export class HyundaiStatementError extends Error {}

export function isHtmlStatement(buffer: Buffer) {
  return /<(?:!doctype\s+html|html\b|table\b)/i.test(buffer.toString('latin1'))
}

export function decodeStatementHtml(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('euc-kr', { fatal: true }).decode(buffer)
  }
}

/** Linear, inert HTML tokenization. Unclosed comments/script/style consume EOF;
 * repeated opening tags must not trigger regex rescans of the whole remainder.
 */
export function* statementHtmlTokens(source: string): Generator<string> {
  let cursor = 0
  while (cursor < source.length) {
    const opening = source.indexOf('<', cursor)
    if (opening === -1) {
      yield source.slice(cursor)
      return
    }
    if (opening > cursor) yield source.slice(cursor, opening)
    if (source.startsWith('<!--', opening)) {
      const closing = source.indexOf('-->', opening + 4)
      cursor = closing === -1 ? source.length : closing + 3
      continue
    }
    const closing = source.indexOf('>', opening + 1)
    if (closing === -1) return
    const token = source.slice(opening, closing + 1)
    const block = token.match(/^<\s*(script|style)\b/i)?.[1]
    if (block) {
      const end = new RegExp(`<\\/\\s*${block}\\s*>`, 'gi')
      end.lastIndex = closing + 1
      const match = end.exec(source)
      cursor = match ? end.lastIndex : source.length
    } else {
      yield token
      cursor = closing + 1
    }
  }
}

/** Read data literals only. Never execute the attachment or load its scripts.
 * Hyundai VestMail: SHA256(password) -> IV, SHA256(hash) -> SEED key;
 * each part has an outer 16-byte frame and an encrypted key-verification block.
 * This legacy CBC format is not authenticated; the prefix verifies the password,
 * not the authenticity of the statement. All parsed rows still go to review.
 */
export function readHyundaiHtml(buffer: Buffer, password = ''): string | null {
  if (buffer.length > MAX_BYTES) throw new HyundaiStatementError('파일 크기는 2MB 이하여야 합니다.')
  if (!isHtmlStatement(buffer)) return null
  const source = decodeStatementHtml(buffer)
  if (!/vestmail|\bvar\s+s\s*=\s*new\s+Array\s*\(/i.test(source)) return source
  if (!password) throw new HyundaiStatementError('보안 명세서 비밀번호를 입력해 주세요.')
  if (password.length > 128) throw new HyundaiStatementError(INVALID_PASSWORD)

  const parts: Buffer[] = []
  // Match assignment starts separately from their anchored literal. A missing
  // semicolon must fail immediately, not rescan the rest of a 2MB file per row.
  for (const assignment of source.matchAll(/\bs\s*\[\s*(\d+)\s*\]\s*=/g)) {
    const literal = source.slice(assignment.index + assignment[0].length).match(/^\s*(["'])([A-Za-z0-9+/]+={0,2})\1\s*;/)
    if (parts.length >= 32 || Number(assignment[1]) !== parts.length || !literal) throw new HyundaiStatementError(INVALID_FILE)
    const bytes = Buffer.from(literal[2], 'base64')
    if (bytes.toString('base64') !== literal[2] || bytes.length < 48 || bytes.length % 16 !== 0) {
      throw new HyundaiStatementError(INVALID_FILE)
    }
    parts.push(bytes.subarray(16))
  }
  if (!parts.length) throw new HyundaiStatementError(INVALID_FILE)

  const hash = createHash('sha256').update(password, 'utf8').digest()
  const keyHash = createHash('sha256').update(hash).digest()
  const iv = hash.subarray(0, 16)
  const key = keyHash.subarray(0, 16)
  const plaintext: Buffer[] = []
  let combined: Buffer | undefined
  try {
    for (const encrypted of parts) {
      const decrypted = Buffer.from(KISA_SEED_CBC.SEED_CBC_Decrypt(key, iv, encrypted, 0, encrypted.length))
      plaintext.push(decrypted)
      if (decrypted.length < 16 || !timingSafeEqual(decrypted.subarray(0, 16), key)) {
        throw new Error('invalid password check')
      }
      // The library only checks the final padding length. A canonical round trip
      // also verifies every PKCS#7 padding byte, without enabling OpenSSL legacy.
      const roundTrip = Buffer.from(KISA_SEED_CBC.SEED_CBC_Encrypt(key, iv, decrypted, 0, decrypted.length))
      if (roundTrip.length !== encrypted.length || !timingSafeEqual(roundTrip, encrypted)) {
        throw new Error('invalid padding')
      }
    }
    combined = Buffer.concat(plaintext.map((part) => part.subarray(16)))
    const html = new TextDecoder('utf-8', { fatal: true }).decode(combined)
    // Actual attachments append an inert tracking image after </html>. We do
    // not render/load it, but do require closure to catch missing final parts.
    if (!/<table\b/i.test(html) || !/<\/html>/i.test(html)) throw new Error('incomplete statement')
    return html
  } catch {
    throw new HyundaiStatementError(INVALID_PASSWORD)
  } finally {
    hash.fill(0)
    keyHash.fill(0)
    plaintext.forEach((part) => part.fill(0))
    combined?.fill(0)
  }
}

/** MM.DD is resolved against the statement's billing month, never today's date. */
export function hyundaiDateParser(html: string) {
  const text = [...statementHtmlTokens(html)].filter((token) => !token.startsWith('<')).join(' ')
  const months = new Set([...text.matchAll(/(20\d{2})\s*년\s*(\d{1,2})\s*월/g)].map((match) => `${match[1]}-${Number(match[2])}`))
  return (value: string, installment: string): string | null => {
    const short = value.trim().match(/^(\d{1,2})[./-](\d{1,2})$/)
    if (!short) return null
    const term = installment.replace(/\s+/g, '')
    // A 12-month plan may finish in the purchase month of the following year.
    const unambiguousTerm = !term || term === '일시불' || (/^\d{1,2}(?:개월)?$/.test(term) && Number.parseInt(term, 10) < 12)
    if (months.size !== 1 || !unambiguousTerm) {
      throw new HyundaiStatementError('이용일의 연도를 확정할 수 없습니다. 연도가 포함된 엑셀 이용내역을 올려 주세요.')
    }
    const [billingYear, billingMonth] = [...months][0].split('-').map(Number)
    const month = Number(short[1])
    const day = Number(short[2])
    const year = billingYear - (month > billingMonth ? 1 : 0)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (billingMonth < 1 || billingMonth > 12 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      throw new HyundaiStatementError('명세서에 올바르지 않은 이용일이 있습니다. 원본 파일을 확인해 주세요.')
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
}

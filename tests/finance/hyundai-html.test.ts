import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { KISA_SEED_CBC } from 'kisa-seed'

import { parseCardStatement } from '@/features/inbox/parsers/cards'
import { readHyundaiHtml, statementHtmlTokens } from '@/features/inbox/parsers/hyundai-html'
import { HYUNDAI_TEST_PASSWORD, HYUNDAI_TEST_PARTS, secureHyundaiFixture } from '../fixtures/hyundai-secure'

const header = '<tr><td>이용일</td><td>이용카드</td><td>이용가맹점</td><td>이용금액</td><td>할부</td></tr>'
function plainStatement(date: string, heading = '2026년 01월', installment = '') {
  return Buffer.from(`<html><h1>${heading}</h1><table>${header}<tr><td>${date}</td><td>카드</td><td>가상 상점</td><td>1000</td><td>${installment}</td></tr></table></html>`)
}

test('decrypts independently encrypted multi-part VestMail without executing its scripts', () => {
  const source = Buffer.from(secureHyundaiFixture())
  expect(readHyundaiHtml(source, HYUNDAI_TEST_PASSWORD)).toContain('테스트 환불')
  expect(parseCardStatement(source, 'hyundai', { password: HYUNDAI_TEST_PASSWORD })).toEqual([
    { date: '2025-12-24', merchant: '테스트 상점', amount: 12000, pay: '카드' },
    { date: '2026-01-02', merchant: '테스트 환불', amount: -3000, pay: '카드' },
  ])
})

test('keeps transactions after card subtotals, stops at grand total, and does not treat merchant text as a total', () => {
  const source = Buffer.from(`<html><h1>2026년 01월</h1><table>${header}
    <tr><td>12.24</td><td>카드 A</td><td>소계상점</td><td>1000</td></tr>
    <tr><td></td><td></td><td>소계</td><td>1000</td></tr>
    <tr><td>12.25</td><td>카드 B</td><td>다른 상점</td><td>2000</td></tr>
    <tr><td></td><td></td><td>합계</td><td>3000</td></tr>
    <tr><td>12.25</td><td></td><td>뒤쪽 혜택 표</td><td>100</td></tr>
  </table></html>`)
  expect(parseCardStatement(source, 'hyundai').map((row) => row.amount)).toEqual([1000, 2000])
})

test('password errors are actionable and never contain the entered value', () => {
  const buffer = Buffer.from(secureHyundaiFixture())
  expect(() => readHyundaiHtml(buffer)).toThrow('비밀번호를 입력')
  expect(() => readHyundaiHtml(buffer, 'wrong-test-secret')).toThrow('비밀번호가 맞지 않거나')
  expect(() => readHyundaiHtml(buffer, 'wrong-test-secret')).not.toThrow('wrong-test-secret')
})

test('rejects noncanonical PKCS#7 padding even when the SEED library accepts it', () => {
  const hash = createHash('sha256').update(HYUNDAI_TEST_PASSWORD).digest()
  const key = createHash('sha256').update(hash).digest().subarray(0, 16)
  const iv = hash.subarray(0, 16)
  const frame = Buffer.from(HYUNDAI_TEST_PARTS[1], 'base64')
  const encrypted = frame.subarray(16)
  const original = KISA_SEED_CBC.SEED_CBC_Decrypt(key, iv, encrypted, 0, encrypted.length)
  const padding = encrypted.length - original.length
  expect(padding).toBeGreaterThan(1)
  // Flip a non-final padding byte through CBC's preceding block. The final
  // padding length and initial key-verification block both remain valid.
  frame[frame.length - 32 + 14] ^= 1
  const acceptedByLibrary = KISA_SEED_CBC.SEED_CBC_Decrypt(key, iv, encrypted, 0, encrypted.length)
  expect(acceptedByLibrary.length).toBe(original.length)
  expect(() => readHyundaiHtml(Buffer.from(secureHyundaiFixture([
    HYUNDAI_TEST_PARTS[0], frame.toString('base64'),
  ])), HYUNDAI_TEST_PASSWORD)).toThrow('비밀번호가 맞지 않거나')
})

test('each repeated Hyundai header owns its column positions', () => {
  const source = Buffer.from(`<html><h1>2026년 01월</h1>
    <table>${header}<tr><td>12.24</td><td>카드 A</td><td>첫 상점</td><td>1000</td></tr><tr><td>소계</td></tr></table>
    <table><tr><td>이용가맹점</td><td>이용금액</td><td>이용일</td></tr><tr><td>다음 상점</td><td>2000</td><td>12.25</td></tr></table>
  </html>`)
  expect(parseCardStatement(source, 'hyundai').map((row) => [row.date, row.amount])).toEqual([
    ['2025-12-24', 1000], ['2025-12-25', 2000],
  ])
})

test('rejects missing, duplicated, malformed and truncated encrypted parts', () => {
  for (const source of [
    secureHyundaiFixture().replace('s[1]', 's[2]'),
    secureHyundaiFixture().replace('s[1]', 's[0]'),
    secureHyundaiFixture(['not base64']),
    secureHyundaiFixture([HYUNDAI_TEST_PARTS[0].slice(0, -4)]),
    secureHyundaiFixture([HYUNDAI_TEST_PARTS[0]]),
    '<html><script>/* VestMail */ var s = new Array();</script></html>',
    `<html>VestMail ${'s[0]=a\n'.repeat(10000)}</html>`,
  ]) {
    expect(() => readHyundaiHtml(Buffer.from(source), HYUNDAI_TEST_PASSWORD)).toThrow()
  }
  expect(() => readHyundaiHtml(Buffer.alloc(2 * 1024 * 1024 + 1), HYUNDAI_TEST_PASSWORD)).toThrow('2MB')
})

test('reads plain HTML with a late table and preserves a fully specified date', () => {
  const source = Buffer.from(plainStatement('2024.12.24').toString().replace('<table>', `${' '.repeat(9000)}<table>`))
  expect(parseCardStatement(source, 'hyundai')[0]?.date).toBe('2024-12-24')
})

test('uses statement month for MM.DD dates, not the current system year', () => {
  expect(parseCardStatement(plainStatement('12.24'), 'hyundai')[0]?.date).toBe('2025-12-24')
  expect(parseCardStatement(plainStatement('01.02'), 'hyundai')[0]?.date).toBe('2026-01-02')
})

test('rejects missing or ambiguous billing months, impossible dates and ambiguous long installments', () => {
  for (const source of [
    plainStatement('12.24', ''),
    plainStatement('12.24', '2025년 12월 / 2026년 01월'),
    plainStatement('02.30'),
    plainStatement('12.24', '2026년 01월', '24'),
    plainStatement('12.24', '2026년 01월', '03/24'),
    plainStatement('12.24', '2026년 01월', '할부24'),
    plainStatement('01.02', '2026년 01월', '12'),
  ]) expect(() => parseCardStatement(source, 'hyundai')).toThrow()
})

test('inert HTML scanning drops comments, script/style blocks and an unclosed block through EOF', () => {
  expect([...statementHtmlTokens('<p>safe</p><!--comment--><style>bad</style><script>bad</script><p>end</p>')].join(''))
    .toBe('<p>safe</p><p>end</p>')
  expect([...statementHtmlTokens(`<p>safe</p>${'<script>'.repeat(40000)}`)].join('')).toBe('<p>safe</p>')
})

test('reads EUC-KR HTML-as-XLS without corrupting Korean text', () => {
  // EUC-KR bytes for 이용일 / 이용가맹점 / 이용금액 / 가게.
  const encoded = Buffer.concat([
    Buffer.from('<html><meta charset="euc-kr"><table><tr><td>'),
    Buffer.from('c0ccbfe bc0cf'.replaceAll(' ', ''), 'hex'),
    Buffer.from('</td><td>'), Buffer.from('c0ccb febb0 a1b8cd c1a1'.replaceAll(' ', ''), 'hex'),
    Buffer.from('</td><td>'), Buffer.from('c0ccb febb1 ddbed7'.replaceAll(' ', ''), 'hex'),
    Buffer.from('</td></tr><tr><td>2026.01.02</td><td>'), Buffer.from('b0a1b0d4', 'hex'),
    Buffer.from('</td><td>1000</td></tr></table></html>'),
  ])
  expect(parseCardStatement(encoded, 'hyundai')[0]).toEqual({ date: '2026-01-02', merchant: '가게', amount: 1000, pay: null })
})

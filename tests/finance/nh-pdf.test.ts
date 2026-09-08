import { expect, test } from 'vitest'
import { isPdfStatement, parseNhPdf } from '@/features/inbox/parsers/nh-pdf'
import { parseNhPdfPages, type NhPdfPage } from '@/features/inbox/parsers/nh-pdf-grid'
import { NH_TEST_PASSWORD, syntheticNhPdf } from '../fixtures/nh-pdf'

function item(text: string, x: number, y: number, right = x + text.length * 4) {
  return { text, x, y, width: right - x }
}
function page(): NhPdfPage {
  return { width: 595.276, items: [
    item('이용기간: [일시불/할부] 2025.12.15 ~ 2026.01.14', 36, 810),
    item('12/24 테스트 가맹점', 36, 770), item('50,000', 240, 770, 276),
    item('12,500', 370, 770, 407), item('100', 430, 770, 446),
    item('01/02 테스트 환불', 36, 750), item('-2,500', 370, 750, 407), item('0', 440, 750, 446),
    item('합계', 36, 720), item('10,000', 370, 720, 407),
  ] }
}
const expected = [
  { date: '2026-07-12', merchant: '테스트 가맹점', amount: 12500, pay: null },
  { date: '2026-07-15', merchant: '테스트 환불', amount: -2500, pay: null },
]

test('decodes real plain and encrypted synthetic PDFs with principal amounts across pages', async () => {
  expect(await parseNhPdf(syntheticNhPdf())).toEqual(expected)
  expect(await parseNhPdf(syntheticNhPdf({ encrypted: true }), NH_TEST_PASSWORD)).toEqual(expected)
})
test('classifies missing and incorrect passwords without exposing decoder details', async () => {
  await expect(parseNhPdf(syntheticNhPdf({ encrypted: true }))).rejects.toMatchObject({ code: 'password_required' })
  await expect(parseNhPdf(syntheticNhPdf({ encrypted: true }), 'wrong')).rejects.toMatchObject({ code: 'password_incorrect' })
})
test('rejects non-PDF and corrupt bytes', async () => {
  expect(isPdfStatement(Buffer.from('not a PDF'))).toBe(false)
  expect(isPdfStatement(syntheticNhPdf())).toBe(true)
  for (const bytes of [Buffer.from('not a PDF'), Buffer.from('%PDF-1.7\nbroken')]) {
    await expect(parseNhPdf(bytes)).rejects.toMatchObject({ code: 'invalid_pdf' })
  }
})
test('rejects an actual image-only PDF instead of returning successful zero rows', async () => {
  // A one-pixel raster image, with no PDF text operators or fonts.
  const drawImage = 'q 100 0 0 100 36 700 cm /Image Do Q'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Resources << /XObject << /Image 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${drawImage.length} >>\nstream\n${drawImage}\nendstream`,
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\nX\nendstream',
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await expect(parseNhPdf(Buffer.from(pdf))).rejects.toMatchObject({ code: 'unsupported_layout' })
})
test('uses the explicit cross-year usage period, preserving blank usage and negative principal', () => {
  expect(parseNhPdfPages([page()])).toEqual([
    { date: '2025-12-24', merchant: '테스트 가맹점', amount: 12500, pay: null },
    { date: '2026-01-02', merchant: '테스트 환불', amount: -2500, pay: null },
  ])
})
test('retains an explicit zero principal and separately extracted date and merchant', () => {
  const input = page()
  input.items[1].text = '12/24'
  input.items.push(item('테스트 가맹점', 68, 770))
  input.items[3].text = '0'
  input.items.at(-2)!.text = '-2,500'
  expect(parseNhPdfPages([input])[0]).toEqual({ date: '2025-12-24', merchant: '테스트 가맹점', amount: 0, pay: null })
})
test('joins wrapped merchants, skips repeated headers and reconciles subtotals plus final total', () => {
  const first = page()
  first.items.splice(4, 0, item('추가 이름', 68, 764))
  first.items.splice(8, 0, item('소계(2건)', 36, 730), item('10,000', 370, 730, 407))
  first.items.push(item('가맹점명', 80, 790), item('원금', 390, 790, 407))
  expect(parseNhPdfPages([first])[0].merchant).toBe('테스트 가맹점 추가 이름')
})
test.each(['bad-date', 'bad-amount', 'missing-principal', 'missing-period', 'wrong-total', 'missing-total', 'unknown-columns', 'unknown-row'])('rejects the entire table for %s', (variant) => {
  const input = page()
  if (variant === 'bad-date') input.items[1].text = '02/30 테스트 가맹점'
  if (variant === 'bad-amount') input.items[3].text = '12,5O0'
  if (variant === 'missing-principal') input.items.splice(3, 1)
  if (variant === 'missing-period') input.items.shift()
  if (variant === 'wrong-total') input.items.at(-1)!.text = '10,001'
  if (variant === 'missing-total') input.items.splice(-2)
  if (variant === 'unknown-columns') input.items.forEach((entry) => { entry.x += 30 })
  if (variant === 'unknown-row') input.items.push(item('잘못된 날짜 상점', 36, 740), item('500', 380, 740, 407))
  expect(() => parseNhPdfPages([input])).toThrowError(expect.objectContaining({ code: 'unsupported_layout' }))
})
test('rejects image-only pages and unrelated text', () => {
  expect(() => parseNhPdfPages([{ width: 595.276, items: [] }])).toThrow()
  expect(() => parseNhPdfPages([{ width: 595.276, items: [item('Hello', 36, 770)] }])).toThrow()
})
test('rejects a malformed zero-principal row before the first valid row even when totals still match', () => {
  const input = page()
  input.items.push(item('잘못된 날짜 상점', 36, 780), item('0', 403, 780, 407), item('0', 442, 780, 446))
  expect(() => parseNhPdfPages([input])).toThrowError(expect.objectContaining({ code: 'unsupported_layout' }))
})
test.each([
  ['before the first transaction', 780, 'O'],
  ['after the final total', 700, '0'],
] as const)('rejects malformed transaction-like geometry %s even when reconciliation matches', (_position, y, principal) => {
  const input = page()
  input.items.push(item('날짜오류 테스트 상점', 36, y), item(principal, 403, y, 407), item('0', 442, y, 446))
  expect(() => parseNhPdfPages([input])).toThrowError(expect.objectContaining({ code: 'unsupported_layout' }))
})
test('allows known headers, summary columns and plain notices around the transaction table', () => {
  const input = page()
  for (const y of [790, 680]) {
    input.items.push(item('이용일자 가맹점명', 36, y), item('원금', 390, y, 407), item('수수료', 430, y, 446))
    input.items.push(item('명세서 안내', 36, y - 5))
  }
  input.items.push(item('소계', 36, 800), item('10,000', 370, 800, 407), item('100', 430, 800, 446))
  expect(parseNhPdfPages([input])).toEqual([
    { date: '2025-12-24', merchant: '테스트 가맹점', amount: 12500, pay: null },
    { date: '2026-01-02', merchant: '테스트 환불', amount: -2500, pay: null },
  ])
})

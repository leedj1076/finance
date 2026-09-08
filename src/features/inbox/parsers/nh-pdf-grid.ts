import type { CardRow } from './cards'
import { NhPdfError } from './nh-pdf'

export type NhPdfPage = { width: number; items: Array<{ text: string; x: number; y: number; width: number }> }

function unsupported(): never {
  throw new NhPdfError('unsupported_layout')
}

function money(text: string): number {
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) unsupported()
  const amount = Number(text.replaceAll(',', ''))
  if (!Number.isSafeInteger(amount)) unsupported()
  return amount
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null
}

/** NH's image-header layout uses stable, separate right edges for usage,
 * principal and fee. Normalize to A4 points; never infer principal from usage.
 * A readable usage period plus row geometry and reconciled totals are required
 * because this layout's visual column headings may be raster images.
 */
export function parseNhPdfPages(pages: NhPdfPage[]): CardRow[] {
  const periods = new Set<string>()
  for (const page of pages) {
    const text = page.items.map((item) => item.text).join(' ')
    for (const match of text.matchAll(/이용기간\s*:?\s*\[일시불\s*\/\s*할부\]\s*(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*~\s*(\d{4})[.\-/](\d{2})[.\-/](\d{2})/g)) {
      const start = validDate(+match[1], +match[2], +match[3])
      const end = validDate(+match[4], +match[5], +match[6])
      if (!start || !end || start > end || +match[4] - +match[1] > 1) unsupported()
      periods.add(`${start}|${end}`)
    }
  }
  if (periods.size !== 1) unsupported()
  const [start, end] = [...periods][0].split('|')
  const rows: CardRow[] = []
  let groupSum = 0
  let totalSeen = false
  let active = false

  for (const page of pages) {
    if (!Number.isFinite(page.width) || page.width <= 0) unsupported()
    const scale = 595.276 / page.width
    const items = page.items.filter((item) => item.text.trim()).map((item) => ({
      text: item.text.trim(), x: item.x * scale, y: item.y * scale,
      right: (item.x + item.width) * scale,
    })).sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: Array<typeof items> = []
    for (const item of items) {
      const previous = lines.at(-1)
      if (previous && Math.abs(previous[0].y - item.y) <= 1.5) previous.push(item)
      else lines.push([item])
    }
    let previousY: number | undefined
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      const left = line.filter((item) => item.x < 235)
      const label = left.map((item) => item.text).join(' ').trim()
      const principalCells = line.filter((item) => Math.abs(item.right - 407) <= 3)
      const feeCells = line.filter((item) => Math.abs(item.right - 446) <= 3)
      const datePrefix = label.match(/^(\d{1,2})\/(\d{1,2})(?:\s+|$)(.*)$/)
      if (datePrefix) {
        if (totalSeen || !left.length || Math.abs(left[0].x - 36) > 4 || principalCells.length !== 1 || feeCells.length !== 1) unsupported()
        money(feeCells[0].text)
        const merchant = datePrefix[3].trim()
        if (!merchant) unsupported()
        const dates: string[] = []
        for (let year = +start.slice(0, 4); year <= +end.slice(0, 4); year++) {
          const date = validDate(year, +datePrefix[1], +datePrefix[2])
          if (date && date >= start && date <= end) dates.push(date)
        }
        if (dates.length !== 1) unsupported()
        const amount = money(principalCells[0].text)
        rows.push({ date: dates[0], merchant, amount, pay: null })
        groupSum += amount
        active = true
        previousY = line[0].y
        continue
      }
      if (!active) {
        if (left.length && Math.abs(left[0].x - 36) <= 4 && principalCells.some((item) => /^-?[\d,]+$/.test(item.text)) && feeCells.some((item) => /^-?[\d,]+$/.test(item.text))) unsupported()
        continue
      }
      if (/^(소계|합계)/.test(label)) {
        if (principalCells.length !== 1 || totalSeen) unsupported()
        const amount = money(principalCells[0].text)
        if (label.startsWith('합계')) {
          if (amount !== rows.reduce((sum, row) => sum + row.amount, 0)) unsupported()
          totalSeen = true
        } else {
          if (amount !== groupSum) unsupported()
          groupSum = 0
        }
        previousY = undefined
        continue
      }
      if (totalSeen) continue
      // Known repeated headers cannot turn into a continuation or transaction.
      if (line.every((item) => /^(?:이용|일자|이용일자|가맹점명|이용금액|원금|수수료|당월|결제하실|금액|혜택|개월|회차|구분|적립|포인트|결제 후 잔액)/.test(item.text))) {
        previousY = undefined
        continue
      }
      if (principalCells.length || feeCells.length || /^\d.*[\/.\-]/.test(label)) unsupported()
      if (previousY !== undefined && previousY - line[0].y <= 10 && left.length === line.length && left.every((item) => item.x >= 36 && item.right < 235)) {
        rows.at(-1)!.merchant += ` ${label}`
        previousY = line[0].y
      } else if (line[0].y < (previousY ?? -Infinity)) {
        // Unknown content inside the active transaction table must not disappear.
        unsupported()
      }
    }
  }
  if (!rows.length || !totalSeen) unsupported()
  return rows
}

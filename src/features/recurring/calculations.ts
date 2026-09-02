import { normalizeAnalyticsMerchant } from '@/features/analytics/calculations'

export type RecurringCandidateRow = {
  date: string
  amount: number
  merchant: string
}

export type RecurringCandidate = {
  name: string
  average: number
  months: number
  lastDate: string
  suggestedDay: number
}

export function detectRecurringCandidates(
  rows: RecurringCandidateRow[],
  knownNames: string[] = [],
  minimumMonths = 3,
) {
  const known = new Set(knownNames.map(normalizeAnalyticsMerchant).filter(Boolean))
  const groups = new Map<string, RecurringCandidateRow[]>()

  for (const row of rows) {
    const key = normalizeAnalyticsMerchant(row.merchant)
    if (!key || known.has(key)) continue
    const occurrences = groups.get(key) ?? []
    occurrences.push(row)
    groups.set(key, occurrences)
  }

  const candidates: RecurringCandidate[] = []
  for (const occurrences of groups.values()) {
    occurrences.sort((a, b) => a.date.localeCompare(b.date))
    const months = Array.from(new Set(occurrences.map((row) => row.date.slice(0, 7)))).sort()
    if (months.length < minimumMonths) continue
    if (occurrences.length > months.length * 1.8) continue

    const monthIndexes = months.map((month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)))
    const monthlyGaps = monthIndexes.slice(1).filter((value, index) => value - monthIndexes[index] === 1).length
    if (monthlyGaps < minimumMonths - 1) continue

    const latest = occurrences.at(-1)!
    const average = Math.round(
      occurrences.reduce((sum, row) => sum + row.amount, 0) / occurrences.length,
    )
    candidates.push({
      name: latest.merchant,
      average,
      months: months.length,
      lastDate: latest.date,
      suggestedDay: Number(latest.date.slice(8, 10)),
    })
  }

  return candidates
    .sort((left, right) => right.average - left.average || left.name.localeCompare(right.name))
    .slice(0, 12)
}

export function recurringPostingDate(month: string, day: number) {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(Math.min(Math.max(day, 1), lastDay)).padStart(2, '0')}`
}

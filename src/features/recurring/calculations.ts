import { normalizeAnalyticsMerchant } from '@/features/analytics/calculations'

export type RecurringSchedule = {
  startMonth?: string | null
  endMonth?: string | null
  startOccurrence?: number | null
  adjustToBusinessDay?: boolean
}

export function recurringIsDue(rule: RecurringSchedule & { active: boolean }, month: string) {
  return rule.active && (!rule.startMonth || month >= rule.startMonth)
    && (!rule.endMonth || month <= rule.endMonth)
}

export function recurringMemo(rule: RecurringSchedule & { memo: string | null }, month: string) {
  if (!rule.startMonth || rule.startOccurrence == null) return rule.memo
  const offset = (Number(month.slice(0, 4)) - Number(rule.startMonth.slice(0, 4))) * 12
    + Number(month.slice(5, 7)) - Number(rule.startMonth.slice(5, 7))
  return rule.memo?.replace(/X(?=\s*회)/g, String(rule.startOccurrence + offset)) ?? null
}

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

export type RecurringDetectionOptions = { maxDaySpread: number; maxVariation: number }

const DEFAULT_DETECTION: RecurringDetectionOptions = { maxDaySpread: 4, maxVariation: 1.1 }

// How many rules the screen offers to suggest. Sized against the household's
// real data: every candidate down to this rank is a genuine monthly charge,
// and the first one that isn't (a month-end transit total, which has no fixed
// amount to suggest) falls just past it. This caps the suggestion list only.
// The page height comes from the confirmed rules above it, not from here.
const CANDIDATE_LIMIT = 16

function spread(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { mean, deviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) }
}

export function detectRecurringCandidates(
  rows: RecurringCandidateRow[],
  knownNames: string[] = [],
  minimumMonths = 3,
  options: RecurringDetectionOptions = DEFAULT_DETECTION,
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
    // A bill posts once a month; a habit posts whenever. Two a month is a habit.
    if (occurrences.length > months.length * 1.2) continue

    const monthIndexes = months.map((month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)))
    const monthlyGaps = monthIndexes.slice(1).filter((value, index) => value - monthIndexes[index] === 1).length
    if (monthlyGaps < minimumMonths - 1) continue

    // Bills land on the same day and cost about the same. Utilities swing with
    // the season, so the amount test is loose and the day test does the work.
    const day = spread(occurrences.map((row) => Number(row.date.slice(8, 10))))
    if (day.deviation > options.maxDaySpread) continue
    const amount = spread(occurrences.map((row) => row.amount))
    if (amount.mean <= 0 || amount.deviation / amount.mean > options.maxVariation) continue

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
    .slice(0, CANDIDATE_LIMIT)
}

export function recurringPostingDate(month: string, day: number) {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(Math.min(Math.max(day, 1), lastDay)).padStart(2, '0')}`
}

/**
 * Identity of the transaction a rule posts in a given month. Stored in
 * `import_uid`, whose unique index is what actually stops a second posting:
 * matching on the transaction's date instead lets an edited date slip past
 * and produce a duplicate.
 */
export function recurringImportUid(ruleId: number, month: string) {
  return `recurring:${ruleId}:${month}`
}

import type { BudgetDraft, BudgetDraftChoice, BudgetDraftRow } from './draft'

function parsedAmount(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isSafeInteger(amount) ? amount : null
}

export function overwrittenDraftRows(
  draft: BudgetDraft,
  choices: BudgetDraftChoice[],
): BudgetDraftRow[] {
  const baselineByMajor = new Map(draft.baseline.map((row) => [row.major, row]))
  const choiceByMajor = new Map(choices.map((choice) => [choice.major, choice]))

  return draft.rows.filter((row) => {
    const baseline = baselineByMajor.get(row.major)
    const choice = choiceByMajor.get(row.major)
    if (!baseline || !choice) return false
    const currentAmount = parsedAmount(row.amount)
    const dirty = currentAmount !== baseline.amount
      || row.recommendationJobId !== baseline.recommendationJobId
    if (!dirty) return false
    const choiceJobId = choice.source === 'ai' ? choice.recommendationJobId : null
    return currentAmount !== choice.amount || row.recommendationJobId !== choiceJobId
  })
}

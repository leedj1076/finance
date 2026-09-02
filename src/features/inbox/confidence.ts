export type SugSource = 'user' | 'history' | 'ai' | 'banksalad' | null

export type ConfidenceInput = {
  sugSource: SugSource
  historyMatch: 'norm' | 'token' | null
  alwaysConfirm: boolean
  hasDup: boolean
  kind: 'normal' | 'transfer'
  categoryId: number | null
  exactAmountRepeat: boolean
}

/**
 * Returns high only for rows safe to fold into the one-click approval group.
 * Hard review conditions take precedence over aggregator and source promotion.
 */
export function assessConfidence(input: ConfidenceInput): 'high' | 'review' {
  if (input.kind === 'transfer') return 'review'
  if (input.hasDup) return 'review'
  if (!input.categoryId) return 'review'
  if (input.alwaysConfirm) return input.exactAmountRepeat ? 'high' : 'review'
  if (input.sugSource === 'user') return 'high'
  if (input.sugSource === 'history' && input.historyMatch === 'norm') return 'high'
  return 'review'
}

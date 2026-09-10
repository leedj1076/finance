import { parseAiPromptInput, renderAiPrompt } from '@/features/ai-settings/prompt'
import type { AiPromptInput } from '@/features/ai-settings/types'
import { DiagnosisRunnerError, runStructuredCodex, type StructuredRunnerOptions } from '@/features/diagnosis/structured-runner'

import { budgetRecommendationReportSchema, parseBudgetRecommendationReport } from './report'
import type { BudgetRecommendationReport, BudgetRecommendationSnapshot } from './types'

export function runCodexBudgetRecommendation(
  snapshot: BudgetRecommendationSnapshot,
  options: StructuredRunnerOptions & { promptInput: AiPromptInput },
): Promise<BudgetRecommendationReport> {
  let promptInput: AiPromptInput
  try {
    promptInput = parseAiPromptInput(options.promptInput, 'budget', snapshot)
  } catch {
    return Promise.reject(new DiagnosisRunnerError('invalid_output'))
  }
  return runStructuredCodex({
    prompt: renderAiPrompt(promptInput, snapshot),
    schema: budgetRecommendationReportSchema,
    parse: (value) => parseBudgetRecommendationReport(value, snapshot, promptInput),
  }, options)
}

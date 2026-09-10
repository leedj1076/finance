import { parseAiPromptInput, renderAiPrompt } from '@/features/ai-settings/prompt'
import type { AiPromptInput } from '@/features/ai-settings/types'

import { buildDiagnosisPrompt } from './prompt'
import { DIAGNOSIS_REPORT_SCHEMA, parseDiagnosisReport } from './report'
import {
  DiagnosisRunnerError,
  getDiagnosisErrorCode,
  runStructuredCodex,
  type StructuredRunnerOptions,
} from './structured-runner'
import type { DiagnosisReport, DiagnosisSnapshot } from './types'

export type CodexDiagnosisOptions = StructuredRunnerOptions & {
  promptInput?: AiPromptInput | null
}

export { DiagnosisRunnerError, getDiagnosisErrorCode }
export type { StructuredRunnerOptions }

export function runCodexDiagnosis(
  snapshot: DiagnosisSnapshot,
  options: CodexDiagnosisOptions,
): Promise<DiagnosisReport> {
  let prompt: string
  if (options.promptInput == null) {
    prompt = buildDiagnosisPrompt(snapshot)
  } else {
    try {
      const promptInput = parseAiPromptInput(options.promptInput, 'ledger', snapshot)
      prompt = renderAiPrompt(promptInput, snapshot)
    } catch {
      return Promise.reject(new DiagnosisRunnerError('invalid_output'))
    }
  }
  return runStructuredCodex({
    prompt,
    schema: DIAGNOSIS_REPORT_SCHEMA,
    parse: (value) => parseDiagnosisReport(value, snapshot),
  }, options)
}

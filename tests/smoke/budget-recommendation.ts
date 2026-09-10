import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadDiagnosisWorkerConfig } from '../../src/features/diagnosis/worker'
import { runCodexBudgetRecommendation } from '../../src/features/budget-recommendations/codex-runner'
import { parseBudgetRecommendationReport } from '../../src/features/budget-recommendations/report'
import { buildBudgetPromptInput } from '../../src/features/budget-recommendations/prompt'
import { makeBudgetSnapshot } from '../fixtures/budget-recommendation'

async function main() {
  const config = await loadDiagnosisWorkerConfig(join(homedir(), '.config', 'finance-web', 'diagnosis-worker.json'))
  const snapshot = makeBudgetSnapshot()
  const promptInput = buildBudgetPromptInput(snapshot, { revision: 0, updatedAt: null,
    commonInstructions: null, ledgerInstructions: null, budgetInstructions: null })
  const report = await runCodexBudgetRecommendation(snapshot, { codexPath: config.codexPath, model: config.model, promptInput })
  parseBudgetRecommendationReport(report, snapshot, promptInput)
  process.stdout.write('budget_recommendation_smoke_passed\n')
}
main().catch(() => {
  process.stderr.write('budget_recommendation_smoke_failed\n')
  process.exitCode = 1
})

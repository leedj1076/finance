import { createElement } from 'react'

import { AiEvidencePopover, type AiEvidenceContext } from '@/features/budgets/ai-evidence'
import { PlanItem } from '@/features/budgets/plan-item'

const savedJobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const evidence: AiEvidenceContext = {
  jobId: savedJobId,
  completedAt: '2026-09-10T00:00:00Z',
  recommendation: {
    major: '식비',
    amount: 300_000,
    reason: '기록된 장보기 비용을 포함해 배정했습니다.',
    references: [],
    exceptional: [],
    reducible: [],
  },
  snapshot: {
    month: '2026-09',
    input: { month: '2026-09', notes: '', plannedExpenses: [], draftAmounts: [] },
    evidence: [],
    recurring: [],
  },
  promptInput: null,
}

export function SavedAiPlanItem() {
  return createElement(PlanItem, {
    currentRecommendation: null,
    draft: { major: '식비', amount: '310000', source: null, recommendationJobId: savedJobId },
    month: '2026-09',
    onChoose: () => {},
    onChooseAi: () => {},
    onEdit: () => {},
    onOpenEvidence: () => {},
    period: 'current',
    row: {
        major: '식비',
        group: 'variable',
        saved: { amount: 310_000, recommendationJobId: savedJobId, version: 'food-v1' },
        previousBudget: 330_000,
        actual: 100_000,
        previousActual: { amount: 320_000, month: '2026-08', partial: null },
        average3: { amount: 300_000, months: ['2026-06', '2026-07', '2026-08'], monthsWithSpend: 3, provisional: false },
    },
    savedEvidence: createElement(AiEvidencePopover, {
      context: evidence,
      onApplyChecked: () => {},
      onClose: () => {},
      trigger: '근거',
    }),
    savedRecommendation: { jobId: savedJobId, amount: 300_000, completedAt: '2026-09-10T00:00:00Z' },
  })
}

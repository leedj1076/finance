import { useState, useTransition, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import { BudgetForm } from '@/features/budgets/budget-form'
import type { BudgetActionState } from '@/features/budgets/actions'
import type { BudgetSaveRequest } from '@/features/budgets/save-contract'
import { makeBudgetReport, makeBudgetSnapshot } from '../../fixtures/budget-recommendation'
import { deferred, navigation, saves } from './budget-save-lifecycle-boundaries'

type Props = ComponentProps<typeof BudgetForm>
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function propsFor(month: string, origin = false): Props {
  const snapshot = makeBudgetSnapshot()
  snapshot.month = month
  snapshot.input.month = month
  const report = makeBudgetReport()
  return {
    averageExpense: 100_000, averageIncome: 1_000_000, currentSavingsRate: 90,
    month, savingsTarget: 30, targetVersion: 'target-v1', spendCeiling: 700_000,
    basis: snapshot.basis,
    baselines: [{ major: '식비', amount: 350_000, recommendationJobId: origin ? jobId : null, version: 'food-v1' }],
    rows: [{ major: '식비', group: 'variable', budget: 350_000, previousBudget: 330_000,
      actual: 100_000, average: 300_000, remaining: 250_000, percent: 29 }],
    savedRecommendations: origin ? [{ id: jobId, completedAt: '2026-09-10T00:00:00Z',
      snapshot, promptInput: null, report, evaluation: evaluateBudget(snapshot, report.rows) }] : [],
    review: { targetMonth: month, reviewMonth: '2026-08', completedMonths: [], rows: [], groups: [],
      reviewIncome: 1_000_000, reviewExpense: 100_000, reviewSaving: 0, reviewSavingsRate: 90,
      reviewBudgetTotal: 350_000, existingCount: 1, averageIncome: 1_000_000, savingsTarget: 30, spendCeiling: 700_000 },
  }
}

export type LifecycleHarness = {
  calls(): { previous: BudgetActionState; payload: BudgetSaveRequest }[]
  resolve(index: number, result?: BudgetActionState): void
  reject(index: number): void
  holdTransition(): void
  releaseTransition(): void
  mount(month: string, origin?: boolean, reuseEditor?: boolean): void
  unmount(): void
  lateProps(): void
  refreshes(): number
}
declare global { interface Window { budgetLifecycle: LifecycleHarness } }

let updateProps: (props: Props, reuse?: boolean) => void
let hideEditor: () => void
let hold: () => void
let release: () => void
let late: () => void

function Harness() {
  const [props, setProps] = useState(() => propsFor('2026-09'))
  const [editorKey, setEditorKey] = useState('2026-09')
  const [visible, setVisible] = useState(true)
  const [pending, startTransition] = useTransition()
  updateProps = (next, reuse) => { setProps(next); if (!reuse) setEditorKey(next.month); setVisible(true) }
  hideEditor = () => setVisible(false)
  late = () => setProps(previous => ({ ...previous, baselines: [...previous.baselines] }))
  hold = () => {
    const work = deferred<void>()
    release = () => work.resolve()
    startTransition(async () => { await work.promise })
  }
  return <>
    <output data-testid="independent-pending">{String(pending)}</output>
    {visible && <BudgetForm key={editorKey} {...props} />}
  </>
}

window.budgetLifecycle = {
  calls: () => saves.map(({ previous, payload }) => ({ previous, payload })),
  resolve: (index, result) => {
    const { payload, response } = saves[index]
    response.resolve(result ?? { saved: {
      rows: payload.changes.map(row => ({ major: row.major, amount: row.amount,
        recommendationJobId: row.recommendationJobId, version: `food-v${index + 2}` })),
      savingsTarget: payload.targetChange?.value ?? 30, targetVersion: `target-v${index + 2}`,
      total: payload.changes.reduce((sum, row) => sum + row.amount, 0), overage: 0,
    } })
  },
  reject: index => saves[index].response.reject(new Error('connection lost')),
  holdTransition: () => hold(), releaseTransition: () => release(),
  mount: (month, origin, reuse) => updateProps(propsFor(month, origin), reuse),
  unmount: () => hideEditor(), lateProps: () => late(), refreshes: () => navigation.refreshes,
}
createRoot(document.getElementById('root')!).render(<Harness />)

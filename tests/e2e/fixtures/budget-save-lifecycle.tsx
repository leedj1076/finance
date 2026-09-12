import { useState, useTransition, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'

import { evaluateBudget } from '@/features/budget-recommendations/calculations'
import type { CompletedBudgetRecommendation } from '@/features/budget-recommendations/types'
import { useBudgetRecommendation } from '@/features/budget-recommendations/use-recommendation'
import { AiEvidencePopover, AiSummaryPopover, type AiEvidenceContext } from '@/features/budgets/ai-evidence'
import { BudgetForm } from '@/features/budgets/budget-form'
import type { BudgetActionState } from '@/features/budgets/actions'
import type { BudgetSaveRequest } from '@/features/budgets/save-contract'
import { makeBudgetReport, makeBudgetSnapshot } from '../../fixtures/budget-recommendation'
import { deferred, navigation, saves } from './budget-save-lifecycle-boundaries'

type Props = ComponentProps<typeof BudgetForm>
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function completedRecommendation(month: string): CompletedBudgetRecommendation {
  const snapshot = makeBudgetSnapshot()
  snapshot.month = month
  snapshot.input.month = month
  const report = makeBudgetReport()
  return {
    id: jobId,
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    completedAt: '2026-09-10T00:00:00Z',
    snapshot,
    promptInput: null,
    report,
    evaluation: evaluateBudget(snapshot, report.rows),
  }
}

function propsFor(month: string, origin = false): Props {
  const snapshot = makeBudgetSnapshot()
  snapshot.month = month
  snapshot.input.month = month
  const report = makeBudgetReport()
  return {
    month, savingsTarget: 30, targetVersion: 'target-v1', spendCeiling: 700_000,
    basis: snapshot.basis,
    baselines: [{ major: '식비', amount: 350_000, recommendationJobId: origin ? jobId : null, version: 'food-v1' }],
    planRows: [{ major: '식비', group: 'variable', saved: {
      amount: 350_000, recommendationJobId: origin ? jobId : null, version: 'food-v1',
    }, previousBudget: 330_000, actual: 100_000,
    previousActual: { amount: 320_000, month: '2026-08', partial: null },
    average3: { amount: 300_000, months: ['2026-06', '2026-07', '2026-08'], monthsWithSpend: 3, provisional: false } }],
    savedRecommendations: origin ? [{ id: jobId, completedAt: '2026-09-10T00:00:00Z',
      snapshot, promptInput: null, report, evaluation: evaluateBudget(snapshot, report.rows) }] : [],
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

function AiControlsHarness() {
  const month = '2026-10'
  const completed = completedRecommendation(month)
  const [closed, setClosed] = useState({ evidence: 0, summary: 0 })
  const controller = useBudgetRecommendation({
    month,
    majors: ['식비'],
    basis: completed.snapshot.basis,
    targetDirty: false,
    getDraftAmounts: () => [{ major: '식비', amount: 350_000 }],
  })
  const evidence: AiEvidenceContext = {
    jobId: completed.id,
    completedAt: completed.completedAt,
    recommendation: completed.report.rows[0],
    snapshot: completed.snapshot,
    promptInput: completed.promptInput,
  }
  const retry = controller.hasAmbiguousRequest ? 'retry' : 'request'

  return (
    <main>
      <output data-testid="ai-ready">{String(controller.data !== null && !controller.recovering)}</output>
      <output data-testid="ai-submitting">{String(controller.submitting)}</output>
      <output data-testid="ai-ambiguous">{String(controller.hasAmbiguousRequest)}</output>
      <output data-testid="ai-cleanup">evidence:{closed.evidence};summary:{closed.summary}</output>
      <button disabled={controller.submitting || controller.data === null} onClick={() => void controller.generate()} type="button">AI controls: {retry}</button>
      <button onClick={() => void controller.recover()} type="button">AI controls: recover</button>
      <AiEvidencePopover
        context={evidence}
        onApplyChecked={() => {}}
        onClose={() => setClosed(value => ({ ...value, evidence: value.evidence + 1 }))}
        trigger="AI controls: evidence"
      />
      <AiSummaryPopover
        completed={completed}
        onClose={() => {
          controller.clearPrompt()
          setClosed(value => ({ ...value, summary: value.summary + 1 }))
        }}
        onShowPrompt={() => {}}
        trigger="AI controls: summary"
      />
    </main>
  )
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
const controlsMode = new URLSearchParams(window.location.search).get('mode') === 'ai-controls'
createRoot(document.getElementById('root')!).render(controlsMode ? <AiControlsHarness /> : <Harness />)

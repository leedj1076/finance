import { formatWon } from '@/lib/finance'

import type { getBudgetReviewData } from './review-queries'

type Review = Awaited<ReturnType<typeof getBudgetReviewData>>

export function BudgetReference({ review }: { review: Review }) {
  const difference = review.reviewExpense - review.reviewBudgetTotal
  return (
    <details className="group border-t border-finance-ink">
      <summary className="flex cursor-pointer list-none items-center justify-between py-4 t-section text-finance-ink">
        <span>지난달 돌아보기 <span className="ml-2 font-normal text-finance-muted">{review.reviewMonth} 예산과 실제 지출 비교</span></span>
        <span aria-hidden className="text-finance-muted group-open:rotate-180">⌄</span>
      </summary>
      <div className="pb-5">
        <div className="grid border-y border-finance-hairline sm:grid-cols-4 sm:divide-x sm:divide-finance-hairline">
          <div className="p-4"><p className="t-caption text-finance-muted">지난달 수입</p><p className="mt-1 t-kpi-sm text-finance-blue">{formatWon(review.reviewIncome)}원</p></div>
          <div className="p-4"><p className="t-caption text-finance-muted">지난달 지출</p><p className="mt-1 t-kpi-sm text-finance-red">{formatWon(review.reviewExpense)}원</p></div>
          <div className="p-4"><p className="t-caption text-finance-muted">지난달 저축</p><p className="mt-1 t-kpi-sm text-finance-green">{formatWon(review.reviewSaving)}원</p></div>
          <div className="p-4"><p className="t-caption text-finance-muted">예산 대비 실제</p><p className={`mt-1 t-kpi-sm ${difference > 0 ? 'text-finance-red' : 'text-finance-green'}`}>{difference > 0 ? '+' : ''}{formatWon(difference)}원</p></div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[700px] t-body">
            <thead className="border-b border-finance-hairline bg-finance-panel t-label uppercase text-finance-muted"><tr><th className="px-4 py-3 text-left font-medium">분류</th><th className="px-4 py-3 text-right font-medium">지난달 예산</th><th className="px-4 py-3 text-right font-medium">지난달 실제</th><th className="px-4 py-3 text-right font-medium">차이</th><th className="px-4 py-3 text-right font-medium">6개월 중앙값</th></tr></thead>
            <tbody className="divide-y divide-finance-hairline">{review.rows.map((row) => <tr key={row.major}><td className="px-4 py-3 font-medium text-finance-ink">{row.major}</td><td className="px-4 py-3 text-right text-finance-muted">{formatWon(row.previousBudget)}원</td><td className="px-4 py-3 text-right text-finance-ink">{formatWon(row.previousActual)}원</td><td className={`px-4 py-3 text-right ${row.difference > 0 ? 'text-finance-red' : 'text-finance-green'}`}>{row.difference > 0 ? '+' : ''}{formatWon(row.difference)}원</td><td className="px-4 py-3 text-right text-finance-muted">{formatWon(row.median)}원</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </details>
  )
}

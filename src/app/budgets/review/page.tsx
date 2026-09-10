import { permanentRedirect, redirect } from 'next/navigation'

import { budgetReviewDestination } from '@/features/budgets/review-redirect'
import { requireHousehold } from '@/lib/household'

type BudgetReviewPageProps = { searchParams: Promise<{ month?: string | string[] }> }

export default async function BudgetReviewPage({ searchParams }: BudgetReviewPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  permanentRedirect(budgetReviewDestination(params.month))
}

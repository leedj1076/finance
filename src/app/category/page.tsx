import { redirect } from 'next/navigation'

import { parseCategoryPageParams } from '@/features/analytics/category-page'

type CategoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CategoryRedirect({ searchParams }: CategoryPageProps) {
  const parsed = parseCategoryPageParams(await searchParams)
  if (parsed.period === 'year') {
    const params = new URLSearchParams({ year: String(parsed.year) })
    if (parsed.major) params.set('major', parsed.major)
    params.set('flow', parsed.flow)
    redirect(`/report?${params}#category-detail`)
  }

  const params = new URLSearchParams({
    month: parsed.month,
    tab: 'categories',
    flow: parsed.flow,
  })
  if (parsed.major) params.set('major', parsed.major)
  if (parsed.accountId) params.set('account', String(parsed.accountId))
  redirect(`/ledger?${params}`)
}

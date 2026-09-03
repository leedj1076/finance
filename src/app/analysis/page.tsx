import { redirect } from 'next/navigation'

type AnalysisPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AnalysisRedirect({ searchParams }: AnalysisPageProps) {
  const incoming = await searchParams
  const period = firstParam(incoming.period)
  const year = firstParam(incoming.year)
  if (period === 'year' || (year && !firstParam(incoming.month))) {
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    redirect(`/report${params.size ? `?${params}` : ''}`)
  }

  const params = new URLSearchParams({ tab: 'summary' })
  const month = firstParam(incoming.month)
  const flow = firstParam(incoming.flow)
  const account = firstParam(incoming.account)
  if (month) params.set('month', month)
  if (flow) params.set('flow', flow)
  if (account) params.set('account', account)
  redirect(`/ledger?${params}`)
}

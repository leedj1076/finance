import { MONTH_STATE_LABELS, type MonthStatus } from './state'

export function MonthStatusLabel({ status }: { status: MonthStatus }) {
  return <span className={`inline-flex items-center gap-1.5 t-caption ${status.state === 'closed' ? 'text-finance-green' : 'text-finance-amber'}`}>
    <span aria-hidden className={`h-1.5 w-1.5 ${status.state === 'closed' ? 'bg-finance-green' : 'bg-finance-amber'}`} />
    {status.month} · {MONTH_STATE_LABELS[status.state]}{status.state !== 'closed' && ' · 잠정 내역 기준'}
  </span>
}

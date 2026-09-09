import { MONTH_STATE_LABELS, type MonthStatus } from './state'

type Tone = 'amber' | 'green' | 'red' | 'faint'

const TONE_CLASS: Record<Tone, string> = {
  amber: 'text-finance-amber',
  green: 'text-finance-green',
  red: 'text-finance-red',
  faint: 'text-finance-faint',
}

const TITLE: Record<Tone, string> = {
  amber: '마감 전이라 통계의 평균·비교에는 들어가지 않습니다.',
  green: '이 달의 숫자는 통계에서 확정 값으로 계산됩니다.',
  red: '마감 뒤 내역이 바뀌어 통계에서 잠정 값으로 돌아갔습니다. 다시 마감하면 확정됩니다.',
  faint: '아직 오지 않은 달입니다.',
}

function monthWords(month: string) {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`
}

function shortDate(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(iso))
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${Number(month)}/${Number(day)}`
}

/** One vocabulary for every month-scoped heading. */
export function monthStatusText(
  status: MonthStatus,
  currentMonthKey: string,
  elapsed?: { day: number; days: number },
): { text: string; tone: Tone } {
  const words = monthWords(status.month)
  if (status.month > currentMonthKey) return { text: `${words} · 예정`, tone: 'faint' }
  if (status.month === currentMonthKey) {
    return { text: `${words} · 진행 중${elapsed ? ` · ${elapsed.day}일 경과 / ${elapsed.days}일` : ''}`, tone: 'amber' }
  }
  if (status.state === 'closed') {
    return { text: `${words} · 마감${status.closedAt ? ` · ${shortDate(status.closedAt)} 확정` : ''}`, tone: 'green' }
  }
  if (status.state === 'needs_review') return { text: `${words} · 재확인 필요 · 마감 뒤 내역 변경`, tone: 'red' }
  return { text: `${words} · 미마감 · 잠정`, tone: 'amber' }
}

export function MonthStatusLabel({
  status,
  variant = 'compact',
  currentMonthKey,
  elapsed,
}: {
  status: MonthStatus
  variant?: 'compact' | 'heading'
  currentMonthKey?: string
  elapsed?: { day: number; days: number }
}) {
  if (variant === 'heading' && currentMonthKey) {
    const { text, tone } = monthStatusText(status, currentMonthKey, elapsed)
    return <span className={`inline-flex items-center gap-1.5 t-caption font-medium ${TONE_CLASS[tone]}`} title={TITLE[tone]}>
      <span aria-hidden className="h-[7px] w-[7px] bg-current" />
      {text}
    </span>
  }

  const tone = status.state === 'closed' ? 'green' : status.state === 'needs_review' ? 'red' : 'amber'
  return <span
    className={`inline-flex items-center gap-1.5 t-caption ${TONE_CLASS[tone]}`}
    title={status.state === 'needs_review' ? TITLE.red : undefined}
  >
    <span aria-hidden className="h-1.5 w-1.5 bg-current" />
    {status.month} · {MONTH_STATE_LABELS[status.state]}{status.state !== 'closed' && ' · 잠정 내역 기준'}
  </span>
}

export function YearStatusLabel({
  year,
  closedMonths,
  provisionalMonths,
}: {
  year: number
  closedMonths: number[]
  provisionalMonths: number[]
}) {
  const list = provisionalMonths.length > 0 ? ` (${provisionalMonths.join('·')}월)` : ''
  return <span
    className="inline-flex items-center gap-1.5 t-caption font-medium text-finance-green"
    title="마감 월은 확정 값으로, 미마감 월은 회색 잠정 값으로 계산합니다."
  >
    <span aria-hidden className="h-[7px] w-[7px] bg-current" />
    {year}년 · 마감 {closedMonths.length}개월 · 잠정 {provisionalMonths.length}개월{list}
  </span>
}

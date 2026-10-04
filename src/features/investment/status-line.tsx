import type { StatusLine } from './queries'

const timeKST = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
const dateTimeKST = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })
const rate = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function StatusLineView({ status }: { status: StatusLine }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-finance-border py-2 t-caption text-finance-muted">
      <span>{status.quotedAt ? <>시세 <strong className="text-finance-ink">{timeKST.format(new Date(status.quotedAt))}</strong> 기준</> : '시세 없음'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span>{status.fx ? <>USDKRW <strong className="text-finance-ink">{rate.format(status.fx.rate)}</strong> ({status.fx.date.slice(5)})</> : '환율 없음 · 해외 미포함'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span>{status.lastSyncedAt ? <>마지막 동기화 <strong className="text-finance-ink">{dateTimeKST.format(new Date(status.lastSyncedAt))}</strong></> : '동기화 전'}</span>
      <span aria-hidden className="text-finance-faint">·</span>
      <span className="inline-flex items-center gap-1.5">로컬 워커 <span aria-hidden className={`inline-block h-[7px] w-[7px] ${status.workerConnected ? 'bg-finance-green' : 'bg-finance-faint'}`} />{status.workerConnected ? '연결됨' : '연결 안 됨'}</span>
      <button className="ml-auto h-[30px] border border-finance-border px-3 t-caption-strong text-finance-muted disabled:opacity-40" disabled title="키움 연동은 2단계에서 연결됩니다" type="button">지금 동기화</button>
    </div>
  )
}

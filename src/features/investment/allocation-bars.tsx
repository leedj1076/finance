export function AllocationBars({ items, warnAbove }: { items: Array<{ label: string; pct: number }>; warnAbove?: number }) {
  const largest = Math.max(...items.filter(i => Number.isFinite(i.pct)).map((i) => i.pct), 0)
  return (
    <div className="mt-4">
      {items.map((item) => {
        const known = Number.isFinite(item.pct)
        const width = known ? Math.max(0, Math.min(100, item.pct)) : 0
        const warn = warnAbove !== undefined && item.pct === largest && item.pct > warnAbove
        return (
          <div className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3 py-1.5 t-body" key={item.label}>
            <span className="text-finance-muted">{item.label}</span>
            <span aria-label={item.label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={known ? Math.round(width * 10) / 10 : undefined} className="block h-2 bg-finance-track" role="progressbar">
              <span className={`block h-full ${warn ? 'bg-finance-amber' : 'bg-finance-ink'}`} style={{ width: `${width}%` }} />
            </span>
            <span className="text-right tabular-nums text-finance-ink">{known ? `${item.pct.toFixed(1)}%` : '–'}</span>
          </div>
        )
      })}
    </div>
  )
}

import type { ReactNode } from 'react'

export type KpiItem = { label: string; value: ReactNode; tone?: 'ink' | 'blue' | 'red' | 'amber'; caption?: ReactNode }

const TONE = { ink: 'text-finance-ink', blue: 'text-finance-blue', red: 'text-finance-red', amber: 'text-finance-amber' } as const

export function KpiBand({ items }: { items: KpiItem[] }) {
  return (
    <section className="kpi-band investment-kpi-band mt-7 grid grid-cols-2 border-y border-finance-ink" aria-label="요약">
      {items.map((item) => (
        <article className="py-5" key={item.label}>
          <p className="t-label uppercase text-finance-muted">{item.label}</p>
          <p className={`mt-2 t-kpi tabular-nums ${TONE[item.tone ?? 'ink']}`}>{item.value}</p>
          {item.caption && <p className="mt-2 t-caption text-finance-muted">{item.caption}</p>}
        </article>
      ))}
    </section>
  )
}

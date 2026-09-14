import Link from 'next/link'

import { formatWon } from '@/lib/finance'

import type { CellTransactionResult } from './category-detail'

const MAX_ITEMS = 15

export function CellTransactionTooltip({
  major,
  sub,
  month,
  data,
  ledgerHref,
}: {
  major: string
  sub: string | null
  month: number
  data: CellTransactionResult
  ledgerHref: string
}) {
  return (
    <>
      <div className="border-b border-finance-border pb-2">
        <p className="font-semibold text-white">{sub ? `${major} › ${sub}` : major} · {month}월</p>
        <p className="mt-0.5 t-caption text-finance-faint">{data.items.length}건 · {formatWon(data.total)}원</p>
      </div>
      <div className="divide-y divide-finance-border">
        {data.items.slice(0, MAX_ITEMS).map((item, index) => (
          <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 py-2 t-caption" key={`${item.date}-${item.name}-${item.amount}-${index}`}>
            <span className="text-finance-faint">{item.date.slice(5).replace('-', '/')}</span>
            <span className="min-w-0 truncate text-finance-faint">{item.name}{item.acct && <span className="ml-1">{item.acct}</span>}</span>
            <span className="font-medium tabular-nums text-white">{formatWon(item.amount)}</span>
          </div>
        ))}
        {data.items.length === 0 && <p className="py-4 text-center t-body text-finance-faint">내역 없음</p>}
      </div>
      <Link className="mt-3 block border-t border-finance-border pt-2 text-right t-caption font-semibold text-white hover:text-finance-blue" href={ledgerHref}>
        이 달 거래 보기 →
      </Link>
    </>
  )
}

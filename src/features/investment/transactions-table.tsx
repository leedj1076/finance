import { formatMoney, formatSigned } from './format'
import { MarketChip } from './market-chip'
import type { TransactionListRow } from './queries'
import { TransactionRowControls } from './transaction-row-controls'
import { KIND_LABELS } from './types'

const KIND_TINT: Record<TransactionListRow['kind'], string> = {
  buy: 'bg-finance-blue-tint text-finance-blue', sell: 'bg-finance-red-tint text-finance-red', dividend: 'bg-finance-green-tint text-finance-green',
  deposit: 'bg-finance-track text-finance-muted', withdraw: 'bg-finance-track text-finance-muted', fee: 'bg-finance-track text-finance-muted', adjust: 'bg-finance-amber-tint text-finance-amber',
}
const cell = 'px-3 py-3 text-right tabular-nums whitespace-nowrap'
const hide = 'hidden sm:table-cell'

export function TransactionsTable({ rows }: { rows: TransactionListRow[] }) {
  if (rows.length === 0) return <p className="mt-4 border-t border-finance-border py-5 t-body text-finance-muted">이 달 거래가 없습니다.</p>
  return (
    <div className="mt-4 overflow-x-auto border-t border-finance-ink">
      <table className="w-full t-body">
        <thead className="border-b border-finance-border t-label uppercase text-finance-muted">
          <tr>
            <th className="py-2.5 text-left">날짜</th><th className="px-3 py-2.5 text-left">종류</th><th className="px-3 py-2.5 text-left">시장 · 종목</th>
            <th className={`px-3 py-2.5 text-left ${hide}`}>계좌</th><th className={`px-3 py-2.5 text-right ${hide}`}>수량</th><th className={`px-3 py-2.5 text-right ${hide}`}>단가</th>
            <th className="px-3 py-2.5 text-right">금액</th><th className={`px-3 py-2.5 text-right ${hide}`}>실현손익</th><th className={`px-3 py-2.5 text-left ${hide}`}>출처</th><th className="py-2.5 pl-3 text-left"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-finance-track">
          {rows.map((row) => {
            const market = row.security?.market ?? (row.currency === 'USD' ? 'US' : 'KR')
            return (
              <tr key={row.id}>
                <td className="py-3 pr-3 tabular-nums">{row.tradeDate.slice(5)}</td>
                <td className="px-3 py-3"><span className={`inline-flex h-[18px] items-center px-1.5 t-badge ${KIND_TINT[row.kind]}`}>{KIND_LABELS[row.kind]}</span></td>
                <td className="px-3 py-3"><MarketChip market={market} />{row.security ? <strong className="text-finance-ink">{row.security.name}</strong> : <span className="text-finance-faint">{row.currency === 'USD' ? '달러 예수금' : '원화 예수금'}</span>}</td>
                <td className={`px-3 py-3 text-finance-muted ${hide}`}>{row.accountName}</td>
                <td className={`${cell} ${hide}`}>{row.quantity ?? '–'}</td>
                <td className={`${cell} ${hide}`}>{row.price === null ? '–' : formatMoney(row.price, row.currency)}</td>
                <td className={`${cell} ${row.amount === 0 ? 'text-finance-faint' : 'text-finance-ink'}`}>{row.amount === 0 ? '–' : formatSigned(row.amount, row.currency)}</td>
                <td className={`${cell} ${hide} ${row.realized === null ? 'text-finance-faint' : row.realized >= 0 ? 'text-finance-blue' : 'text-finance-red'}`}>{row.realized === null ? row.kind === 'sell' ? '단가 없음' : '–' : formatSigned(row.realized, row.currency)}</td>
                <td className={`px-3 py-3 text-finance-muted ${hide}`}>{row.source === 'kiwoom' ? '키움' : '수동'}{row.memo && <span className="ml-2 text-finance-faint">· {row.memo}</span>}</td>
                <td className="py-3 pl-3"><TransactionRowControls editable={row.editable} id={row.id} memo={row.memo}
                  description={`${row.tradeDate} · ${row.accountName} · ${row.security?.name ?? '예수금'} · ${KIND_LABELS[row.kind]}${row.quantity === null ? '' : ` ${row.quantity}주`} · ${formatSigned(row.amount, row.currency)} ${row.currency}`} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

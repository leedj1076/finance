'use client'

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'

import { aggregateByMarket } from './calculations'
import { formatMoney, formatPct, formatSigned } from './format'
import { MarketChip } from './market-chip'
import type { AccountGroup, HoldingRow } from './queries'
import type { FxRow, Market } from './types'

function useCollapsed(householdId: string) {
  const storageKey = `investment-collapsed:${householdId}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      setCollapsed(new Set(Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : []))
    } catch { setCollapsed(new Set()) }
  }, [storageKey])
  function toggle(key: string) {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* Storage may be disabled. */ }
      return next
    })
  }
  return { collapsed, toggle }
}

const cell = 'px-3 py-3 text-right tabular-nums whitespace-nowrap'
const hide = 'investment-desktop-cell'
const tone = (value: number | null) => value === null ? 'text-finance-faint' : value > 0 ? 'text-finance-blue' : value < 0 ? 'text-finance-red' : 'text-finance-ink'
const caret = (open: boolean) => <span aria-hidden className={`ml-auto shrink-0 text-finance-faint transition-transform ${open ? '' : '-rotate-90'}`}>⌄</span>

function Row({ row }: { row: HoldingRow }) {
  const [open, setOpen] = useState(false)
  const c = row.currency
  const money = (value: number | null) => value === null ? '–' : formatMoney(value, c)
  const name = <>{row.security.name}<span className="t-caption font-normal text-finance-faint">{row.security.symbol}</span>{row.discrepancy && <span aria-hidden className="inline-block h-[7px] w-[7px] bg-finance-amber" />}</>
  return <>
    <tr className="border-b border-finance-track hover:bg-finance-track">
      <td className="py-3 pr-3">
        <Link className="investment-desktop-security items-center flex-wrap gap-x-2 gap-y-1 t-body-strong text-finance-ink" href={`/investment/${row.securityId}`}>{name}</Link>
        <button aria-expanded={open} aria-label={`${row.security.name} 보유 상세`} className="investment-mobile-security min-h-[30px] w-full flex-wrap items-center gap-x-2 gap-y-1 text-left t-body-strong text-finance-ink" onClick={() => setOpen(!open)} type="button">{name}</button>
        {row.priceSource !== 'quote' && <span className="t-caption text-finance-faint">{row.priceSource === 'close' ? '종가 기준' : '시세 없음'}</span>}
        {row.discrepancy && <p className="mt-1 t-caption text-finance-muted">{row.discrepancy.qtyDiffers ? `수량이 증권사(${row.discrepancy.brokerQty})와 다름` : `증권사 값과 ${row.discrepancy.avgDiffPct!.toFixed(1)}% 차이`}</p>}
      </td>
      <td className={`${cell} ${hide}`}>{row.quantity}</td>
      <td className={`${cell} ${hide}`}>{money(row.avgCost)}</td>
      <td className={`${cell} ${hide}`}>{money(row.price)}</td>
      <td className={`${cell} ${hide}`}>{money(row.marketValue)}</td>
      <td className={`${cell} ${tone(row.unrealized)}`}>{row.unrealized === null ? '–' : formatSigned(row.unrealized, c)}</td>
      <td className={`${cell} ${tone(row.returnPct)}`}>{formatPct(row.returnPct)}</td>
      <td className={`${cell} ${hide} pr-0`}>{row.weightPct === null ? '–' : <span className="inline-grid grid-cols-[44px_40px] items-center gap-1.5"><span className="relative block h-[5px] bg-finance-track"><span className="absolute inset-y-0 left-0 bg-finance-ink" style={{ width: `${Math.max(0, Math.min(100, row.weightPct * 4))}%` }} /></span><span>{row.weightPct.toFixed(1)}%</span></span>}</td>
    </tr>
    {open && <tr className="investment-mobile-detail border-b border-finance-border bg-finance-panel"><td colSpan={8} className="py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 t-caption">
        {[['수량', `${row.quantity}주`], ['비중', row.weightPct === null ? '–' : `${row.weightPct.toFixed(1)}%`], ['평균단가', money(row.avgCost)], ['현재가', money(row.price)], ['평가금액', money(row.marketValue)], ...(row.discrepancy ? [['증권사 수량', `${row.discrepancy.brokerQty}주`], ['증권사 평균단가', money(row.discrepancy.brokerAvg)]] : [])].map(([label, value]) => <div className="flex justify-between gap-2" key={label}><dt className="text-finance-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
      </dl>
      <Link className="mt-3 inline-block t-caption-strong text-finance-blue" href={`/investment/${row.securityId}`}>종목 상세 →</Link>
    </td></tr>}
  </>
}

export function HoldingsTable({ groups, fx, householdId, market = 'all' }: { groups: AccountGroup[]; fx: FxRow | null; householdId: string; market?: Market | 'all' }) {
  const { collapsed, toggle } = useCollapsed(householdId)
  const rows = groups.flatMap(g => g.markets.flatMap(m => m.rows))
  const cash = groups.flatMap(g => [{ accountId: g.account.id, currency: 'KRW' as const, amount: g.cashKRW }, { accountId: g.account.id, currency: 'USD' as const, amount: g.cashUSD }])
  const summary = aggregateByMarket(rows, cash, fx)
  const includedRows = rows.filter(row => row.currency === 'KRW' || fx !== null)
  const totalCost = summary.KR.cost + (fx ? summary.US.cost * fx.rate : 0)
  const priced = (items: HoldingRow[]) => items.every(row => row.marketValue !== null)
  const profitKnown = (items: HoldingRow[]) => items.every(row => row.unrealized !== null)
  const footer = (label: string, value: number | null, unrealized: number | null, rate: number | null, currency: 'KRW' | 'USD', caption?: string) => <tr className="border-t border-finance-border t-body-strong" key={label}>
    <th className={`py-3 text-left ${hide}`} colSpan={4}>{label}{caption && <span className="ml-1 t-caption font-normal text-finance-muted"> · {caption}</span>}</th>
    <th className="investment-mobile-cell py-3 text-left">{label}{caption && <span className="block t-caption font-normal text-finance-muted">{caption}</span>}</th>
    <td className={`${cell} ${hide}`}>{value === null ? '–' : formatMoney(value, currency)}</td>
    <td className={`${cell} ${tone(unrealized)}`}>{unrealized === null ? '–' : formatSigned(unrealized, currency)}</td>
    <td className={`${cell} ${tone(rate)}`}>{formatPct(rate)}</td>
    <td className={`${cell} ${hide} pr-0`}>{priced(includedRows) && value !== null && summary.totalKRW > 0 && (currency === 'KRW' || fx) ? `${((currency === 'USD' ? value * fx!.rate : value) / summary.totalKRW * 100).toFixed(1)}%` : '–'}</td>
  </tr>
  return <div className="mt-4 border-t border-finance-ink">
    <table className="investment-holdings w-full t-body">
      <colgroup>{['30%', '8%', '10%', '10%', '12%', '11%', '9%', '10%'].map((width, i) => <col className={i >= 1 && i <= 4 || i === 7 ? hide : ''} style={{ width }} key={i} />)}</colgroup>
      <thead className="border-b border-finance-border t-label uppercase text-finance-muted"><tr>
        {['종목', '수량', '평균단가', '현재가', '평가금액', '평가손익', '수익률', '비중'].map((label, i) => <th className={`py-2.5 ${i === 0 ? 'text-left' : 'px-3 text-right'} ${i >= 1 && i <= 4 || i === 7 ? hide : ''}`} key={label}>{label}</th>)}
      </tr></thead>
      <tbody>{groups.map(group => {
        const accountKey = `a${group.account.id}`
        const accountOpen = !collapsed.has(accountKey)
        const visibleMarkets = group.markets.filter(m => market === 'all' || m.market === market)
        if (market !== 'all' && !visibleMarkets.length) return null
        return <Fragment key={accountKey}>
          <tr className="border-b border-finance-border bg-finance-panel hover:bg-finance-track"><td colSpan={8}>
            <button aria-expanded={accountOpen} className="flex min-h-[34px] w-full items-center gap-2 py-2 text-left t-body-strong text-finance-ink" onClick={() => toggle(accountKey)} type="button">
              <span>{group.account.name}<span className="ml-2.5 t-caption font-medium text-finance-muted">····{group.account.brokerAccountNo.slice(-4)}{visibleMarkets.map(m => <span key={m.market}> · {m.market === 'KR' ? '국내' : '해외'} {priced(m.rows) ? formatMoney(m.value, m.market === 'KR' ? 'KRW' : 'USD') : '시세 없음'}</span>)} · 예수금 ₩{formatMoney(group.cashKRW, 'KRW')} / {formatMoney(group.cashUSD, 'USD')}</span></span>{caret(accountOpen)}
            </button>
          </td></tr>
          {accountOpen && visibleMarkets.map(m => {
            const key = `${accountKey}-${m.market}`
            const open = !collapsed.has(key)
            const c = m.market === 'KR' ? 'KRW' : 'USD'
            return <Fragment key={key}>
              <tr className="border-b border-finance-track hover:bg-finance-track"><td colSpan={8}>
                <button aria-expanded={open} className="flex min-h-[30px] w-full items-center gap-2 py-1.5 text-left t-caption text-finance-muted" onClick={() => toggle(key)} type="button">
                  <span><MarketChip market={m.market} />{m.count}종목 · {priced(m.rows) ? formatMoney(m.value, c) : '시세 없음'} · <span className={tone(m.unrealized)}>{profitKnown(m.rows) ? formatSigned(m.unrealized, c) : '–'} · {profitKnown(m.rows) ? formatPct(m.returnPct) : '–'}</span>{m.market === 'US' && (m.valueKRW !== null && priced(m.rows) ? <> · ₩{formatMoney(m.valueKRW, 'KRW')} 환산</> : <> · {fx ? '시세 없음' : '환율 없음'}</>)}</span>{caret(open)}
                </button>
              </td></tr>
              {open && m.rows.map(row => <Row key={`${row.accountId}-${row.securityId}`} row={row} />)}
            </Fragment>
          })}
        </Fragment>
      })}</tbody>
      <tfoot>
        {(['KR', 'US'] as const).filter(key => market === 'all' || market === key).map(key => {
          const items = rows.filter(row => row.market === key)
          return footer(key === 'KR' ? '국내 합계' : '해외 합계', priced(items) ? summary[key].value : null, profitKnown(items) ? summary[key].unrealized : null, profitKnown(items) ? summary[key].returnPct : null, key === 'KR' ? 'KRW' : 'USD', key === 'US' && fx && priced(items) ? `₩${formatMoney(summary.US.value * fx.rate, 'KRW')} 환산` : undefined)
        })}
        {market === 'all' && footer('합계 (원화 환산)', priced(includedRows) ? summary.totalKRW : null, profitKnown(includedRows) ? summary.totalUnrealizedKRW : null, totalCost > 0 && profitKnown(includedRows) ? summary.totalUnrealizedKRW / totalCost * 100 : null, 'KRW', `예수금 포함${summary.fxMissing ? ' · 환율 없음 · 해외 미포함' : ''}${priced(includedRows) ? '' : ' · 시세 없음'}`)}
      </tfoot>
    </table>
    {fx === null && <p className="mt-2 t-caption text-finance-faint">환율이 없어 해외 소계의 원화 환산과 비중은 비어 있습니다.</p>}
  </div>
}

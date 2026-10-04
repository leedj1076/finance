import { MARKET_LABELS, type Market } from './types'

export function MarketChip({ market }: { market: Market }) {
  return <span className={`mk ${market === 'US' ? 'us' : ''}`}>{MARKET_LABELS[market]}</span>
}

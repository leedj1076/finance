export type Market = 'KR' | 'US'
export type Currency = 'KRW' | 'USD'
export type TransactionKind = 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdraw' | 'fee' | 'adjust'
export type TransactionSource = 'kiwoom' | 'manual'
export type WeightBasis = 'total_assets' | 'stock_accounts'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'
export type ResearchKind = 'security' | 'portfolio' | 'discover'
export type ResearchMode = 'quarterly' | 'monthly' | 'event'
export type SyncKind = 'account' | 'snapshot'

export const TRANSACTION_KINDS: readonly TransactionKind[] = ['buy', 'sell', 'dividend', 'deposit', 'withdraw', 'fee', 'adjust']
export const CASH_KINDS: readonly TransactionKind[] = ['deposit', 'withdraw', 'fee']
export const MARKET_CURRENCY: Record<Market, Currency> = { KR: 'KRW', US: 'USD' }

export const KIND_LABELS: Record<TransactionKind, string> = {
  buy: '매수', sell: '매도', dividend: '배당', deposit: '입금', withdraw: '출금', fee: '수수료', adjust: '정정',
}
export const MARKET_LABELS: Record<Market, string> = { KR: '국내', US: '해외' }

/** 계산 모듈이 받는 거래 행. DB의 numeric은 문자열로 오므로 여기서는 이미 number다. */
export type TransactionRow = {
  id: number
  accountId: number
  securityId: number | null
  kind: TransactionKind
  tradeDate: string
  quantity: number | null
  price: number | null
  fee: number
  amount: number
  currency: Currency
  source: TransactionSource
}

export type SecurityRow = {
  id: number
  market: Market
  symbol: string
  name: string
  currency: Currency
  exposureCurrency: Currency
  sector: string | null
  watching: boolean
}

export type AccountRow = {
  id: number
  owner: string
  name: string
  brokerAccountNo: string
  active: boolean
  lastSyncedAt: string | null
}

export type QuoteRow = { securityId: number; price: number; changeRate: number | null; quotedAt: string }
export type FxRow = { date: string; rate: number }
export type BrokerPositionRow = { accountId: number; securityId: number; quantity: number; avgCost: number; syncedAt: string }

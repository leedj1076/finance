import { CASH_KINDS, TRANSACTION_KINDS, type Currency, type Market, type TransactionKind } from './types'

export type ManualTransactionInput = {
  accountId: number
  securityId: number | null
  kind: TransactionKind
  tradeDate: string
  quantity: number | null
  price: number | null
  fee: number
  amount: number
  currency: Currency
  memo: string | null
}

type Context = {
  accountIds: number[]
  securities: Array<{ id: number; market: Market; currency: Currency }>
  today: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const round2 = (n: number) => Math.round(n * 100) / 100

function text(data: FormData, key: string) {
  const value = data.get(key)
  return typeof value === 'string' ? value.trim() : ''
}
function num(data: FormData, key: string) {
  const raw = text(data, key)
  if (raw === '') return null
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return Number.NaN
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : Number.NaN
}
function decimals(data: FormData, key: string) {
  return text(data, key).split('.')[1]?.length ?? 0
}
function safe(value: number, scale: number) {
  return Number.isFinite(value) && Math.abs(value) * 10 ** scale <= Number.MAX_SAFE_INTEGER
}

export function parseManualTransaction(data: FormData, context: Context): { data: ManualTransactionInput } | { error: string } {
  const accountId = num(data, 'accountId')
  if (accountId === null || !Number.isSafeInteger(accountId) || !context.accountIds.includes(accountId)) return { error: '이 가구에 없는 계좌입니다.' }

  const kind = text(data, 'kind') as TransactionKind
  if (!TRANSACTION_KINDS.includes(kind)) return { error: '거래 종류가 올바르지 않습니다.' }

  const tradeDate = text(data, 'tradeDate')
  if (!DATE.test(tradeDate) || !Number.isFinite(Date.parse(tradeDate)) || new Date(tradeDate).toISOString().slice(0, 10) !== tradeDate || tradeDate > context.today || tradeDate < '1990-01-01') return { error: '거래 날짜는 1990-01-01부터 오늘까지만 가능합니다.' }

  const memoRaw = text(data, 'memo')
  if (memoRaw.length > 200) return { error: '메모는 200자까지입니다.' }
  const memo = memoRaw === '' ? null : memoRaw

  const isCash = CASH_KINDS.includes(kind)
  const securityIdRaw = num(data, 'securityId')
  const security = isCash || securityIdRaw === null ? null : context.securities.find((s) => s.id === securityIdRaw) ?? null
  if (!isCash && !security) return { error: '이 가구에 없는 종목입니다.' }

  const currencyRaw = text(data, 'currency')
  const currency: Currency | null = security ? security.currency : currencyRaw === 'KRW' || currencyRaw === 'USD' ? currencyRaw : null
  if (currency === null) return { error: '통화는 KRW 또는 USD여야 합니다.' }
  if (security && currencyRaw !== '' && currencyRaw !== security.currency) return { error: `이 종목의 통화는 ${security.currency}입니다.` }

  const fee = num(data, 'fee') ?? 0
  if (!safe(fee, 2) || fee < 0 || decimals(data, 'fee') > 2) return { error: '수수료는 0 이상이어야 합니다.' }

  if (kind === 'buy' || kind === 'sell') {
    const quantity = num(data, 'quantity')
    const price = num(data, 'price')
    if (quantity === null || Number.isNaN(quantity) || quantity <= 0) return { error: '수량은 0보다 커야 합니다.' }
    if (decimals(data, 'quantity') > 6 || !safe(quantity, 6)) return { error: '수량은 소수 6자리까지입니다.' }
    if (price === null || !safe(price, 4) || price < 0 || decimals(data, 'price') > 4) return { error: '단가는 0 이상이어야 합니다.' }
    const gross = round2(quantity * price)
    const amount = kind === 'buy' ? -round2(gross + fee) : round2(gross - fee)
    if (!safe(amount, 2)) return { error: '계산한 금액이 안전한 처리 범위를 넘습니다.' }
    return { data: { accountId, securityId: security!.id, kind, tradeDate, quantity, price, fee, amount: amount || 0, currency, memo } }
  }

  if (kind === 'adjust') {
    const quantity = num(data, 'quantity')
    const price = num(data, 'price')
    if (quantity === null || Number.isNaN(quantity)) return { error: '정정 수량을 입력하세요(±).' }
    if (decimals(data, 'quantity') > 6 || !safe(quantity, 6)) return { error: '수량은 소수 6자리까지입니다.' }
    if (price !== null && (!safe(price, 4) || price < 0 || decimals(data, 'price') > 4)) return { error: '정정 후 단가는 0 이상이어야 합니다.' }
    return { data: { accountId, securityId: security!.id, kind, tradeDate, quantity, price, fee: 0, amount: 0, currency, memo } }
  }

  const amountRaw = num(data, 'amount')
  if (amountRaw === null || !safe(amountRaw, 2) || amountRaw === 0 || decimals(data, 'amount') > 2) return { error: '금액은 0이 아니어야 합니다.' }
  const magnitude = round2(Math.abs(amountRaw))
  const amount = kind === 'withdraw' || kind === 'fee' ? -magnitude : magnitude
  return { data: { accountId, securityId: kind === 'dividend' ? security!.id : null, kind, tradeDate, quantity: null, price: null, fee: 0, amount, currency, memo } }
}

'use server'

import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { investmentAccounts, investmentSecurities, investmentTransactions } from '@/db/schema'
import { requireHousehold } from '@/lib/household'
import { revalidateFinance } from '@/lib/revalidate'

import { parseManualTransaction } from './transaction-input'
import { MARKET_CURRENCY, type Market, type WeightBasis } from './types'

export type ActionState = { error?: string; message?: string; saved?: { id: number } }

const NO_HOUSEHOLD = '가족 가계부에 연결된 계정이 아닙니다.'
const text = (data: FormData, key: string) => { const v = data.get(key); return typeof v === 'string' ? v.trim() : '' }
const todayInKorea = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())

export async function saveInvestmentAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id') || 0)
  const owner = text(formData, 'owner'); const name = text(formData, 'name')
  const brokerAccountNo = text(formData, 'brokerAccountNo'); const credentialRef = text(formData, 'credentialRef')
  const active = id === 0 ? true : formData.get('active') === 'on'
  if (!Number.isSafeInteger(id) || id < 0) return { error: '계좌 ID가 올바르지 않습니다.' }
  if (!owner || owner.length > 20) return { error: '소유자는 1~20자입니다.' }
  if (!name || name.length > 60) return { error: '계좌 이름은 1~60자입니다.' }
  if (!/^[0-9-]{4,20}$/.test(brokerAccountNo)) return { error: '계좌번호는 숫자와 하이픈 4~20자입니다.' }
  if (!/^[a-z0-9-]{2,40}$/.test(credentialRef)) return { error: '키체인 항목 이름은 소문자·숫자·하이픈 2~40자입니다.' }
  const values = { owner, name, brokerAccountNo, credentialRef, active, updatedAt: new Date() }
  try {
    if (id > 0) {
      const updated = await db.update(investmentAccounts).set(values).where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.householdId, household.householdId))).returning({ id: investmentAccounts.id })
      if (updated.length === 0) return { error: '이 가구에 없는 계좌입니다.' }
      revalidateFinance('investment')
      return { saved: { id }, message: '계좌를 저장했습니다.' }
    }
    const [row] = await db.insert(investmentAccounts).values({ householdId: household.householdId, ...values }).returning({ id: investmentAccounts.id })
    revalidateFinance('investment')
    return { saved: { id: row.id }, message: '계좌를 추가했습니다.' }
  } catch (error) {
    if (error && typeof error === 'object' && 'cause' in error && error.cause && typeof error.cause === 'object' && 'code' in error.cause && error.cause.code === '23505') return { error: '이미 등록된 계좌번호입니다.' }
    throw error
  }
}

export async function addWatchSecurity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const market = text(formData, 'market') as Market
  if (market !== 'KR' && market !== 'US') return { error: '시장은 KR 또는 US입니다.' }
  const symbol = text(formData, 'symbol').toUpperCase()
  if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) return { error: '종목코드는 영문 대문자·숫자·점 1~12자입니다.' }
  const name = text(formData, 'name') || symbol
  const currency = MARKET_CURRENCY[market]
  if (name.length > 100) return { error: '종목 이름은 100자까지입니다.' }
  const [row] = await db.insert(investmentSecurities)
    .values({ householdId: household.householdId, market, symbol, name, currency, exposureCurrency: currency, watching: true })
    .onConflictDoUpdate({
      target: [investmentSecurities.householdId, investmentSecurities.market, investmentSecurities.symbol],
      set: { watching: true, updatedAt: new Date() },
      setWhere: eq(investmentSecurities.householdId, household.householdId),
    }).returning({ id: investmentSecurities.id })
  revalidateFinance('investment')
  return { saved: { id: row.id }, message: '관심 종목을 추가했습니다.' }
}

export async function saveManualTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const result = await db.transaction(async (tx): Promise<ActionState> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'investment:' + household.householdId}, 0))`)
    const accounts = await tx.select({ id: investmentAccounts.id }).from(investmentAccounts)
      .where(and(eq(investmentAccounts.householdId, household.householdId), eq(investmentAccounts.active, true))).for('update')
    const securities = await tx.select({ id: investmentSecurities.id, market: investmentSecurities.market, currency: investmentSecurities.currency }).from(investmentSecurities)
      .where(eq(investmentSecurities.householdId, household.householdId))
    const parsed = parseManualTransaction(formData, { accountIds: accounts.map(a => a.id), securities, today: todayInKorea() })
    if ('error' in parsed) return parsed
    const input = parsed.data
    if (input.securityId !== null) {
      const history = await tx.select().from(investmentTransactions).where(and(
        eq(investmentTransactions.householdId, household.householdId),
        eq(investmentTransactions.accountId, input.accountId), eq(investmentTransactions.securityId, input.securityId),
      ))
      const shortage = firstShortBalance([...history, { id: Number.MAX_SAFE_INTEGER, tradeDate: input.tradeDate, kind: input.kind, quantity: input.quantity === null ? null : String(input.quantity) }])
      if (shortage !== null) {
        if (shortage.id !== Number.MAX_SAFE_INTEGER) {
          const change = shortage.kind === 'sell' ? `매도 ${shortage.quantity}주` : `정정 ${shortage.quantity}주`
          return { error: `입력하면 ${shortage.tradeDate}의 기존 ${change}를 처리할 수 없습니다(해당 거래 직전 보유 ${shortage.balance}주). 날짜와 수량을 확인하세요.` }
        }
        return { error: input.kind === 'sell' ? `보유 ${shortage.balance}주보다 많이 팔 수 없습니다.` : '정정하면 보유 수량이 음수가 됩니다.' }
      }
    }
    const [row] = await tx.insert(investmentTransactions).values({
      householdId: household.householdId, accountId: input.accountId, securityId: input.securityId, kind: input.kind, tradeDate: input.tradeDate,
      quantity: input.quantity === null ? null : String(input.quantity), price: input.price === null ? null : String(input.price),
      fee: String(input.fee), amount: String(input.amount), currency: input.currency, source: 'manual', memo: input.memo,
    }).returning({ id: investmentTransactions.id })
    return { saved: { id: row.id }, message: '거래를 저장했습니다.' }
  })
  if (!result.error) revalidateFinance('investment')
  return result
}

function firstShortBalance(rows: Array<Pick<typeof investmentTransactions.$inferSelect, 'id' | 'tradeDate' | 'kind' | 'quantity'>>) {
  let balance = 0
  for (const row of [...rows].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id - b.id)) {
    const quantity = Number(row.quantity ?? 0)
    const delta = row.kind === 'sell' ? -quantity : row.kind === 'buy' || row.kind === 'adjust' ? quantity : 0
    const next = Math.round((balance + delta) * 1e6) / 1e6
    if (next < 0) return { id: row.id, tradeDate: row.tradeDate, kind: row.kind, quantity, balance }
    balance = next
  }
  return null
}

export async function updateTransactionMemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id'))
  const memo = text(formData, 'memo')
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '거래를 찾을 수 없습니다.' }
  if (memo.length > 200) return { error: '메모는 200자까지입니다.' }
  const updated = await db.update(investmentTransactions).set({ memo: memo || null, updatedAt: new Date() })
    .where(and(eq(investmentTransactions.id, id), eq(investmentTransactions.householdId, household.householdId))).returning({ id: investmentTransactions.id })
  if (updated.length === 0) return { error: '거래를 찾을 수 없습니다.' }
  revalidateFinance('investment')
  return { saved: { id }, message: '메모를 저장했습니다.' }
}

export async function deleteManualTransaction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const id = Number(text(formData, 'id'))
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '거래를 찾을 수 없습니다.' }
  const result = await db.transaction(async (tx): Promise<ActionState> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'investment:' + household.householdId}, 0))`)
    const condition = and(eq(investmentTransactions.id, id), eq(investmentTransactions.householdId, household.householdId))
    const [row] = await tx.select().from(investmentTransactions).where(condition).limit(1)
    if (!row) return { error: '거래를 찾을 수 없습니다.' }
    if (row.source !== 'manual') return { error: '키움에서 가져온 거래는 삭제할 수 없습니다. 메모만 수정할 수 있습니다.' }
    if (row.securityId !== null) {
      const history = await tx.select().from(investmentTransactions).where(and(
        eq(investmentTransactions.householdId, household.householdId),
        eq(investmentTransactions.accountId, row.accountId), eq(investmentTransactions.securityId, row.securityId),
      ))
      if (firstShortBalance(history.filter(t => t.id !== id)) !== null) return { error: '삭제하면 보유 수량이 음수가 됩니다. 매도 거래를 먼저 정리하세요.' }
    }
    await tx.delete(investmentTransactions).where(condition)
    return { message: '거래를 삭제했습니다.' }
  })
  if (!result.error) revalidateFinance('investment')
  return result
}

export async function saveHoldingMemo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const household = await requireHousehold()
  if (!household) return { error: NO_HOUSEHOLD }
  const securityId = Number(text(formData, 'securityId'))
  if (!Number.isSafeInteger(securityId) || securityId <= 0) return { error: '이 가구에 없는 종목입니다.' }
  const thesis = text(formData, 'thesis'); const fundsNeededAt = text(formData, 'fundsNeededAt')
  const horizonRaw = text(formData, 'horizonYears'); const lossRaw = text(formData, 'lossLimitPct')
  const weightBasis = text(formData, 'weightBasis') as WeightBasis
  if (thesis.length > 300) return { error: '매수 논지는 300자까지입니다.' }
  if (fundsNeededAt.length > 100) return { error: '자금 사용 시점은 100자까지입니다.' }
  const horizonYears = horizonRaw === '' ? null : Number(horizonRaw)
  if (horizonYears !== null && (!Number.isFinite(horizonYears) || horizonYears <= 0 || horizonYears > 99 || !/^\d+(?:\.\d)?$/.test(horizonRaw))) return { error: '투자 기간은 0보다 크고 99년 이하입니다.' }
  const lossLimitPct = lossRaw === '' ? null : Number(lossRaw)
  if (lossLimitPct !== null && (!Number.isFinite(lossLimitPct) || lossLimitPct <= 0 || lossLimitPct > 100 || !/^\d+(?:\.\d{1,2})?$/.test(lossRaw))) return { error: '허용 손실 한도는 0보다 크고 100% 이하입니다.' }
  if (weightBasis !== 'total_assets' && weightBasis !== 'stock_accounts') return { error: '비중 분모가 올바르지 않습니다.' }
  const updated = await db.update(investmentSecurities).set({
    thesis: thesis || null, fundsNeededAt: fundsNeededAt || null,
    horizonYears: horizonYears === null ? null : horizonYears.toFixed(1), lossLimitPct: lossLimitPct === null ? null : lossLimitPct.toFixed(2),
    weightBasis, updatedAt: new Date(),
  }).where(and(eq(investmentSecurities.id, securityId), eq(investmentSecurities.householdId, household.householdId))).returning({ id: investmentSecurities.id })
  if (updated.length === 0) return { error: '이 가구에 없는 종목입니다.' }
  revalidateFinance('investment')
  return { saved: { id: securityId }, message: '보유 메모를 저장했습니다.' }
}

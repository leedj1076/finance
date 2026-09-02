import type { TransactionFlow } from '@/features/ledger/transaction-input'

export const recurringFlowTokens = ['exp_fix', 'exp_var', 'income', 'saving'] as const
export type RecurringFlowToken = (typeof recurringFlowTokens)[number]

export type RecurringInput = {
  id: number | null
  flow: TransactionFlow
  fixed: boolean
  categoryId: number | null
  memo: string
  amount: number
  accountId: number | null
  day: number
  active: boolean
}

type ParseResult =
  | { data: RecurringInput[]; error?: never }
  | { data?: never; error: string }

export function tokenToFlow(token: RecurringFlowToken) {
  return {
    flow: token === 'income' ? 'income' as const : token === 'saving' ? 'saving' as const : 'expense' as const,
    fixed: token === 'exp_fix',
  }
}

export function flowToToken(flow: TransactionFlow, fixed: boolean): RecurringFlowToken {
  if (flow === 'income') return 'income'
  if (flow === 'saving') return 'saving'
  return fixed ? 'exp_fix' : 'exp_var'
}

function optionalId(value: unknown) {
  if (value === null || value === '' || value === undefined) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function parseRecurringPayload(value: FormDataEntryValue | null): ParseResult {
  if (typeof value !== 'string') return { error: '정기거래 목록이 올바르지 않습니다.' }
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length > 120) {
      return { error: '정기거래 목록이 너무 많거나 올바르지 않습니다.' }
    }

    const result: RecurringInput[] = []
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') return { error: '정기거래 항목이 올바르지 않습니다.' }
      const row = candidate as Record<string, unknown>
      const id = optionalId(row.id)
      if (id === undefined) return { error: '정기거래 식별자가 올바르지 않습니다.' }
      const token = row.flowToken
      if (typeof token !== 'string' || !recurringFlowTokens.includes(token as RecurringFlowToken)) {
        return { error: '정기거래 유형이 올바르지 않습니다.' }
      }
      const memo = typeof row.memo === 'string' ? row.memo.trim().replace(/\s+/g, ' ') : ''
      const amount = Number(typeof row.amount === 'string' ? row.amount.replace(/[\s,원]/g, '') : row.amount)
      const day = Number(row.day)
      const categoryId = optionalId(row.categoryId)
      const accountId = optionalId(row.accountId)

      if (!memo && id === null && (!Number.isFinite(amount) || amount === 0)) continue
      if (!memo || memo.length > 200) return { error: '사용내역은 1~200자로 입력해 주세요.' }
      if (!Number.isSafeInteger(amount) || amount <= 0) return { error: `${memo} 금액은 0보다 큰 정수로 입력해 주세요.` }
      if (!Number.isInteger(day) || day < 1 || day > 31) return { error: `${memo} 결제일은 1~31일로 입력해 주세요.` }
      if (categoryId === undefined) return { error: `${memo} 분류가 올바르지 않습니다.` }
      if (accountId === undefined) return { error: `${memo} 결제수단이 올바르지 않습니다.` }

      const flow = tokenToFlow(token as RecurringFlowToken)
      result.push({
        id,
        ...flow,
        categoryId,
        memo,
        amount,
        accountId,
        day,
        active: row.active !== false,
      })
    }

    const ids = result.flatMap((row) => row.id === null ? [] : [row.id])
    if (new Set(ids).size !== ids.length) return { error: '중복된 정기거래 항목이 있습니다.' }
    return { data: result }
  } catch {
    return { error: '정기거래 목록을 읽을 수 없습니다.' }
  }
}

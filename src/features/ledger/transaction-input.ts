export const transactionFlows = ['income', 'saving', 'expense'] as const

export type TransactionFlow = (typeof transactionFlows)[number]

export type TransactionInput = {
  id: number | null
  date: string
  flow: TransactionFlow
  fixed: boolean
  categoryId: number | null
  memo: string | null
  amount: number
  accountId: number | null
  month: string
}

type ParseResult =
  | { data: TransactionInput; error?: never }
  | { data?: never; error: string }

function textValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function optionalId(value: string) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function parseTransactionInput(formData: FormData): ParseResult {
  const date = textValue(formData, 'date')
  if (!isRealDate(date)) return { error: '올바른 거래 날짜를 입력해 주세요.' }

  const flowValue = textValue(formData, 'flow')
  if (!transactionFlows.includes(flowValue as TransactionFlow)) {
    return { error: '올바른 거래 유형을 선택해 주세요.' }
  }
  const flow = flowValue as TransactionFlow

  const amountText = textValue(formData, 'amount').replace(/[\s,원]/g, '')
  const amount = Number(amountText)
  if (!Number.isSafeInteger(amount) || amount === 0) {
    return { error: '금액은 0이 아닌 정수로 입력해 주세요.' }
  }

  const categoryId = optionalId(textValue(formData, 'categoryId'))
  if (categoryId === undefined) return { error: '올바른 분류를 선택해 주세요.' }

  const accountId = optionalId(textValue(formData, 'accountId'))
  if (accountId === undefined) return { error: '올바른 결제수단을 선택해 주세요.' }

  const id = optionalId(textValue(formData, 'transactionId'))
  if (id === undefined) return { error: '수정할 거래 정보가 올바르지 않습니다.' }

  const memo = textValue(formData, 'memo')
  if (memo.length > 200) return { error: '사용내역은 200자 이내로 입력해 주세요.' }

  return {
    data: {
      id,
      date,
      flow,
      fixed: flow === 'expense' && formData.get('fixed') === 'on',
      categoryId,
      memo: memo || null,
      amount,
      accountId,
      month: date.slice(0, 7),
    },
  }
}

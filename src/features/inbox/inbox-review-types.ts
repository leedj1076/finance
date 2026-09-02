import type { TransactionFlow } from './banksalad'

export type InboxItem = {
  id: number
  owner: string
  date: string
  merchant: string | null
  amount: number
  flow: TransactionFlow
  kind: 'normal' | 'transfer'
  bsCat1: string | null
  bsCat2: string | null
  pay: string | null
  accountId: number | null
  categoryId: number | null
  memo: string | null
  sugSource: string | null
  dupNote: string | null
  confidence: string
  businessType: string | null
  aiNote: string | null
  alwaysConfirm: boolean
  categoryLabel: string | null
}

export type AccountOption = {
  id: number
  name: string
  owner: string | null
}

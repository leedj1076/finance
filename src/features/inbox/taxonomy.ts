import type { TransactionFlow } from './banksalad'

export type InboxCategoryOption = {
  id: number
  kind: TransactionFlow
  major: string
  sub: string
}

export function categoriesForFlow<T extends InboxCategoryOption>(
  categories: T[],
  flow: TransactionFlow,
) {
  return categories.filter((category) => category.kind === flow)
}

export function categorySelectionForFlow(
  categories: InboxCategoryOption[],
  flow: TransactionFlow,
  categoryId: number | string | null | undefined,
) {
  if (categoryId === null || categoryId === undefined || categoryId === '') return ''
  const id = Number(categoryId)
  return categories.some((category) => category.id === id && category.kind === flow) ? String(id) : ''
}

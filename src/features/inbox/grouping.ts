export type InboxMonthGroup<T> = {
  month: string
  items: T[]
}

export type InboxPaymentSourceGroup<T> = {
  key: string
  owner: string
  pay: string | null
  accountId: number | null
  items: T[]
}

export type InboxMonthPaymentSourceGroup<T> = InboxMonthGroup<T> & {
  sources: InboxPaymentSourceGroup<T>[]
}

export function groupInboxItemsByMonth<T extends { date: string }>(items: T[]): InboxMonthGroup<T>[] {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const month = item.date.slice(0, 7)
    const group = groups.get(month)
    if (group) group.push(item)
    else groups.set(month, [item])
  }

  return Array.from(groups, ([month, monthItems]) => ({ month, items: monthItems }))
}

export function formatInboxMonth(month: string) {
  const [year, monthNumber] = month.split('-')
  return `${year}년 ${Number(monthNumber)}월`
}

export function groupInboxItemsByPaymentSource<
  T extends { owner: string; pay: string | null; accountId?: number | null },
>(items: T[]): InboxPaymentSourceGroup<T>[] {
  const groups = new Map<string, InboxPaymentSourceGroup<T>>()

  for (const item of items) {
    const pay = item.pay?.trim() || null
    const accountId = item.accountId ?? null
    const key = accountId === null
      ? `${item.owner}\u0000${pay ?? ''}`
      : `account\u0000${accountId}`
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, owner: item.owner, pay, accountId, items: [item] })
  }

  return [...groups.values()]
}

export function groupInboxItemsByMonthAndPaymentSource<
  T extends { date: string; owner: string; pay: string | null; accountId?: number | null },
>(items: T[]): InboxMonthPaymentSourceGroup<T>[] {
  return groupInboxItemsByMonth(items).map((monthGroup) => ({
    ...monthGroup,
    sources: groupInboxItemsByPaymentSource(monthGroup.items).map((source) => ({
      ...source,
      key: `${monthGroup.month}\u0000${source.key}`,
    })),
  }))
}

export function formatInboxPaymentSource(
  source: Pick<InboxPaymentSourceGroup<never>, 'owner' | 'pay'>,
  accountName?: string,
) {
  return accountName ?? `${source.owner} · ${source.pay ?? '결제 소스 미상'}`
}

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

export type InboxOwnerPaymentSourceGroup<T> = {
  key: string
  owner: string
  sources: InboxPaymentSourceGroup<T>[]
  items: T[]
}

export type InboxMonthOwnerPaymentSourceGroup<T> = InboxMonthGroup<T> & {
  owners: InboxOwnerPaymentSourceGroup<T>[]
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

export function groupInboxItemsByOwner<
  T extends { owner: string; pay: string | null; accountId?: number | null },
>(items: T[]): InboxOwnerPaymentSourceGroup<T>[] {
  const groups = new Map<string, T[]>()

  for (const item of items) {
    const group = groups.get(item.owner)
    if (group) group.push(item)
    else groups.set(item.owner, [item])
  }

  return Array.from(groups, ([owner, ownerItems]) => ({
    key: owner,
    owner,
    items: ownerItems,
    sources: groupInboxItemsByPaymentSource(ownerItems),
  }))
}

export function groupInboxItemsByMonthOwnerAndPaymentSource<
  T extends { date: string; owner: string; pay: string | null; accountId?: number | null },
>(items: T[]): InboxMonthOwnerPaymentSourceGroup<T>[] {
  return groupInboxItemsByMonth(items).map((monthGroup) => ({
    ...monthGroup,
    owners: groupInboxItemsByOwner(monthGroup.items).map((ownerGroup) => ({
      ...ownerGroup,
      key: `${monthGroup.month}\u0000${ownerGroup.key}`,
      sources: ownerGroup.sources.map((source) => ({
        ...source,
        key: `${monthGroup.month}\u0000${ownerGroup.key}\u0000${source.key}`,
      })),
    })),
  }))
}

export function groupInboxItemsByMonthAndPaymentSource<
  T extends { date: string; owner: string; pay: string | null; accountId?: number | null },
>(items: T[]): Array<InboxMonthGroup<T> & { sources: InboxPaymentSourceGroup<T>[] }> {
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

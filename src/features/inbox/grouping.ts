export type InboxMonthGroup<T> = {
  month: string
  items: T[]
}

export type InboxPaymentSourceGroup<T> = {
  key: string
  owner: string
  pay: string | null
  items: T[]
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
  T extends { owner: string; pay: string | null },
>(items: T[]): InboxPaymentSourceGroup<T>[] {
  const groups = new Map<string, InboxPaymentSourceGroup<T>>()

  for (const item of items) {
    const pay = item.pay?.trim() || null
    const key = `${item.owner}\u0000${pay ?? ''}`
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, owner: item.owner, pay, items: [item] })
  }

  return [...groups.values()]
}

export function formatInboxPaymentSource(
  source: Pick<InboxPaymentSourceGroup<never>, 'owner' | 'pay'>,
) {
  return `${source.owner} · ${source.pay ?? '결제 소스 미상'}`
}

export type InboxMonthGroup<T> = {
  month: string
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

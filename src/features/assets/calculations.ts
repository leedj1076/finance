export type AssetKind = 'asset' | 'liability'

export type AssetAccountRow = {
  id: number
  major: string
  name: string
  kind: AssetKind
  sortOrder: number
}

export type BalanceSnapshotRow = {
  accountId: number
  month: string
  amount: number
}

export const ASSET_GROUPS: Array<{ major: string; kind: AssetKind }> = [
  { major: '부동산', kind: 'asset' },
  { major: '노후·연금', kind: 'asset' },
  { major: '현금', kind: 'asset' },
  { major: '저축·투자', kind: 'asset' },
  { major: '자녀', kind: 'asset' },
  { major: '대출', kind: 'liability' },
]

function snapshotsByAccount(snapshots: BalanceSnapshotRow[]) {
  const result = new Map<number, BalanceSnapshotRow[]>()
  for (const snapshot of snapshots) {
    const rows = result.get(snapshot.accountId) ?? []
    rows.push(snapshot)
    result.set(snapshot.accountId, rows)
  }
  for (const rows of result.values()) rows.sort((a, b) => a.month.localeCompare(b.month))
  return result
}

function lastBalance(rows: BalanceSnapshotRow[] | undefined, month: string, exclusive = false) {
  let value: number | null = null
  for (const row of rows ?? []) {
    if (exclusive ? row.month >= month : row.month > month) break
    value = row.amount
  }
  return value
}

export function assetOverview(
  accounts: AssetAccountRow[],
  snapshots: BalanceSnapshotRow[],
  month: string,
) {
  const history = snapshotsByAccount(snapshots)
  const rows = accounts.map((account) => {
    const accountSnapshots = history.get(account.id)
    const currentAmount = accountSnapshots?.find((snapshot) => snapshot.month === month)?.amount ?? null
    const previousAmount = lastBalance(accountSnapshots, month, true)
    const effectiveAmount = currentAmount ?? previousAmount ?? 0
    return { ...account, currentAmount, previousAmount, effectiveAmount }
  })

  const groupOrder = new Map(ASSET_GROUPS.map((group, index) => [group.major, index]))
  const groups = ASSET_GROUPS.map((group) => ({
    ...group,
    rows: rows.filter((row) => row.major === group.major),
    subtotal: rows
      .filter((row) => row.major === group.major)
      .reduce((sum, row) => sum + row.effectiveAmount, 0),
  }))
  const additionalGroups = Array.from(new Set(rows.map((row) => row.major)))
    .filter((major) => !groupOrder.has(major))
    .map((major) => {
      const groupRows = rows.filter((row) => row.major === major)
      return {
        major,
        kind: groupRows[0]?.kind ?? 'asset' as AssetKind,
        rows: groupRows,
        subtotal: groupRows.reduce((sum, row) => sum + row.effectiveAmount, 0),
      }
    })
  groups.push(...additionalGroups)

  const assets = rows
    .filter((row) => row.kind === 'asset')
    .reduce((sum, row) => sum + row.effectiveAmount, 0)
  const debt = rows
    .filter((row) => row.kind === 'liability')
    .reduce((sum, row) => sum + row.effectiveAmount, 0)
  const liquidAssets = rows
    .filter((row) => row.kind === 'asset' && ['현금', '저축·투자'].includes(row.major))
    .reduce((sum, row) => sum + row.effectiveAmount, 0)

  return {
    rows,
    groups,
    assets,
    debt,
    netWorth: assets - debt,
    liquidAssets,
    enteredCount: rows.filter((row) => row.currentAmount !== null).length,
  }
}

export function netWorthTrend(
  accounts: AssetAccountRow[],
  snapshots: BalanceSnapshotRow[],
  year: number,
  throughMonth: string,
) {
  const history = snapshotsByAccount(snapshots)
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`
    let assets = 0
    let debt = 0
    let hasData = false

    for (const account of accounts) {
      const amount = lastBalance(history.get(account.id), month)
      if (amount === null) continue
      hasData = true
      if (account.kind === 'liability') debt += amount
      else assets += amount
    }

    const active = hasData && month <= throughMonth
    return {
      month,
      assets,
      debt,
      netWorth: assets - debt,
      active,
    }
  })
}

export function assetComposition(overview: ReturnType<typeof assetOverview>) {
  return overview.groups
    .filter((group) => group.kind === 'asset' && group.subtotal > 0)
    .map((group) => ({ major: group.major, amount: group.subtotal }))
    .sort((a, b) => b.amount - a.amount)
}

import { describe, expect, test } from 'vitest'

import { parseAssetAmount, parseAssetName, parseNewAssets } from '@/features/assets/asset-input'
import {
  assetComposition,
  assetOverview,
  netWorthTrend,
  type AssetAccountRow,
} from '@/features/assets/calculations'

const accounts: AssetAccountRow[] = [
  { id: 1, major: '현금', name: '생활비 통장', kind: 'asset', sortOrder: 1 },
  { id: 2, major: '저축·투자', name: '예금', kind: 'asset', sortOrder: 2 },
  { id: 3, major: '대출', name: '주택담보대출', kind: 'liability', sortOrder: 3 },
]

const snapshots = [
  { accountId: 1, month: '2026-01', amount: 1_000_000 },
  { accountId: 1, month: '2026-03', amount: 1_300_000 },
  { accountId: 2, month: '2026-02', amount: 2_000_000 },
  { accountId: 3, month: '2026-01', amount: 500_000 },
  { accountId: 3, month: '2026-03', amount: 400_000 },
]

describe('asset calculations', () => {
  test('carries the latest balance into a month without a snapshot', () => {
    const overview = assetOverview(accounts, snapshots, '2026-02')

    expect(overview.rows.find((row) => row.id === 1)).toMatchObject({
      currentAmount: null,
      previousAmount: 1_000_000,
      effectiveAmount: 1_000_000,
    })
    expect(overview).toMatchObject({
      assets: 3_000_000,
      debt: 500_000,
      netWorth: 2_500_000,
      liquidAssets: 3_000_000,
      enteredCount: 1,
    })
  })

  test('builds a monthly trend using carried balances only through the selected month', () => {
    const trend = netWorthTrend(accounts, snapshots, 2026, '2026-03')

    expect(trend[0]).toMatchObject({ assets: 1_000_000, debt: 500_000, netWorth: 500_000, active: true })
    expect(trend[1]).toMatchObject({ assets: 3_000_000, debt: 500_000, netWorth: 2_500_000, active: true })
    expect(trend[2]).toMatchObject({ assets: 3_300_000, debt: 400_000, netWorth: 2_900_000, active: true })
    expect(trend[3].active).toBe(false)
  })

  test('sorts asset composition by balance and excludes debt', () => {
    const composition = assetComposition(assetOverview(accounts, snapshots, '2026-03'))

    expect(composition).toEqual([
      { major: '저축·투자', amount: 2_000_000 },
      { major: '현금', amount: 1_300_000 },
    ])
  })
})

describe('asset input', () => {
  test('accepts comma-formatted won and treats an empty balance as no snapshot', () => {
    expect(parseAssetAmount('1,234,000')).toBe(1_234_000)
    expect(parseAssetAmount('')).toBeNull()
    expect(parseAssetAmount('-1')).toBeUndefined()
    expect(parseAssetName('  가족   예금  ')).toBe('가족 예금')
  })

  test('validates new asset JSON', () => {
    expect(parseNewAssets(JSON.stringify([
      { major: '현금', kind: 'asset', name: '새 통장', amount: '500,000' },
      { major: '현금', kind: 'asset', name: '', amount: '' },
    ]))).toEqual([
      { major: '현금', kind: 'asset', name: '새 통장', amount: 500_000 },
    ])
    expect(parseNewAssets('{bad json')).toBeNull()
  })
})

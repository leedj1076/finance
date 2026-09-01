import type { AssetKind } from './calculations'

export type NewAssetInput = {
  major: string
  kind: AssetKind
  name: string
  amount: number | null
}

export function parseAssetAmount(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || !value.trim()) return null
  const amount = Number(value.replace(/[\s,원]/g, ''))
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined
}

export function parseAssetName(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length > 0 && name.length <= 80 ? name : null
}

export function parseNewAssets(value: FormDataEntryValue | null): NewAssetInput[] | null {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length > 30) return null
    const rows: NewAssetInput[] = []
    for (const candidate of parsed) {
      if (!candidate || typeof candidate !== 'object') return null
      const row = candidate as Record<string, unknown>
      if (typeof row.major !== 'string' || !row.major.trim() || row.major.length > 40) return null
      if (row.kind !== 'asset' && row.kind !== 'liability') return null
      const name = parseAssetName(typeof row.name === 'string' ? row.name : null)
      if (!name) continue
      const amount = parseAssetAmount(typeof row.amount === 'string' ? row.amount : null)
      if (amount === undefined) return null
      rows.push({ major: row.major.trim(), kind: row.kind, name, amount })
    }
    return rows
  } catch {
    return null
  }
}

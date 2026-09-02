import { and, eq, inArray, sql } from 'drizzle-orm'

import { db } from '@/db/client'
import { merchantLookup } from '@/db/schema'

export type LookupSource = 'user' | 'ai'

export type MerchantLookupUpsertEntry = {
  normMerchant: string
  displayMerchant?: string | null
  categoryId: number | null
  flow: 'expense' | 'income' | 'saving'
  businessType?: string | null
  aiNote?: string | null
  confidence?: 'high' | 'low'
}

export type MerchantLookupEntry = {
  normMerchant: string
  displayMerchant: string | null
  businessType: string | null
  categoryId: number | null
  flow: 'expense' | 'income' | 'saving'
  source: LookupSource
  confidence: 'high' | 'low'
  aiNote: string | null
  alwaysConfirm: boolean
}

// Aggregators hide the purchased item, so a merchant substring match alone
// must never make their classification automatic.
export const AGGREGATOR_NORMS = [
  '쿠팡',
  '네이버페이',
  '카카오페이',
  '지마켓',
  '옥션',
  '번가',
  '페이코',
  '토스',
  '네이버파이낸셜',
]

const AGGREGATOR_EXCEPTIONS = ['쿠팡이츠']

export function isAggregatorNorm(norm: string) {
  if (!norm) return false
  if (AGGREGATOR_EXCEPTIONS.some((exception) => norm.includes(exception))) return false
  return AGGREGATOR_NORMS.some((aggregator) => norm.includes(aggregator))
}

export async function lookupMerchants(
  householdId: string,
  norms: string[],
): Promise<Map<string, MerchantLookupEntry>> {
  const result = new Map<string, MerchantLookupEntry>()
  const uniqueNorms = [...new Set(norms.filter(Boolean))]
  if (uniqueNorms.length === 0) return result

  const rows = await db
    .select()
    .from(merchantLookup)
    .where(
      and(
        eq(merchantLookup.householdId, householdId),
        inArray(merchantLookup.normMerchant, uniqueNorms),
      ),
    )

  for (const row of rows) {
    result.set(row.normMerchant, {
      normMerchant: row.normMerchant,
      displayMerchant: row.displayMerchant,
      businessType: row.businessType,
      categoryId: row.categoryId,
      flow: row.flow,
      source: row.source as LookupSource,
      confidence: row.confidence as 'high' | 'low',
      aiNote: row.aiNote,
      alwaysConfirm: row.alwaysConfirm,
    })
  }

  return result
}

export function merchantLookupUpsertStatement(
  householdId: string,
  entry: MerchantLookupUpsertEntry,
  source: LookupSource,
) {
  return sql`
    insert into merchant_lookup
      (household_id, norm_merchant, display_merchant, business_type, category_id,
       flow, source, confidence, ai_note, always_confirm, hit_count, last_used_at)
    values
      (${householdId}, ${entry.normMerchant}, ${entry.displayMerchant ?? null},
       ${entry.businessType ?? null}, ${entry.categoryId}, ${entry.flow}, ${source},
       ${entry.confidence ?? 'high'}, ${entry.aiNote ?? null},
       ${isAggregatorNorm(entry.normMerchant)}, 1, now())
    on conflict (household_id, norm_merchant) do update set
      display_merchant = coalesce(excluded.display_merchant, merchant_lookup.display_merchant),
      business_type = coalesce(excluded.business_type, merchant_lookup.business_type),
      category_id = excluded.category_id,
      flow = excluded.flow,
      source = excluded.source,
      confidence = excluded.confidence,
      ai_note = coalesce(excluded.ai_note, merchant_lookup.ai_note),
      hit_count = merchant_lookup.hit_count + 1,
      last_used_at = now()
    where not (merchant_lookup.source = 'user' and excluded.source = 'ai')
  `
}

export async function upsertMerchantLookup(
  householdId: string,
  entry: MerchantLookupUpsertEntry,
  source: LookupSource,
) {
  await db.execute(merchantLookupUpsertStatement(householdId, entry, source))
}

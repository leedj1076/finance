import {
  aiFallbackEnabled,
  classifyUnknownMerchants,
  type TaxonomyEntry,
} from './ai-classify'
import type { SugSource } from './confidence'
import {
  isAggregatorNorm,
  lookupMerchants,
  upsertMerchantLookup,
} from './merchant-lookup'
import { normalizeMerchant } from './normalize'

export type ResolvedSuggestion = {
  categoryId: number | null
  flow: 'expense' | 'income' | 'saving'
  sugSource: SugSource
  historyMatch: 'norm' | 'token' | null
  businessType: string | null
  aiNote: string | null
  alwaysConfirm: boolean
  exactAmountRepeat: boolean
}

type SuggestionItem = {
  merchant: string
  amount: number
  baseFlow: 'expense' | 'income' | 'saving'
  bsSuggestCategoryId: number | null
  /** Card rows and transfer candidates must retain the flow inferred from the source. */
  lockFlow?: boolean
}

type HistorySuggestion = {
  flow: string
  major: string
  sub: string
  matched: 'norm' | 'token'
}

export async function resolveSuggestions(args: {
  householdId: string
  items: SuggestionItem[]
  historySuggest: (merchant: string) => HistorySuggestion | null
  amountRepeatIndex: Map<string, { count: number; categoryId: number | null }>
  taxonomy: TaxonomyEntry[]
  examples: { merchant: string; major: string; sub: string }[]
  findCategoryId: (flow: string, major: string, sub: string) => number | null
  aiSetting: string | null
}): Promise<ResolvedSuggestion[]> {
  const norms = args.items.map((item) => normalizeMerchant(item.merchant))
  const cache = await lookupMerchants(args.householdId, norms)
  const resolved: Array<ResolvedSuggestion | null> = args.items.map(() => null)
  const unknownIndexes: number[] = []

  args.items.forEach((item, index) => {
    const norm = norms[index]
    const cached = cache.get(norm)
    const alwaysConfirm = cached?.alwaysConfirm ?? isAggregatorNorm(norm)
    const repeat = args.amountRepeatIndex.get(`${norm}|${item.amount}`)
    const exactAmountRepeat = repeat?.categoryId != null
    const evidence = {
      alwaysConfirm,
      exactAmountRepeat,
      businessType: null,
      aiNote: null,
    }

    if (
      cached?.source === 'user' &&
      cached.categoryId !== null &&
      (!item.lockFlow || cached.flow === item.baseFlow)
    ) {
      resolved[index] = {
        ...evidence,
        categoryId: cached.categoryId,
        flow: cached.flow,
        sugSource: 'user',
        historyMatch: null,
        businessType: cached.businessType,
        aiNote: cached.aiNote,
      }
      return
    }

    const historical = args.historySuggest(item.merchant)
    if (historical && (!item.lockFlow || historical.flow === item.baseFlow)) {
      const categoryId = args.findCategoryId(
        historical.flow,
        historical.major,
        historical.sub,
      )
      if (categoryId !== null) {
        resolved[index] = {
          ...evidence,
          categoryId,
          flow: historical.flow as ResolvedSuggestion['flow'],
          sugSource: 'history',
          historyMatch: historical.matched,
        }
        return
      }
    }

    if (
      cached?.source === 'ai' &&
      cached.categoryId !== null &&
      (!item.lockFlow || cached.flow === item.baseFlow)
    ) {
      resolved[index] = {
        ...evidence,
        categoryId: cached.categoryId,
        flow: cached.flow,
        sugSource: 'ai',
        historyMatch: null,
        businessType: cached.businessType,
        aiNote: cached.aiNote,
      }
      return
    }

    unknownIndexes.push(index)
  })

  if (unknownIndexes.length > 0 && aiFallbackEnabled(args.aiSetting)) {
    const merchants = [
      ...new Set(unknownIndexes.map((index) => args.items[index].merchant)),
    ]
    const aiResults = await classifyUnknownMerchants({
      merchants,
      taxonomy: args.taxonomy,
      examples: args.examples,
    })
    const byMerchant = new Map(aiResults.map((result) => [result.merchant, result]))

    await Promise.all(
      aiResults.map(async (result) => {
        const categoryId = args.findCategoryId(
          result.flow,
          result.major,
          result.sub,
        )
        await upsertMerchantLookup(
          args.householdId,
          {
            normMerchant: normalizeMerchant(result.merchant),
            displayMerchant: result.merchant,
            categoryId,
            flow: result.flow,
            businessType: result.businessType,
            aiNote: result.note,
            confidence: result.confidence,
          },
          'ai',
        )
      }),
    )

    for (const index of unknownIndexes) {
      const result = byMerchant.get(args.items[index].merchant)
      if (!result) continue
      if (args.items[index].lockFlow && result.flow !== args.items[index].baseFlow) continue
      const categoryId = args.findCategoryId(
        result.flow,
        result.major,
        result.sub,
      )
      if (categoryId === null) continue

      const norm = norms[index]
      resolved[index] = {
        categoryId,
        flow: result.flow,
        sugSource: 'ai',
        historyMatch: null,
        businessType: result.businessType,
        aiNote: result.note,
        alwaysConfirm: cache.get(norm)?.alwaysConfirm ?? isAggregatorNorm(norm),
        exactAmountRepeat: false,
      }
    }
  }

  return args.items.map((item, index) => {
    const norm = norms[index]
    const alwaysConfirm = cache.get(norm)?.alwaysConfirm ?? isAggregatorNorm(norm)
    const repeat = args.amountRepeatIndex.get(`${norm}|${item.amount}`)
    const exactAmountRepeat = repeat?.categoryId != null
    let result = resolved[index] ?? {
      categoryId: item.bsSuggestCategoryId,
      flow: item.baseFlow,
      sugSource: item.bsSuggestCategoryId === null ? null : 'banksalad' as const,
      historyMatch: null,
      businessType: null,
      aiNote: null,
      alwaysConfirm,
      exactAmountRepeat,
    }

    if (alwaysConfirm && exactAmountRepeat && repeat?.categoryId != null) {
      result = { ...result, categoryId: repeat.categoryId, exactAmountRepeat: true }
    }
    return result
  })
}

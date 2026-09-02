import OpenAI from 'openai'

export type TaxonomyEntry = {
  flow: 'expense' | 'income' | 'saving'
  major: string
  sub: string
}

export type AiMerchantResult = {
  merchant: string
  businessType: string
  major: string
  sub: string
  flow: 'expense' | 'income' | 'saving'
  confidence: 'high' | 'low'
  note: string
}

type ClassificationInput = {
  merchants: string[]
  taxonomy: TaxonomyEntry[]
  examples: { merchant: string; major: string; sub: string }[]
}

// User decision (2026-09-01): OpenAI Responses API with built-in web search.
// This low-cost model is sufficient for the expected 5-15 unknown merchants per month.
const MODEL = 'gpt-5-mini'

export function aiFallbackEnabled(settingValue: string | null | undefined): boolean {
  if (settingValue === '0') return false
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  const raw = fenced?.[1]
    ?? (firstBracket >= 0 && lastBracket >= firstBracket
      ? text.slice(firstBracket, lastBracket + 1)
      : '')

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Classifies cache/history misses in one batch. Only merchant names, the household
 * taxonomy, and confirmed examples are sent; amounts and dates never leave the app.
 * Any API or response failure degrades to an empty result so upload can continue.
 */
export async function classifyUnknownMerchants(
  input: ClassificationInput,
  client?: OpenAI,
): Promise<AiMerchantResult[]> {
  const merchants = [...new Set(input.merchants.filter((merchant) => merchant.trim().length > 0))]
  if (merchants.length === 0 || input.taxonomy.length === 0) return []

  const requestedMerchants = new Set(merchants)
  const validTaxonomy = new Set(
    input.taxonomy.map((entry) => `${entry.flow}|${entry.major}|${entry.sub}`),
  )
  const taxonomyText = input.taxonomy
    .map((entry) => `${entry.flow} / ${entry.major} / ${entry.sub}`)
    .join('\n')
  const examplesText = input.examples
    .slice(0, 20)
    .map((example) => `- ${JSON.stringify(example.merchant)} → ${example.major}/${example.sub}`)
    .join('\n')

  const prompt = [
    '아래는 한국 가계부의 카드/계좌 결제 가맹점명 목록이다. 각 가맹점의 업종을 판단하고',
    '(모르는 곳은 웹검색으로 확인), 주어진 분류체계에서 가장 알맞은 항목 하나를 골라라.',
    '',
    '## 분류체계 (이 목록에 있는 조합만 사용)',
    taxonomyText,
    '',
    examplesText ? `## 이 가계부의 분류 예시\n${examplesText}\n` : '',
    '## 가맹점 목록',
    JSON.stringify(merchants),
    '',
    '## 출력 형식',
    '```json 펜스 안에 JSON 배열만. 각 원소:',
    '{"merchant":"<입력 그대로>","businessType":"<업종 한두 단어>","major":"...","sub":"...",',
    '"flow":"expense|income|saving","confidence":"high|low","note":"<한 줄 근거>"}',
    '확실하지 않으면 confidence를 "low"로. 웹검색으로도 정체를 모르면 low + 가장 그럴듯한 분류.',
  ].join('\n')

  try {
    const openai = client ?? new OpenAI()
    const response = await openai.responses.create({
      model: MODEL,
      tools: [{ type: 'web_search' }],
      input: prompt,
      store: false,
    })
    const items = extractJsonArray(response.output_text ?? '')
    if (!items) return []

    const output: AiMerchantResult[] = []
    const seenMerchants = new Set<string>()
    for (const item of items) {
      if (!isRecord(item)) continue
      const merchant = stringValue(item.merchant)
      const major = stringValue(item.major)
      const sub = stringValue(item.sub)
      if (!merchant || !major || !sub) continue
      if (!requestedMerchants.has(merchant) || seenMerchants.has(merchant)) continue

      const flow = item.flow === 'income' || item.flow === 'saving'
        ? item.flow
        : 'expense'
      if (!validTaxonomy.has(`${flow}|${major}|${sub}`)) continue

      output.push({
        merchant,
        businessType: typeof item.businessType === 'string' ? item.businessType : '',
        major,
        sub,
        flow,
        confidence: item.confidence === 'high' ? 'high' : 'low',
        note: typeof item.note === 'string' ? item.note : '',
      })
      seenMerchants.add(merchant)
    }
    return output
  } catch {
    return []
  }
}

import type OpenAI from 'openai'
import { afterEach, expect, test } from 'vitest'

import {
  aiFallbackEnabled,
  classifyUnknownMerchants,
} from '@/features/inbox/ai-classify'

const taxonomy = [
  { flow: 'expense' as const, major: '식비', sub: '카페' },
  { flow: 'expense' as const, major: '건강', sub: '병원/약국' },
]

const savedApiKey = process.env.OPENAI_API_KEY

afterEach(() => {
  if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = savedApiKey
})

function mockClient(
  text: string,
  options: {
    shouldThrow?: boolean
    onCreate?: (request: unknown) => void
  } = {},
) {
  return {
    responses: {
      create: async (request: unknown) => {
        options.onCreate?.(request)
        if (options.shouldThrow) throw new Error('api down')
        return { output_text: text }
      },
    },
  } as unknown as OpenAI
}

test('parses fenced JSON and validates results against the household taxonomy', async () => {
  const text = '조사 결과입니다.\n```json\n' + JSON.stringify([
    {
      merchant: '포스톤즈',
      businessType: '카페',
      major: '식비',
      sub: '카페',
      flow: 'expense',
      confidence: 'high',
      note: '웹서치: 마포구 카페',
    },
    {
      merchant: '이상한곳',
      businessType: '?',
      major: '없는대분류',
      sub: '없음',
      flow: 'expense',
      confidence: 'low',
      note: '',
    },
  ]) + '\n```'

  const output = await classifyUnknownMerchants(
    { merchants: ['포스톤즈', '이상한곳'], taxonomy, examples: [] },
    mockClient(text),
  )

  expect(output).toHaveLength(1)
  expect(output[0]).toMatchObject({
    merchant: '포스톤즈',
    major: '식비',
    sub: '카페',
    confidence: 'high',
  })
})

test('uses Responses API web search without sending transaction amounts or dates', async () => {
  let request: unknown
  const result = await classifyUnknownMerchants(
    {
      merchants: ['포스톤즈'],
      taxonomy,
      examples: [{ merchant: '예시카페', major: '식비', sub: '카페' }],
    },
    mockClient('[]', { onCreate: (value) => { request = value } }),
  )

  expect(result).toEqual([])
  expect(request).toMatchObject({
    model: 'gpt-5-mini',
    store: false,
    tools: [{ type: 'web_search' }],
  })
  const prompt = String((request as { input?: unknown }).input)
  expect(prompt).toContain('포스톤즈')
  expect(prompt).toContain('예시카페')
  expect(prompt).not.toMatch(/amount|date|금액|날짜/)
})

test('drops output for a merchant that was not requested', async () => {
  const text = JSON.stringify([{
    merchant: '요청하지않은가맹점',
    businessType: '카페',
    major: '식비',
    sub: '카페',
    flow: 'expense',
    confidence: 'high',
    note: '',
  }])

  await expect(classifyUnknownMerchants(
    { merchants: ['포스톤즈'], taxonomy, examples: [] },
    mockClient(text),
  )).resolves.toEqual([])
})

test('API or malformed-output failure returns an empty result', async () => {
  await expect(classifyUnknownMerchants(
    { merchants: ['포스톤즈'], taxonomy, examples: [] },
    mockClient('', { shouldThrow: true }),
  )).resolves.toEqual([])

  await expect(classifyUnknownMerchants(
    { merchants: ['포스톤즈'], taxonomy, examples: [] },
    mockClient('not json'),
  )).resolves.toEqual([])
})

test('empty merchants returns without calling the API', async () => {
  let called = false
  const output = await classifyUnknownMerchants(
    { merchants: [], taxonomy, examples: [] },
    mockClient('[]', { onCreate: () => { called = true } }),
  )

  expect(output).toEqual([])
  expect(called).toBe(false)
})

test('aiFallbackEnabled respects the setting and server API key', () => {
  process.env.OPENAI_API_KEY = 'sk-test'
  expect(aiFallbackEnabled(null)).toBe(true)
  expect(aiFallbackEnabled(undefined)).toBe(true)
  expect(aiFallbackEnabled('0')).toBe(false)

  process.env.OPENAI_API_KEY = ''
  expect(aiFallbackEnabled(null)).toBe(false)
})

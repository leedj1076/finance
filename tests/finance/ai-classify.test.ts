import OpenAI from 'openai'
import { afterEach, expect, test, vi } from 'vitest'

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
  vi.useRealTimers()
  if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = savedApiKey
})

const classificationInput = { merchants: ['포스톤즈'], taxonomy, examples: [] }

test('fresh classification aborts at 30 seconds without retrying or waiting for late rejection', async () => {
  vi.useFakeTimers()
  let requestOptions: { signal?: AbortSignal; maxRetries?: number } | undefined
  let rejectRequest!: (error: Error) => void
  let calls = 0
  const client = { responses: { create: (_request: unknown, options: typeof requestOptions) => {
    calls += 1
    requestOptions = options
    return new Promise<never>((_resolve, reject) => { rejectRequest = reject })
  } } } as unknown as OpenAI
  let result: unknown = 'pending'
  const run = classifyUnknownMerchants(classificationInput, client).then((value) => { result = value })
  await vi.advanceTimersByTimeAsync(29_999)
  expect(result).toBe('pending')
  await vi.advanceTimersByTimeAsync(1)
  expect(result).toEqual([])
  expect(requestOptions?.signal?.aborted).toBe(true)
  expect(requestOptions?.maxRetries).toBe(0)
  expect(calls).toBe(1)
  expect(vi.getTimerCount()).toBe(0)
  rejectRequest(new Error('late upstream failure'))
  await run
  await vi.advanceTimersByTimeAsync(60_000)
  expect(calls).toBe(1)
})

test('the application deadline also covers a response body stalled after headers', async () => {
  vi.useFakeTimers()
  let bodyStarted!: () => void
  const readingBody = new Promise<void>((resolve) => { bodyStarted = resolve })
  let rejectBody!: (error: Error) => void
  let signal: AbortSignal | undefined | null
  let calls = 0
  const client = new OpenAI({ apiKey: 'synthetic-test-key', fetch: async (_url, init) => {
    calls += 1
    signal = init?.signal
    const response = new Response('', { headers: { 'content-type': 'application/json' } })
    response.text = () => {
      bodyStarted()
      return new Promise<string>((_resolve, reject) => { rejectBody = reject })
    }
    return response
  } })
  let result: unknown = 'pending'
  const run = classifyUnknownMerchants(classificationInput, client).then((value) => { result = value })
  await readingBody
  await vi.advanceTimersByTimeAsync(29_999)
  expect(result).toBe('pending')
  await vi.advanceTimersByTimeAsync(1)
  expect(result).toEqual([])
  expect(signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  rejectBody(new Error('late body failure'))
  await run
  await vi.advanceTimersByTimeAsync(60_000)
  expect(calls).toBe(1)
})

test.each(['success', 'error'] as const)('early %s releases the deadline timer', async (path) => {
  vi.useFakeTimers()
  let activeTimers = 0
  const client = { responses: { create: async () => {
    activeTimers = vi.getTimerCount()
    if (path === 'error') throw new Error('upstream unavailable')
    return { output_text: JSON.stringify([{ merchant: '포스톤즈', major: '식비', sub: '카페', confidence: 'high' }]) }
  } } } as unknown as OpenAI
  const result = await classifyUnknownMerchants(classificationInput, client)
  expect(activeTimers).toBe(1)
  expect(result).toHaveLength(path === 'success' ? 1 : 0)
  expect(vi.getTimerCount()).toBe(0)
})

test.each([
  { merchants: ['', '  '], taxonomy, examples: [] },
  { merchants: ['포스톤즈'], taxonomy: [], examples: [] },
])('empty usable input creates neither a deadline nor a request', async (input) => {
  vi.useFakeTimers()
  const timer = vi.spyOn(globalThis, 'setTimeout')
  let called = false
  try {
    expect(await classifyUnknownMerchants(input, mockClient('[]', { onCreate: () => { called = true } }))).toEqual([])
    expect(called).toBe(false)
    expect(timer).not.toHaveBeenCalled()
  } finally {
    timer.mockRestore()
  }
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

import { drizzle } from 'drizzle-orm/pg-proxy'
import { expect, test } from 'vitest'

import { refreshDuplicateFlags } from '@/features/inbox/staging'

function captureRefresh(count: number) {
  const pending = Array.from({ length: count }, (_, index) => ({
    id: index + 1, date: '2026-09-01', merchant: `합성 ' 상점-${index}`,
    amount: index + 1, flow: 'expense',
  }))
  const writes: Array<{ query: string; params: unknown[] }> = []
  const queryDb = drizzle(async (query, params) => {
    writes.push({ query, params })
    return { rows: [] }
  })
  let selects = 0
  let transactions = 0
  const database = {
    select: () => {
      const rows = selects++ === 0 ? pending : pending.map((row) => ({ ...row, source: 'manual' }))
      const chain = { from: () => chain, where: () => chain, orderBy: async () => rows }
      return chain
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      transactions += 1
      return callback(queryDb)
    },
  }
  return {
    writes,
    run: () => refreshDuplicateFlags('synthetic-household', database as never),
    transactionCount: () => transactions,
  }
}

test.each([[1, 2], [100, 2], [500, 2], [501, 3], [1001, 4]])(
  '%i duplicate notes use %i bounded writes in one transaction with parameterized live guards',
  async (count, expectedWrites) => {
    const capture = captureRefresh(count)
    expect(await capture.run()).toBe(count)
    expect(capture.writes).toHaveLength(expectedWrites)
    expect(capture.transactionCount()).toBe(1)
    for (const [writeIndex, { query, params }] of capture.writes.entries()) {
      expect(query).toContain('"household_id" = $')
      expect(query).toContain('"status" = $')
      expect(query).toMatch(/"id" (?:in \(|= \$)/)
      expect(params).toContain('synthetic-household')
      expect(params).toContain('pending')
      expect(query).not.toContain('synthetic-household')
      expect(query).not.toContain('합성')
      const where = query.slice(query.indexOf(' where '))
      const guardParams = [...where.matchAll(/\$(\d+)/g)].map((match) => params[Number(match[1]) - 1])
      const start = writeIndex === 0 ? 0 : (writeIndex - 1) * 500
      const size = writeIndex === 0 ? count : Math.min(500, count - start)
      expect(guardParams).toEqual([
        'synthetic-household', 'pending',
        ...Array.from({ length: size }, (_, index) => start + index + 1),
      ])
    }
    const notesPerWrite = capture.writes.slice(1).map(({ params }) =>
      params.filter((value) => typeof value === 'string' && value.startsWith('가계부에 이미 있음:')).length)
    expect(notesPerWrite.every((size) => size > 0 && size <= 500)).toBe(true)
    expect(notesPerWrite.reduce((sum, size) => sum + size, 0)).toBe(count)
  },
)

test('no pending snapshot performs no writes or transaction', async () => {
  const capture = captureRefresh(0)
  expect(await capture.run()).toBe(0)
  expect(capture.writes).toEqual([])
  expect(capture.transactionCount()).toBe(0)
})

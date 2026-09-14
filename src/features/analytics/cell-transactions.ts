'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { CategoryDetailFlow, CellTransactionResult } from './category-detail'

export type CellRequest = {
  flow: CategoryDetailFlow
  year: number
  month: number
  major: string
  sub: string | null
  closed: boolean
  revision: number
}

const SEPARATOR = String.fromCharCode(0)
const NO_SUB = String.fromCharCode(2)

/** Null sub and empty sub must never share a cache entry, and a category name must not be able to forge another key. */
export function cellCacheKey(major: string, sub: string | null, month: number) {
  return [major, sub === null ? NO_SUB : sub, String(month)].join(SEPARATOR)
}

export function useCellTransactions() {
  const [data, setData] = useState<CellTransactionResult | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const cache = useRef(new Map<string, CellTransactionResult>())
  const active = useRef<string | null>(null)
  const request = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const abort = useCallback(() => {
    request.current?.abort()
    request.current = null
  }, [])

  const close = useCallback(() => {
    clearTimer()
    abort()
    active.current = null
    setKey(null)
    setData(null)
  }, [abort, clearTimer])

  const reset = useCallback(() => {
    cache.current.clear()
    setStale(false)
    close()
  }, [close])

  useEffect(() => () => { clearTimer(); abort() }, [abort, clearTimer])

  const open = useCallback((cell: CellRequest, delay: number) => {
    clearTimer()
    abort()
    const cellKey = cellCacheKey(cell.major, cell.sub, cell.month)
    active.current = cellKey
    const load = async () => {
      const cached = cache.current.get(cellKey)
      if (cached) {
        if (active.current === cellKey) { setKey(cellKey); setData(cached) }
        return
      }
      const controller = new AbortController()
      request.current = controller
      const params = new URLSearchParams({
        flow: cell.flow,
        year: String(cell.year),
        month: String(cell.month),
        major: cell.major,
      })
      if (cell.sub !== null) params.set('sub', cell.sub)
      if (cell.closed) {
        params.set('scope', 'closed')
        params.set('revision', String(cell.revision))
      } else {
        params.set('scope', 'live')
      }
      try {
        const response = await fetch(`/api/cell-tx?${params}`, { signal: controller.signal })
        if (response.status === 409) {
          cache.current.clear()
          setStale(true)
          close()
          return
        }
        if (!response.ok) return
        const next = await response.json() as CellTransactionResult
        cache.current.set(cellKey, next)
        if (active.current === cellKey) { setKey(cellKey); setData(next) }
      } catch {
        // An interrupted lookup must never break the table.
      } finally {
        if (request.current === controller) request.current = null
      }
    }
    if (delay === 0) { void load(); return }
    timer.current = setTimeout(() => { void load() }, delay)
  }, [abort, clearTimer, close])

  return { data, key, stale, open, close, reset }
}

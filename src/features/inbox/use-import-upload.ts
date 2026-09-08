'use client'

import { useRouter } from 'next/navigation'
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'

import { ImportFailure, type ImportEvent, type ImportFailureCode, type ImportPhase, type ImportResult } from './import-progress'
import { readImportStream } from './import-stream'

export type ImportMode = 'banksalad' | 'card'

export type ImportUploadState =
  | { status: 'idle' }
  | { status: 'processing'; mode: ImportMode; stage?: { phase: ImportPhase; completed?: number; total?: number } }
  | { status: 'completed'; mode: ImportMode; result: ImportResult }
  | { status: 'error'; mode: ImportMode; code: ImportFailureCode; message: string }

export type ImportUploadOutcome = Extract<ImportUploadState, { status: 'completed' | 'error' }> | null

const connectionLost = new ImportFailure('connection_lost')

export function useImportUpload() {
  const router = useRouter()
  const [state, setState] = useState<ImportUploadState>({ status: 'idle' })
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const request = useRef<AbortController | null>(null)
  const focusTarget = useRef<HTMLElement | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (state.status !== 'processing') return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [state.status])

  const upload = useCallback(async (mode: ImportMode, data: FormData): Promise<ImportUploadOutcome> => {
    if (inFlight.current) return null
    inFlight.current = true
    data.set('mode', mode)
    const controller = new AbortController()
    request.current = controller
    focusTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setState({ status: 'processing', mode })

    try {
      const response = await fetch('/api/import', { method: 'POST', body: data, signal: controller.signal })
      const result = await readImportStream(response, (event: ImportEvent) => {
        if (!mounted.current || event.type !== 'stage') return
        setState({
          status: 'processing',
          mode,
          stage: {
            phase: event.phase,
            completed: event.completed,
            total: event.total,
          },
        })
      })
      const completed: ImportUploadOutcome = { status: 'completed', mode, result }
      if (mounted.current) {
        setState(completed)
        startTransition(() => router.refresh())
      }
      return completed
    } catch (error) {
      const failure = error instanceof ImportFailure ? error : connectionLost
      const failed: ImportUploadOutcome = { status: 'error', mode, code: failure.code, message: failure.message }
      if (mounted.current) setState(failed)
      return failed
    } finally {
      request.current = null
      inFlight.current = false
    }
  }, [router])

  const close = useCallback(() => {
    setState((current) => current.status === 'processing' ? current : { status: 'idle' })
  }, [])
  const restoreFocus = useCallback(() => focusTarget.current?.focus(), [])

  return {
    state,
    upload,
    close,
    restoreFocus,
    isProcessing: state.status === 'processing',
  }
}

export type ImportUploadController = ReturnType<typeof useImportUpload>

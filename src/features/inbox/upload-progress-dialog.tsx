'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { ImportPhase } from './import-progress'
import type { ImportUploadState } from './use-import-upload'

const phaseLabels: Record<ImportPhase, string> = {
  validating: '업로드 입력 확인',
  reading: '거래 내역 읽기',
  matching: '기존 거래와 중복 확인',
  classifying: '결제수단과 카테고리 분류',
  saving: '인박스에 저장',
  finalizing: '처리 결과 마무리',
}

export function UploadProgressDialog({
  state,
  onClose,
  restoreFocus,
}: {
  state: ImportUploadState
  onClose: () => void
  restoreFocus: () => void
}) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [portalReady, setPortalReady] = useState(false)
  const visible = state.status !== 'idle'

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    if (!visible || !portalReady || !dialog.current) return
    if (!dialog.current.open) dialog.current.showModal()
    const activeDialog = dialog.current
    return () => {
      if (activeDialog.open) activeDialog.close()
      restoreFocus()
    }
  }, [portalReady, restoreFocus, visible])

  if (!portalReady || state.status === 'idle') return null

  const processing = state.status === 'processing'
  const reviewAvailable = state.status === 'completed'
    || (state.status === 'error' && (state.code === 'processing_failed' || state.code === 'connection_lost'))
  const stage = state.status === 'processing' ? state.stage : undefined
  const hasCounts = stage?.completed !== undefined && stage.total !== undefined

  return createPortal(
    <dialog
      aria-label="거래 파일 처리 진행"
      className="import-upload-dialog"
      closedby={processing ? 'none' : 'closerequest'}
      onCancel={(event) => {
        if (processing) {
          event.preventDefault()
          return
        }
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !processing) onClose()
      }}
      ref={dialog}
    >
      <div className="import-upload-dialog__panel">
        {processing && (
          <>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="import-upload-dialog__spinner mt-0.5" />
              <div className="min-w-0 flex-1">
                <h3 className="t-section text-finance-ink">거래 파일을 처리하고 있습니다</h3>
                <p aria-live="polite" className="mt-1 t-body text-finance-muted">
                  {stage ? phaseLabels[stage.phase] : '파일 전송 중'}
                </p>
              </div>
              {hasCounts && (
                <span className="t-body-strong tabular-nums text-finance-blue">
                  {stage.completed}/{stage.total}
                </span>
              )}
            </div>
            {hasCounts ? (
              <progress
                aria-label={`${phaseLabels[stage.phase]} 처리량`}
                className="import-upload-dialog__progress mt-5"
                max={stage.total}
                value={stage.completed}
              />
            ) : (
              <progress aria-label="현재 단계 처리 중" className="import-upload-dialog__progress mt-5" />
            )}
            <p className="mt-5 border-t border-finance-border pt-4 t-caption text-finance-muted">
              표시되는 수치는 현재 단계의 처리량이며 전체 완료 시간은 아닙니다. 느린 AI 확인은 30초 뒤 검토 대상으로 남을 수 있습니다.
            </p>
            <p className="mt-2 t-caption text-finance-faint">처리 중에는 이 창을 닫거나 다른 화면을 사용할 수 없습니다.</p>
          </>
        )}

        {state.status === 'completed' && (
          <>
            <p className="t-label uppercase text-finance-green">처리 완료</p>
            <h3 className="mt-2 t-section text-finance-ink">{state.result.message}</h3>
            <dl className="mt-5 grid grid-cols-2 gap-px border border-finance-border bg-finance-border">
              {[
                ['새로 추가', state.result.added],
                ['이미 처리', state.result.alreadyProcessed],
                ['자동 분류', state.result.automatic],
                ['검토 필요', state.result.review],
              ].map(([label, value]) => (
                <div className="bg-white p-3" key={label}>
                  <dt className="t-caption text-finance-muted">{label}</dt>
                  <dd className="mt-1 t-section tabular-nums text-finance-ink">{Number(value).toLocaleString('ko-KR')}건</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {state.status === 'error' && (
          <>
            <p className="t-label uppercase text-finance-red">처리 확인 필요</p>
            <h3 className="mt-2 t-section text-finance-ink">파일 처리를 완료하지 못했습니다</h3>
            <p className="mt-3 border-l-2 border-finance-red py-1 pl-3 t-body text-finance-muted">{state.message}</p>
            {(state.code === 'processing_failed' || state.code === 'connection_lost') && (
              <p className="mt-3 t-caption text-finance-muted">
                일부 거래가 이미 저장되었을 수 있습니다. 자동으로 다시 시도하지 말고 인박스에서 결과를 먼저 확인해 주세요.
              </p>
            )}
          </>
        )}

        {!processing && (
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-finance-border pt-4">
            {reviewAvailable && (
              <button
                className="inline-flex h-[34px] items-center border border-finance-ink px-4 t-body-strong text-finance-ink hover:bg-finance-track"
                onClick={() => {
                  onClose()
                  router.push('/inbox?tab=review')
                }}
                type="button"
              >
                검토 대기 보기
              </button>
            )}
            {state.status === 'error' && (
              <button className="h-[34px] border border-finance-ink px-4 t-body-strong text-finance-ink hover:bg-finance-track" onClick={onClose} type="button">
                입력으로 돌아가기
              </button>
            )}
            {state.status === 'completed' && (
              <button className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:bg-finance-blue" onClick={onClose} type="button">
                닫기
              </button>
            )}
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  )
}

'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  uploadBanksaladFiles,
  uploadCardStatement,
  type UploadBanksaladState,
  type UploadCardState,
} from './upload-action'
import { suggestCardAccountId } from './account-match'

const initialBanksaladState: UploadBanksaladState = {}
const initialCardState: UploadCardState = {}

type CardIssuerOption = { key: string; label: string }
type AccountOption = { id: number; name: string; owner: string | null; type: string | null }

function suggestedCardAccount(
  issuers: CardIssuerOption[],
  accounts: AccountOption[],
  issuerKey: string,
  owner: string,
) {
  const issuerLabel = issuers.find((issuer) => issuer.key === issuerKey)?.label
  if (!issuerLabel) return ''
  return String(suggestCardAccountId(accounts, issuerLabel, owner) ?? '')
}

function UploadButton({ disabled = false, uploading }: { disabled?: boolean; uploading?: boolean }) {
  const { pending: formPending } = useFormStatus()
  const pending = uploading ?? formPending
  return (
    <button
      className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:bg-finance-blue disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending || disabled}
      type="submit"
    >
      {pending ? '파일 분석 중…' : '인박스로 불러오기'}
    </button>
  )
}

const uploadSteps = {
  banksalad: [
    '파일 업로드',
    '엑셀 거래·자산 내역 읽기',
    '기존 거래와 중복 확인',
    '결제수단·카테고리 추천',
    '필요한 거래 AI 보조 분류',
    '인박스와 자산에 저장',
  ],
  card: [
    '파일 업로드',
    '보안 명세서 해제 · 카드 거래 읽기',
    '기존 거래와 중복 확인',
    '카드·카테고리 추천',
    '필요한 거래 AI 보조 분류',
    '인박스에 저장',
  ],
} as const

function ActiveUploadProgress({ mode }: { mode: keyof typeof uploadSteps }) {
  const [stepIndex, setStepIndex] = useState(0)
  const steps = uploadSteps[mode]

  useEffect(() => {
    const timers = [700, 1_500, 2_600, 4_000, 5_800].map((delay, index) =>
      window.setTimeout(() => setStepIndex(index + 1), delay),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [])

  const progress = Math.round(((stepIndex + 1) / steps.length) * 100)
  return (
    <div
      aria-label="거래 파일 처리 진행"
      aria-live="polite"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-finance-ink/50 px-5"
      role="dialog"
    >
      <div className="w-full max-w-md border border-finance-ink bg-white p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 h-5 w-5 animate-spin rounded-full border-2 border-finance-border border-t-finance-blue" />
          <div className="min-w-0 flex-1">
            <h3 className="t-section text-finance-ink">거래 파일을 처리하고 있습니다</h3>
            <p className="mt-1 t-body text-finance-muted">{steps[stepIndex]}</p>
          </div>
          <span className="t-body-strong tabular-nums text-finance-blue">
            {stepIndex + 1}/{steps.length}
          </span>
        </div>
        <div
          aria-label={`업로드 진행률 ${progress}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="mt-5 h-[5px] bg-finance-track"
          role="progressbar"
        >
          <div
            className="h-full bg-finance-blue transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <ol className="mt-5 grid gap-2 t-caption">
          {steps.map((step, index) => (
            <li
              className={`flex items-center gap-2 ${
                index < stepIndex
                  ? 'text-finance-green'
                  : index === stepIndex
                    ? 'font-semibold text-finance-ink'
                    : 'text-finance-faint'
              }`}
              key={step}
            >
              <span aria-hidden="true" className="w-4 text-center">
                {index < stepIndex ? '✓' : index === stepIndex ? '●' : '○'}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-finance-border pt-4 t-caption text-finance-muted">
          거래가 많거나 AI 확인이 필요한 경우 잠시 더 걸릴 수 있습니다. 창을 닫지 말아 주세요.
        </p>
      </div>
    </div>
  )
}

function UploadProgress({ mode }: { mode: keyof typeof uploadSteps }) {
  const { pending } = useFormStatus()
  return pending ? <ActiveUploadProgress mode={mode} /> : null
}

function ActionMessage({ state }: { state: UploadBanksaladState }) {
  return (
    <>
      {state.error && <p className="border-l-2 border-finance-red py-1 pl-3 t-body text-finance-red sm:col-span-full">{state.error}</p>}
      {state.message && (
        <p className="border-l-2 border-finance-green py-1 pl-3 t-body text-finance-muted sm:col-span-full">
          {state.message}
        </p>
      )}
    </>
  )
}

function BanksaladForm() {
  const [state, action] = useActionState(uploadBanksaladFiles, initialBanksaladState)
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <input name="asset_include" type="hidden" value="off" />
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        DJ·YJ 뱅크샐러드 파일
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-[34px] border border-dashed border-finance-border bg-white px-2 py-1 t-body font-normal normal-case tracking-normal text-finance-muted file:mr-3 file:border-0 file:bg-finance-track file:px-3 file:py-1 file:font-semibold file:text-finance-ink hover:file:text-finance-blue"
          multiple
          name="files"
          required
          type="file"
        />
        <span className="font-normal normal-case tracking-normal text-finance-faint">.xlsx · 최대 2개 · 파일당 2MB</span>
      </label>
      <div className="sm:pt-[23px]"><UploadButton /></div>
      <label className="flex items-center gap-2 t-caption text-finance-muted sm:col-span-full">
        <input className="h-4 w-4 accent-finance-ink" defaultChecked name="asset_include" type="checkbox" value="on" />
        뱅크샐러드 자산·대출 현황을 해당 월 자산 스냅샷에 함께 반영
      </label>
      <ActionMessage state={state} />
      <UploadProgress mode="banksalad" />
    </form>
  )
}

function CardStatementForm({
  issuers,
  accounts,
}: {
  issuers: CardIssuerOption[]
  accounts: AccountOption[]
}) {
  const [state, setState] = useState<UploadCardState>(initialCardState)
  const [uploading, setUploading] = useState(false)
  const inFlight = useRef(false)
  const passwordInput = useRef<HTMLInputElement>(null)
  const initialIssuer = issuers[0]?.key ?? ''
  const [issuer, setIssuer] = useState(initialIssuer)
  const [owner, setOwner] = useState('DJ')
  const accountId = suggestedCardAccount(issuers, accounts, issuer, owner)
  const matchedAccount = accounts.find((account) => String(account.id) === accountId)

  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[160px_120px_220px_minmax(0,1fr)_auto] lg:items-start"
      onSubmit={async (event) => {
        event.preventDefault()
        if (inFlight.current) return
        const form = event.currentTarget
        const formData = new FormData(form)
        inFlight.current = true
        setUploading(true)
        setState({})
        try {
          const result = await uploadCardStatement(formData)
          setState(result)
          // A failed password must not reset the selected file. On success only
          // clear the file; the controlled issuer/owner stay where the user left them.
          if (!result.error) {
            const file = form.elements.namedItem('file') as HTMLInputElement | null
            if (file) file.value = ''
          }
        } catch {
          setState({ error: '파일을 처리하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.' })
        } finally {
          if (passwordInput.current) passwordInput.current.value = ''
          formData.delete('password')
          inFlight.current = false
          setUploading(false)
        }
      }}
    >
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        카드사
        <select
          className="h-[34px] border border-finance-border bg-white px-3 t-body font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
          name="issuer"
          disabled={uploading}
          onChange={(event) => {
            const nextIssuer = event.target.value
            setIssuer(nextIssuer)
            if (passwordInput.current) passwordInput.current.value = ''
            setState({})
          }}
          required
          value={issuer}
        >
          {issuers.map((issuer) => <option key={issuer.key} value={issuer.key}>{issuer.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        소유자
        <select
          className="h-[34px] border border-finance-border bg-white px-3 t-body font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
          name="owner"
          disabled={uploading}
          onChange={(event) => {
            const nextOwner = event.target.value
            setOwner(nextOwner)
          }}
          required
          value={owner}
        >
          <option value="DJ">DJ</option>
          <option value="YJ">YJ</option>
        </select>
      </label>
      <div className="grid gap-1.5 t-label uppercase text-finance-muted">
        <span>기본 카드</span>
        <div
          aria-label="자동 선택된 기본 카드"
          aria-live="polite"
          data-account-id={matchedAccount?.id}
          className={`flex h-[34px] items-center justify-between gap-2 border px-3 t-body font-normal normal-case tracking-normal ${matchedAccount ? 'border-finance-border bg-finance-panel text-finance-ink' : 'border-finance-red text-finance-red'}`}
        >
          <span>{matchedAccount?.name ?? '일치하는 카드 없음'}</span>
          <span className="shrink-0 t-badge text-finance-faint">자동 고정</span>
        </div>
        <span className={`font-normal normal-case tracking-normal ${matchedAccount ? 'text-finance-faint' : 'text-finance-red'}`}>
          {matchedAccount
            ? '카드사와 소유자로 자동 선택됩니다.'
            : '결제수단 관리에서 카드사와 소유자가 맞는 카드를 확인해 주세요.'}
        </span>
      </div>
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        카드사 명세서
        <input
          accept={`${issuer === 'hyundai' ? '.html,.htm,text/html,' : ''}.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`}
          className="h-[34px] border border-dashed border-finance-border bg-white px-2 py-1 t-body font-normal normal-case tracking-normal text-finance-muted file:mr-3 file:border-0 file:bg-finance-track file:px-3 file:py-1 file:font-semibold file:text-finance-ink hover:file:text-finance-blue"
          name="file"
          disabled={uploading}
          onChange={() => {
            if (passwordInput.current) passwordInput.current.value = ''
            setState({})
          }}
          required
          type="file"
        />
        <span className="font-normal normal-case tracking-normal text-finance-faint">
          {issuer === 'hyundai' ? '.xls · .xlsx · .html (보안 명세서 포함)' : '.xls 또는 .xlsx'} · 2MB 이하
        </span>
      </label>
      <div className="sm:pt-[23px]"><UploadButton disabled={!matchedAccount} uploading={uploading} /></div>
      {issuer === 'hyundai' && (
        <label className="grid gap-1.5 t-label text-finance-muted sm:col-span-full">
          <span>보안 명세서 비밀번호</span>
          <input
            aria-label="보안 명세서 비밀번호"
            autoComplete="off"
            className="h-[34px] w-full max-w-sm border border-finance-border bg-white px-3 t-body text-finance-ink outline-none focus:border-finance-blue"
            disabled={uploading}
            maxLength={128}
            name="password"
            placeholder="보안 HTML인 경우만 입력"
            ref={passwordInput}
            type="password"
          />
          <span className="font-normal text-finance-faint">
            비밀번호는 이번 파일을 여는 데만 사용하며 저장하지 않습니다. 일반 HTML·엑셀은 비워 두세요.
          </span>
        </label>
      )}
      <ActionMessage state={state} />
      {uploading && <ActiveUploadProgress mode="card" />}
    </form>
  )
}

export function InboxUploadForm({
  cardIssuers,
  accounts,
}: {
  cardIssuers: CardIssuerOption[]
  accounts: AccountOption[]
}) {
  const [mode, setMode] = useState<'banksalad' | 'card'>('banksalad')
  return (
    <div>
      <div className="mt-4 inline-flex border border-finance-ink" role="tablist" aria-label="가져오기 파일 유형">
        <button
          aria-selected={mode === 'banksalad'}
          className={`h-8 px-4 t-caption font-medium ${mode === 'banksalad' ? 'bg-finance-ink font-semibold text-white' : 'text-finance-muted hover:bg-finance-track'}`}
          onClick={() => setMode('banksalad')}
          role="tab"
          type="button"
        >
          뱅크샐러드
        </button>
        <button
          aria-selected={mode === 'card'}
          className={`h-8 border-l border-finance-ink px-4 t-caption font-medium ${mode === 'card' ? 'bg-finance-ink font-semibold text-white' : 'text-finance-muted hover:bg-finance-track'}`}
          onClick={() => setMode('card')}
          role="tab"
          type="button"
        >
          카드사 명세서
        </button>
      </div>
      {mode === 'banksalad'
        ? <BanksaladForm />
        : <CardStatementForm accounts={accounts} issuers={cardIssuers} />}
    </div>
  )
}

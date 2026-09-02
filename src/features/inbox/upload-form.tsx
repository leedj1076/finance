'use client'

import { useActionState, useEffect, useState } from 'react'
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

function UploadButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
    '카드 명세서 거래 읽기',
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/45 px-5 backdrop-blur-[2px]"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-zinc-950">거래 파일을 처리하고 있습니다</h3>
            <p className="mt-1 text-sm text-zinc-600">{steps[stepIndex]}</p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-emerald-700">
            {stepIndex + 1}/{steps.length}
          </span>
        </div>
        <div
          aria-label={`업로드 진행률 ${progress}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-100"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <ol className="mt-5 grid gap-2 text-xs">
          {steps.map((step, index) => (
            <li
              className={`flex items-center gap-2 ${
                index < stepIndex
                  ? 'text-emerald-700'
                  : index === stepIndex
                    ? 'font-semibold text-zinc-900'
                    : 'text-zinc-400'
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
        <p className="mt-5 text-xs leading-5 text-zinc-500">
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
      {state.error && <p className="text-sm text-red-700 sm:col-span-full">{state.error}</p>}
      {state.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-full">
          {state.message}
        </p>
      )}
    </>
  )
}

function BanksaladForm() {
  const [state, action] = useActionState(uploadBanksaladFiles, initialBanksaladState)
  return (
    <form action={action} className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <input name="asset_include" type="hidden" value="off" />
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        DJ·YJ 뱅크샐러드 파일
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
          multiple
          name="files"
          required
          type="file"
        />
        <span className="font-normal text-zinc-500">.xlsx · 최대 2개 · 파일당 2MB</span>
      </label>
      <UploadButton />
      <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-full">
        <input className="h-4 w-4 accent-emerald-700" defaultChecked name="asset_include" type="checkbox" value="on" />
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
  const [state, action] = useActionState(
    async (_previousState: UploadCardState, formData: FormData) => uploadCardStatement(formData),
    initialCardState,
  )
  const initialIssuer = issuers[0]?.key ?? ''
  const [issuer, setIssuer] = useState(initialIssuer)
  const [owner, setOwner] = useState('DJ')
  const accountId = suggestedCardAccount(issuers, accounts, issuer, owner)
  const matchedAccount = accounts.find((account) => String(account.id) === accountId)

  return (
    <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[160px_120px_220px_minmax(0,1fr)_auto] lg:items-end">
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        카드사
        <select
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal"
          name="issuer"
          onChange={(event) => {
            const nextIssuer = event.target.value
            setIssuer(nextIssuer)
          }}
          required
          value={issuer}
        >
          {issuers.map((issuer) => <option key={issuer.key} value={issuer.key}>{issuer.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        소유자
        <select
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal"
          name="owner"
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
      <div className="grid gap-1.5 text-sm font-medium text-zinc-700">
        <span>기본 카드</span>
        <div
          aria-live="polite"
          className={`flex min-h-[43px] items-center justify-between gap-2 rounded-lg border px-3 py-2.5 font-normal ${matchedAccount ? 'border-zinc-300 bg-zinc-50 text-zinc-800' : 'border-rose-300 bg-rose-50 text-rose-700'}`}
        >
          <span>{matchedAccount?.name ?? '일치하는 카드 없음'}</span>
          <span className="shrink-0 text-[11px] font-semibold text-zinc-400">자동 고정</span>
        </div>
        <span className={`font-normal ${matchedAccount ? 'text-zinc-500' : 'text-rose-600'}`}>
          {matchedAccount
            ? '카드사와 소유자로 자동 선택됩니다.'
            : '결제수단 관리에서 카드사와 소유자가 맞는 카드를 확인해 주세요.'}
        </span>
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        카드사 명세서
        <input
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
          name="file"
          required
          type="file"
        />
        <span className="font-normal text-zinc-500">.xls 또는 .xlsx · 2MB 이하</span>
      </label>
      <UploadButton disabled={!matchedAccount} />
      <ActionMessage state={state} />
      <UploadProgress mode="card" />
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
      <div className="mt-4 inline-flex rounded-lg bg-zinc-100 p-1" role="tablist" aria-label="가져오기 파일 유형">
        <button
          aria-selected={mode === 'banksalad'}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === 'banksalad' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-600'}`}
          onClick={() => setMode('banksalad')}
          role="tab"
          type="button"
        >
          뱅크샐러드
        </button>
        <button
          aria-selected={mode === 'card'}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === 'card' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-600'}`}
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

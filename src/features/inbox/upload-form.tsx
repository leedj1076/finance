'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  uploadBanksaladFiles,
  uploadCardStatement,
  type UploadBanksaladState,
  type UploadCardState,
} from './upload-action'

const initialBanksaladState: UploadBanksaladState = {}
const initialCardState: UploadCardState = {}

type CardIssuerOption = { key: string; label: string }

function UploadButton() {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? '파일 분석 중…' : '인박스로 불러오기'}
    </button>
  )
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
      <ActionMessage state={state} />
    </form>
  )
}

function CardStatementForm({ issuers }: { issuers: CardIssuerOption[] }) {
  const [state, action] = useActionState(
    async (_previousState: UploadCardState, formData: FormData) => uploadCardStatement(formData),
    initialCardState,
  )
  return (
    <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[180px_140px_minmax(0,1fr)_auto] lg:items-end">
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        카드사
        <select className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal" name="issuer" required>
          {issuers.map((issuer) => <option key={issuer.key} value={issuer.key}>{issuer.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
        소유자
        <select className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-normal" name="owner" required>
          <option value="DJ">DJ</option>
          <option value="YJ">YJ</option>
        </select>
      </label>
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
      <UploadButton />
      <ActionMessage state={state} />
    </form>
  )
}

export function InboxUploadForm({ cardIssuers }: { cardIssuers: CardIssuerOption[] }) {
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
      {mode === 'banksalad' ? <BanksaladForm /> : <CardStatementForm issuers={cardIssuers} />}
    </div>
  )
}

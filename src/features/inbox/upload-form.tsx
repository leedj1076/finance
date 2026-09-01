'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import {
  uploadBanksaladFiles,
  type UploadBanksaladState,
} from './upload-action'

const initialState: UploadBanksaladState = {}

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

export function BanksaladUploadForm() {
  const [state, action] = useActionState(uploadBanksaladFiles, initialState)

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
      {state.error && <p className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-2">
          {state.message}
        </p>
      )}
    </form>
  )
}

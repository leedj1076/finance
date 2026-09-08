'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'

import { cardAccountCandidates } from './account-match'
import { UploadProgressDialog } from './upload-progress-dialog'
import { type ImportUploadController, useImportUpload } from './use-import-upload'

type CardIssuerOption = { key: string; label: string }
type AccountOption = { id: number; name: string; owner: string | null; type: string | null }

function eligibleCardAccounts(
  issuers: CardIssuerOption[],
  accounts: AccountOption[],
  issuerKey: string,
  owner: string,
) {
  const issuerLabel = issuers.find((issuer) => issuer.key === issuerKey)?.label
  return issuerLabel ? cardAccountCandidates(accounts, issuerLabel, owner) : []
}

function UploadButton({ disabled = false, uploading }: { disabled?: boolean; uploading: boolean }) {
  return (
    <button
      className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:bg-finance-blue disabled:cursor-not-allowed disabled:opacity-50"
      disabled={uploading || disabled}
      type="submit"
    >
      {uploading ? '파일 분석 중…' : '인박스로 불러오기'}
    </button>
  )
}

function BanksaladForm({ controller }: { controller: ImportUploadController }) {
  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const outcome = await controller.upload('banksalad', new FormData(form))
        if (outcome?.status === 'completed') {
          const files = form.elements.namedItem('files') as HTMLInputElement | null
          if (files) files.value = ''
        }
      }}
    >
      <input name="asset_include" type="hidden" value="off" />
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        DJ·YJ 뱅크샐러드 파일
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="h-[34px] border border-dashed border-finance-border bg-white px-2 py-1 t-body font-normal normal-case tracking-normal text-finance-muted file:mr-3 file:border-0 file:bg-finance-track file:px-3 file:py-1 file:font-semibold file:text-finance-ink hover:file:text-finance-blue"
          disabled={controller.isProcessing}
          multiple
          name="files"
          required
          type="file"
        />
        <span className="font-normal normal-case tracking-normal text-finance-faint">.xlsx · 최대 2개 · 파일당 2MB</span>
      </label>
      <div className="sm:pt-[23px]"><UploadButton uploading={controller.isProcessing} /></div>
      <label className="flex items-center gap-2 t-caption text-finance-muted sm:col-span-full">
        <input className="h-4 w-4 accent-finance-ink" defaultChecked disabled={controller.isProcessing} name="asset_include" type="checkbox" value="on" />
        뱅크샐러드 자산·대출 현황을 해당 월 자산 스냅샷에 함께 반영
      </label>
    </form>
  )
}

function CardStatementForm({
  issuers,
  accounts,
  controller,
}: {
  issuers: CardIssuerOption[]
  accounts: AccountOption[]
  controller: ImportUploadController
}) {
  const passwordInput = useRef<HTMLInputElement>(null)
  const initialIssuer = issuers[0]?.key ?? ''
  const [issuer, setIssuer] = useState(initialIssuer)
  const [fileName, setFileName] = useState('')
  const [owner, setOwner] = useState('DJ')
  const candidates = useMemo(
    () => eligibleCardAccounts(issuers, accounts, issuer, owner),
    [accounts, issuer, issuers, owner],
  )
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const accountId = candidates.length === 1
    ? String(candidates[0].id)
    : candidates.some((account) => String(account.id) === selectedAccountId)
      ? selectedAccountId
      : ''
  const matchedAccount = candidates.find((account) => String(account.id) === accountId)

  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[160px_120px_220px_minmax(0,1fr)_auto] lg:items-start"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const formData = new FormData(form)
        const outcome = await controller.upload('card', formData)
        if (passwordInput.current) passwordInput.current.value = ''
        formData.delete('password')
        if (outcome?.status === 'completed') {
          const file = form.elements.namedItem('file') as HTMLInputElement | null
          if (file) file.value = ''
        }
      }}
    >
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        카드사
        <select
          className="h-[34px] border border-finance-border bg-white px-3 t-body font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
          disabled={controller.isProcessing}
          name="issuer"
          onChange={(event) => {
            setIssuer(event.target.value)
            setSelectedAccountId('')
            if (passwordInput.current) passwordInput.current.value = ''
          }}
          required
          value={issuer}
        >
          {issuers.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        소유자
        <select
          className="h-[34px] border border-finance-border bg-white px-3 t-body font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
          disabled={controller.isProcessing}
          name="owner"
          onChange={(event) => {
            setOwner(event.target.value)
            setSelectedAccountId('')
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
        {candidates.length === 0 ? (
          <div aria-live="polite" className="flex min-h-[34px] items-center justify-between gap-2 border border-finance-red px-3 t-body font-normal normal-case tracking-normal text-finance-red">
            <span>일치하는 카드 없음</span>
            <Link className="shrink-0 font-semibold underline underline-offset-2" href="/manage?tab=accounts">결제수단 관리</Link>
          </div>
        ) : candidates.length === 1 ? (
          <>
            <input name="accountId" type="hidden" value={accountId} />
            <div aria-label="자동 선택된 기본 카드" aria-live="polite" className="flex h-[34px] items-center justify-between gap-2 border border-finance-border bg-finance-panel px-3 t-body font-normal normal-case tracking-normal text-finance-ink" data-account-id={matchedAccount?.id}>
              <span>{matchedAccount?.name}</span>
              <span className="shrink-0 t-badge text-finance-faint">자동 고정</span>
            </div>
          </>
        ) : (
          <select
            aria-label="기본 카드"
            className="h-[34px] border border-finance-border bg-white px-3 t-body font-normal normal-case tracking-normal text-finance-ink outline-none focus:border-finance-blue"
            disabled={controller.isProcessing}
            name="accountId"
            onChange={(event) => setSelectedAccountId(event.target.value)}
            required
            value={accountId}
          >
            <option value="">기본 카드를 선택해 주세요</option>
            {candidates.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        )}
        <span className={`font-normal normal-case tracking-normal ${candidates.length === 0 ? 'text-finance-red' : 'text-finance-faint'}`}>
          {candidates.length === 0
            ? '카드사와 소유자가 맞는 활성 카드를 등록해 주세요.'
            : '이번 파일의 모든 거래에 적용되며, 가져온 뒤 인박스에서 건별로 바꿀 수 있습니다.'}
        </span>
      </div>
      <label className="grid gap-1.5 t-label uppercase text-finance-muted">
        카드사 명세서
        <input
          accept={`${issuer === 'hyundai' ? '.html,.htm,text/html,' : issuer === 'nonghyup' ? '.pdf,application/pdf,' : ''}.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`}
          className="h-[34px] border border-dashed border-finance-border bg-white px-2 py-1 t-body font-normal normal-case tracking-normal text-finance-muted file:mr-3 file:border-0 file:bg-finance-track file:px-3 file:py-1 file:font-semibold file:text-finance-ink hover:file:text-finance-blue"
          disabled={controller.isProcessing}
          name="file"
          onChange={(event) => {
            setFileName(event.target.files?.[0]?.name ?? '')
            if (passwordInput.current) passwordInput.current.value = ''
          }}
          required
          type="file"
        />
        <span className="font-normal normal-case tracking-normal text-finance-faint">
          {issuer === 'hyundai' ? '.xls · .xlsx · .html (보안 명세서 포함)' : issuer === 'nonghyup' ? '.xls · .xlsx · .pdf (암호화 명세서 포함)' : '.xls 또는 .xlsx'} · 2MB 이하
        </span>
      </label>
      <div className="sm:pt-[23px]"><UploadButton disabled={!matchedAccount} uploading={controller.isProcessing} /></div>
      {((issuer === 'hyundai' && /\.html?$/i.test(fileName)) || (issuer === 'nonghyup' && /\.pdf$/i.test(fileName))) && (
        <label className="grid gap-1.5 t-label text-finance-muted sm:col-span-full">
          <span>보안 명세서 비밀번호</span>
          <input
            aria-label="보안 명세서 비밀번호"
            autoComplete="off"
            className="h-[34px] w-full max-w-sm border border-finance-border bg-white px-3 t-body text-finance-ink outline-none focus:border-finance-blue"
            disabled={controller.isProcessing}
            maxLength={128}
            name="password"
            placeholder={issuer === 'nonghyup' ? '암호화 PDF인 경우만 입력' : '보안 HTML인 경우만 입력'}
            ref={passwordInput}
            type="password"
          />
          <span className="font-normal text-finance-faint">비밀번호는 이번 파일을 여는 데만 사용하며 저장하지 않습니다. 암호가 없는 파일은 비워 두세요.</span>
        </label>
      )}
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
  const controller = useImportUpload()
  return (
    <div>
      <div aria-label="가져오기 파일 유형" className="mt-4 inline-flex border border-finance-ink" role="tablist">
        <button
          aria-selected={mode === 'banksalad'}
          className={`h-8 px-4 t-caption font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'banksalad' ? 'bg-finance-ink font-semibold text-white' : 'text-finance-muted hover:bg-finance-track'}`}
          disabled={controller.isProcessing}
          onClick={() => setMode('banksalad')}
          role="tab"
          type="button"
        >
          뱅크샐러드
        </button>
        <button
          aria-selected={mode === 'card'}
          className={`h-8 border-l border-finance-ink px-4 t-caption font-medium disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'card' ? 'bg-finance-ink font-semibold text-white' : 'text-finance-muted hover:bg-finance-track'}`}
          disabled={controller.isProcessing}
          onClick={() => setMode('card')}
          role="tab"
          type="button"
        >
          카드사 명세서
        </button>
      </div>
      {mode === 'banksalad'
        ? <BanksaladForm controller={controller} />
        : <CardStatementForm accounts={accounts} controller={controller} issuers={cardIssuers} />}
      <UploadProgressDialog onClose={controller.close} restoreFocus={controller.restoreFocus} state={controller.state} />
    </div>
  )
}

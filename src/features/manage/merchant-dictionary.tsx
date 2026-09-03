'use client'

import { useState } from 'react'

import { SubmitButton } from '@/components/submit-button'

import {
  deleteMerchantLookup,
  toggleAlwaysConfirm,
  updateMerchantLookupCategory,
} from './actions'
import type { BulkClassificationFlow } from './bulk-classification'

type DictionaryCategory = {
  id: number
  kind: BulkClassificationFlow
  major: string
  sub: string
}

type DictionaryEntry = {
  id: number
  normMerchant: string
  displayMerchant: string | null
  businessType: string | null
  categoryId: number | null
  flow: BulkClassificationFlow
  source: string
  confidence: string
  aiNote: string | null
  alwaysConfirm: boolean
  hitCount: number
  lastUsedAt: Date | string | null
}

type MerchantDictionaryProps = {
  categories: DictionaryCategory[]
  entries: DictionaryEntry[]
}

const inputClass = 'h-[34px] border border-finance-hairline bg-white px-3 t-body text-finance-ink outline-none focus:border-finance-blue'
const saveButton = 'h-[34px] bg-finance-ink px-3 t-body-strong text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60'

const flowLabels: Record<BulkClassificationFlow, string> = {
  expense: '지출',
  income: '수입',
  saving: '저축',
}

function DictionaryRow({
  categories,
  entry,
}: {
  categories: DictionaryCategory[]
  entry: DictionaryEntry
}) {
  const [flow, setFlow] = useState(entry.flow)
  const [categoryId, setCategoryId] = useState(String(entry.categoryId ?? ''))
  const visibleCategories = categories.filter((category) => category.kind === flow)
  const merchantName = entry.displayMerchant || entry.normMerchant
  const lastUsed = entry.lastUsedAt
    ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(entry.lastUsedAt))
    : '사용 기록 없음'

  return (
    <article className="grid gap-4 border-b border-finance-hairline py-4 xl:grid-cols-[minmax(220px,1.1fr)_minmax(360px,1.6fr)_auto] xl:items-end">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate t-body font-medium text-finance-ink" title={merchantName}>{merchantName}</h3>
          <span className={`px-2 py-0.5 t-badge ${
            entry.source === 'user'
              ? 'bg-finance-green-tint text-finance-green'
              : 'bg-violet-50 text-violet-700'
          }`}>
            {entry.source === 'user' ? '사용자 확정' : 'AI'}
          </span>
          {entry.alwaysConfirm && (
            <span className="bg-finance-amber-tint px-2 py-0.5 t-badge text-finance-amber">
              항상 확인
            </span>
          )}
        </div>
        <p className="mt-1 truncate t-caption text-finance-faint" title={entry.normMerchant}>
          정규화: {entry.normMerchant}
        </p>
        <p className="mt-2 t-caption text-finance-muted">
          {entry.businessType || '업종 미확인'} · {entry.hitCount.toLocaleString('ko-KR')}회 사용 · {lastUsed}
        </p>
        {entry.aiNote && (
          <p className="mt-1 line-clamp-2 t-caption text-violet-600" title={entry.aiNote}>
            AI 근거: {entry.aiNote}{entry.confidence === 'low' ? ' · 낮은 확신' : ''}
          </p>
        )}
      </div>

      <form action={updateMerchantLookupCategory} className="grid gap-3 sm:grid-cols-[140px_minmax(220px,1fr)_auto] sm:items-end">
        <input name="id" type="hidden" value={entry.id} />
        <label className="grid gap-1 t-caption font-medium text-finance-muted">
          유형
          <select
            className={inputClass}
            name="flow"
            onChange={(event) => {
              setFlow(event.target.value as BulkClassificationFlow)
              setCategoryId('')
            }}
            value={flow}
          >
            {(Object.keys(flowLabels) as BulkClassificationFlow[]).map((value) => (
              <option key={value} value={value}>{flowLabels[value]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 t-caption font-medium text-finance-muted">
          카테고리
          <select
            className={inputClass}
            name="categoryId"
            onChange={(event) => setCategoryId(event.target.value)}
            required
            value={categoryId}
          >
            <option value="">선택</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.major} · {category.sub}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className={saveButton} disabled={!categoryId} pendingLabel="저장 중…" type="submit">
          분류 저장
        </SubmitButton>
      </form>

      <div className="flex flex-wrap gap-2 xl:justify-end">
        <form action={toggleAlwaysConfirm}>
          <input name="id" type="hidden" value={entry.id} />
          <SubmitButton
            className="h-[34px] border border-finance-amber bg-white px-3 t-body-strong text-finance-amber hover:bg-finance-amber-tint"
            pendingLabel="변경 중…"
            type="submit"
          >
            {entry.alwaysConfirm ? '항상 확인 해제' : '항상 확인'}
          </SubmitButton>
        </form>
        <form action={deleteMerchantLookup}>
          <input name="id" type="hidden" value={entry.id} />
          <SubmitButton
            className="h-[34px] px-3 t-body-strong text-finance-red hover:bg-finance-red-tint"
            pendingLabel="삭제 중…"
            type="submit"
          >
            삭제
          </SubmitButton>
        </form>
      </div>
    </article>
  )
}

export function MerchantDictionary({ categories, entries }: MerchantDictionaryProps) {
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <DictionaryRow categories={categories} entry={entry} key={entry.id} />
      ))}
      {entries.length === 0 && (
        <p className="border-y border-dashed border-finance-hairline px-5 py-10 text-center t-body text-finance-muted">
          검색 조건에 맞는 가맹점 사전 항목이 없습니다.
        </p>
      )}
    </div>
  )
}

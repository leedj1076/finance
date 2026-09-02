'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'

import type { TransactionFlow } from '@/features/ledger/transaction-input'
import { formatWon } from '@/lib/finance'

import { saveRecurringRules, type RecurringActionState } from './actions'
import type { RecurringCandidate } from './calculations'
import type { RecurringFlowToken } from './recurring-input'

type RuleDraft = {
  key: string
  id: number | null
  flowToken: RecurringFlowToken
  categoryId: number | null
  memo: string
  amount: string
  accountId: number | null
  day: number
  active: boolean
  generated: boolean
}

type AccountOption = { id: number; name: string }
type CategoryOption = { id: number; kind: TransactionFlow; major: string; sub: string }

const initialState: RecurringActionState = {}

function flowFor(token: RecurringFlowToken): TransactionFlow {
  return token === 'income' ? 'income' : token === 'saving' ? 'saving' : 'expense'
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? '저장 중…' : '정기거래 저장'}
    </button>
  )
}

export function RecurringManager({
  initialRules,
  accounts,
  categories,
  candidates,
  month,
}: {
  initialRules: RuleDraft[]
  accounts: AccountOption[]
  categories: CategoryOption[]
  candidates: RecurringCandidate[]
  month: string
}) {
  const [state, action] = useActionState(saveRecurringRules, initialState)
  const [rules, setRules] = useState<RuleDraft[]>(initialRules)
  const [nextKey, setNextKey] = useState(1)
  const activeTotal = useMemo(
    () => rules
      .filter((rule) => rule.active)
      .reduce((sum, rule) => sum + (Number(rule.amount.replace(/,/g, '')) || 0), 0),
    [rules],
  )

  function updateRule(key: string, values: Partial<RuleDraft>) {
    setRules((current) => current.map((rule) => rule.key === key ? { ...rule, ...values } : rule))
  }

  function addRule(candidate?: RecurringCandidate) {
    const key = `new-${nextKey}`
    setNextKey((current) => current + 1)
    setRules((current) => [...current, {
      key,
      id: null,
      flowToken: 'exp_fix',
      categoryId: null,
      memo: candidate?.name ?? '',
      amount: candidate ? String(candidate.average) : '',
      accountId: accounts[0]?.id ?? null,
      day: candidate?.suggestedDay ?? 1,
      active: true,
      generated: false,
    }])
  }

  function removeNewRule(key: string) {
    setRules((current) => current.filter((rule) => rule.key !== key))
  }

  return (
    <>
      {candidates.length > 0 && (
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-zinc-950">감지된 반복 지출</h2>
            <p className="mt-1 text-xs text-zinc-500">최근 거래에서 3개월 이상 연속으로 나타난 고정비 후보입니다.</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {candidates.map((candidate) => (
              <article className="rounded-xl bg-zinc-50 p-4" key={`${candidate.name}-${candidate.lastDate}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800">{candidate.name}</p>
                    <p className="mt-1 text-xs text-zinc-500">{candidate.months}개월 · 최근 {candidate.lastDate}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-zinc-950">{formatWon(candidate.average)}원</p>
                </div>
                <button
                  aria-label={`${candidate.name} 규칙으로 추가`}
                  className="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                  onClick={() => addRule(candidate)}
                  type="button"
                >
                  규칙으로 추가 →
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <form action={action} className="mt-6">
        <input name="month" type="hidden" value={month} />
        <input
          name="rules"
          type="hidden"
          value={JSON.stringify(rules.map(({ id, flowToken, categoryId, memo, amount, accountId, day, active }) => ({
            id,
            flowToken,
            categoryId,
            memo,
            amount,
            accountId,
            day,
            active,
          })))}
        />
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold text-zinc-950">정기거래 목록</h2>
              <p className="mt-1 text-xs text-zinc-500">사용 중인 전체 규칙 합계 {formatWon(activeTotal)}원</p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-zinc-300 px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={() => addRule()}
                type="button"
              >
                + 새 규칙
              </button>
              <SaveButton />
            </div>
          </div>

          <div className="divide-y divide-zinc-200">
            {rules.map((rule) => {
              const flow = flowFor(rule.flowToken)
              const filteredCategories = categories.filter((category) => category.kind === flow)
              const isNew = rule.id === null
              return (
                <article className={`${rule.active ? 'bg-white' : 'bg-zinc-50 opacity-65'} p-5`} key={rule.key}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                        <input
                          aria-label={`${rule.memo || '새 정기거래'} 사용`}
                          checked={rule.active}
                          className="accent-emerald-700"
                          onChange={(event) => updateRule(rule.key, { active: event.target.checked })}
                          type="checkbox"
                        />
                        사용
                      </label>
                      {rule.generated && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">{month} 반영됨</span>}
                      {isNew && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">새 규칙</span>}
                    </div>
                    {isNew && (
                      <button className="text-xs text-zinc-400 hover:text-rose-700" onClick={() => removeNewRule(rule.key)} type="button">제거</button>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[130px_minmax(180px,1fr)_minmax(180px,1.1fr)_130px_150px_80px]">
                    <label className="text-xs text-zinc-500">
                      구분
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 구분`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
                        onChange={(event) => updateRule(rule.key, {
                          flowToken: event.target.value as RecurringFlowToken,
                          categoryId: null,
                        })}
                        value={rule.flowToken}
                      >
                        <option value="exp_fix">고정지출</option>
                        <option value="exp_var">변동지출</option>
                        <option value="income">수입</option>
                        <option value="saving">저축</option>
                      </select>
                    </label>
                    <label className="text-xs text-zinc-500">
                      분류
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 분류`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
                        onChange={(event) => updateRule(rule.key, { categoryId: event.target.value ? Number(event.target.value) : null })}
                        value={rule.categoryId ?? ''}
                      >
                        <option value="">미분류</option>
                        {filteredCategories.map((category) => (
                          <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-zinc-500">
                      사용내역
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 사용내역`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
                        onChange={(event) => updateRule(rule.key, { memo: event.target.value })}
                        placeholder="예: 통신비 자동이체"
                        type="text"
                        value={rule.memo}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      금액
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 금액`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right text-sm text-zinc-900"
                        inputMode="numeric"
                        onChange={(event) => updateRule(rule.key, { amount: event.target.value })}
                        type="text"
                        value={rule.amount}
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      결제수단
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 결제수단`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
                        onChange={(event) => updateRule(rule.key, { accountId: event.target.value ? Number(event.target.value) : null })}
                        value={rule.accountId ?? ''}
                      >
                        <option value="">선택 안 함</option>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-zinc-500">
                      결제일
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 결제일`}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-right text-sm text-zinc-900"
                        max={31}
                        min={1}
                        onChange={(event) => updateRule(rule.key, { day: Number(event.target.value) })}
                        type="number"
                        value={rule.day}
                      />
                    </label>
                  </div>
                </article>
              )
            })}
            {rules.length === 0 && <p className="px-5 py-12 text-center text-sm text-zinc-500">등록된 정기거래가 없습니다.</p>}
          </div>
        </section>
        {state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}
      </form>
    </>
  )
}

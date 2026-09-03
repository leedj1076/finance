'use client'

import { type ClipboardEvent, type KeyboardEvent, useActionState, useMemo, useState } from 'react'
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
      className="h-[34px] bg-finance-ink px-4 t-body-strong text-white hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
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

  function focusGridCell(form: HTMLFormElement, row: number, column: number) {
    const cell = form.querySelector<HTMLElement>(`[data-grid-row="${row}"][data-grid-column="${column}"]`)
    cell?.focus()
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement
    const row = Number(target.dataset.gridRow)
    const column = Number(target.dataset.gridColumn)
    if (!Number.isInteger(row) || !Number.isInteger(column)) return
    let nextRow = row
    let nextColumn = column
    if (event.key === 'ArrowUp') nextRow -= 1
    else if (event.key === 'ArrowDown' || event.key === 'Enter') nextRow += 1
    else if (event.key === 'ArrowLeft' && target instanceof HTMLSelectElement) nextColumn -= 1
    else if (event.key === 'ArrowRight' && target instanceof HTMLSelectElement) nextColumn += 1
    else return
    const candidate = event.currentTarget.querySelector<HTMLElement>(`[data-grid-row="${nextRow}"][data-grid-column="${nextColumn}"]`)
    if (!candidate) return
    event.preventDefault()
    candidate.focus()
    if (candidate instanceof HTMLInputElement) candidate.select()
  }

  function handleGridPaste(event: ClipboardEvent<HTMLFormElement>) {
    const form = event.currentTarget
    const target = event.target as HTMLElement
    const startRow = Number(target.dataset.gridRow)
    const startColumn = Number(target.dataset.gridColumn)
    const text = event.clipboardData.getData('text/plain')
    if (!Number.isInteger(startRow) || !Number.isInteger(startColumn) || (!text.includes('\t') && !text.includes('\n'))) return
    event.preventDefault()
    const pastedRows = text.trimEnd().split(/\r?\n/).map((row) => row.split('\t'))
    setRules((current) => {
      const next = current.map((rule) => ({ ...rule }))
      pastedRows.forEach((values, rowOffset) => {
        const rule = next[startRow + rowOffset]
        if (!rule) return
        values.forEach((rawValue, columnOffset) => {
          const column = startColumn + columnOffset
          const value = rawValue.trim()
          if (column === 0) {
            const flowTokens: Record<string, RecurringFlowToken> = { 고정지출: 'exp_fix', 변동지출: 'exp_var', 지출: 'exp_fix', 수입: 'income', 저축: 'saving', exp_fix: 'exp_fix', exp_var: 'exp_var', income: 'income', saving: 'saving' }
            if (flowTokens[value]) { rule.flowToken = flowTokens[value]; rule.categoryId = null }
          } else if (column === 1) {
            const category = categories.find((item) => item.kind === flowFor(rule.flowToken) && (String(item.id) === value || `${item.major} · ${item.sub}` === value || item.sub === value))
            rule.categoryId = category?.id ?? null
          } else if (column === 2) rule.memo = value
          else if (column === 3) rule.amount = value.replace(/[,원\s]/g, '')
          else if (column === 4) rule.accountId = accounts.find((item) => item.name === value || String(item.id) === value)?.id ?? null
          else if (column === 5) {
            const day = Number(value)
            if (Number.isInteger(day) && day >= 1 && day <= 31) rule.day = day
          }
        })
      })
      return next
    })
    requestAnimationFrame(() => focusGridCell(form, Math.min(startRow + pastedRows.length - 1, rules.length - 1), startColumn))
  }

  return (
    <>
      {candidates.length > 0 && (
        <section className="mt-6 border-t border-finance-ink py-5">
          <div>
            <h2 className="t-section text-finance-ink">감지된 반복 지출</h2>
            <p className="mt-1 t-caption text-finance-muted">최근 거래에서 3개월 이상 연속으로 나타난 고정비 후보입니다.</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {candidates.map((candidate) => (
              <article className="border-b border-finance-hairline py-4" key={`${candidate.name}-${candidate.lastDate}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate t-body font-medium text-finance-ink">{candidate.name}</p>
                    <p className="mt-1 t-caption text-finance-muted">{candidate.months}개월 · 최근 {candidate.lastDate}</p>
                  </div>
                  <p className="shrink-0 t-body-strong text-finance-ink">{formatWon(candidate.average)}원</p>
                </div>
                <button
                  aria-label={`${candidate.name} 규칙으로 추가`}
                  className="mt-3 t-caption font-medium text-finance-green hover:text-finance-green"
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

      <form action={action} className="mt-6" onKeyDown={handleGridKeyDown} onPaste={handleGridPaste}>
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
        <section className="overflow-hidden border-t border-finance-ink">
          <div className="flex flex-col justify-between gap-4 border-b border-finance-hairline py-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="t-section text-finance-ink">정기거래 목록</h2>
              <p className="mt-1 t-caption text-finance-muted">사용 중인 전체 규칙 합계 {formatWon(activeTotal)}원 · 방향키/Enter 이동 · 스프레드시트 범위 붙여넣기</p>
            </div>
            <div className="flex gap-2">
              <button
                className="h-[34px] border border-finance-hairline px-3 t-body-strong text-finance-ink hover:bg-finance-panel"
                onClick={() => addRule()}
                type="button"
              >
                + 새 규칙
              </button>
              <SaveButton />
            </div>
          </div>

          <div className="divide-y divide-finance-hairline">
            {rules.map((rule, rowIndex) => {
              const flow = flowFor(rule.flowToken)
              const filteredCategories = categories.filter((category) => category.kind === flow)
              const isNew = rule.id === null
              return (
                <article className={`${rule.active ? 'bg-white' : 'bg-finance-panel opacity-65'} py-5`} key={rule.key}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 t-caption font-medium text-finance-muted">
                        <input
                          aria-label={`${rule.memo || '새 정기거래'} 사용`}
                          checked={rule.active}
                          className="accent-emerald-700"
                          onChange={(event) => updateRule(rule.key, { active: event.target.checked })}
                          type="checkbox"
                        />
                        사용
                      </label>
                      {rule.generated && <span className="bg-finance-green-tint px-2 py-0.5 t-badge text-finance-green">{month} 반영됨</span>}
                      {isNew && <span className="bg-finance-blue-tint px-2 py-0.5 t-badge text-finance-blue">새 규칙</span>}
                    </div>
                    {isNew && (
                      <button className="t-caption text-finance-faint hover:text-finance-red" onClick={() => removeNewRule(rule.key)} type="button">제거</button>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[130px_minmax(180px,1fr)_minmax(180px,1.1fr)_130px_150px_80px]">
                    <label className="t-body text-finance-muted">
                      구분
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 구분`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 t-body text-finance-ink"
                        data-grid-column="0"
                        data-grid-row={rowIndex}
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
                    <label className="t-body text-finance-muted">
                      분류
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 분류`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 t-body text-finance-ink"
                        data-grid-column="1"
                        data-grid-row={rowIndex}
                        onChange={(event) => updateRule(rule.key, { categoryId: event.target.value ? Number(event.target.value) : null })}
                        value={rule.categoryId ?? ''}
                      >
                        <option value="">미분류</option>
                        {filteredCategories.map((category) => (
                          <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>
                        ))}
                      </select>
                    </label>
                    <label className="t-body text-finance-muted">
                      사용내역
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 사용내역`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 t-body text-finance-ink"
                        data-grid-column="2"
                        data-grid-row={rowIndex}
                        onChange={(event) => updateRule(rule.key, { memo: event.target.value })}
                        placeholder="예: 통신비 자동이체"
                        type="text"
                        value={rule.memo}
                      />
                    </label>
                    <label className="t-body text-finance-muted">
                      금액
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 금액`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 text-right t-body tabular-nums text-finance-ink"
                        data-grid-column="3"
                        data-grid-row={rowIndex}
                        inputMode="numeric"
                        onChange={(event) => updateRule(rule.key, { amount: event.target.value })}
                        type="text"
                        value={rule.amount}
                      />
                    </label>
                    <label className="t-body text-finance-muted">
                      결제수단
                      <select
                        aria-label={`${rule.memo || '새 정기거래'} 결제수단`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 t-body text-finance-ink"
                        data-grid-column="4"
                        data-grid-row={rowIndex}
                        onChange={(event) => updateRule(rule.key, { accountId: event.target.value ? Number(event.target.value) : null })}
                        value={rule.accountId ?? ''}
                      >
                        <option value="">선택 안 함</option>
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                      </select>
                    </label>
                    <label className="t-body text-finance-muted">
                      결제일
                      <input
                        aria-label={`${rule.memo || '새 정기거래'} 결제일`}
                        className="mt-1 h-[34px] w-full border border-finance-hairline bg-white px-3 text-right t-body tabular-nums text-finance-ink"
                        data-grid-column="5"
                        data-grid-row={rowIndex}
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
            {rules.length === 0 && <p className="px-5 py-12 text-center t-body text-finance-muted">등록된 정기거래가 없습니다.</p>}
          </div>
        </section>
        {state.error && <p className="mt-3 t-body text-finance-red">{state.error}</p>}
      </form>
    </>
  )
}

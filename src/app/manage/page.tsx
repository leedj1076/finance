import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import {
  bulkClassifyTransactions,
  saveAccount,
  saveAlias,
  saveCategory,
  saveRule,
} from '@/features/manage/actions'
import { getManageData, type ManageTab } from '@/features/manage/queries'
import { formatWon } from '@/lib/finance'
import { requireHousehold } from '@/lib/household'

type ManagePageProps = {
  searchParams: Promise<{
    tab?: string | string[]
    q?: string | string[]
    saved?: string | string[]
    error?: string | string[]
  }>
}

const tabs: Array<{ key: ManageTab; label: string }> = [
  { key: 'accounts', label: '결제수단' },
  { key: 'categories', label: '카테고리' },
  { key: 'rules', label: '추천 규칙' },
  { key: 'unclassified', label: '미분류 거래' },
]

const flowLabels = { expense: '지출', income: '수입', saving: '저축' } as const
const inputClass = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
const secondaryButton = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50'
const saveButton = 'rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700'

function ActiveToggle({ checked }: { checked: boolean }) {
  return (
    <label className="flex items-center gap-2 whitespace-nowrap text-sm text-zinc-700">
      <input defaultChecked={checked} name="active" type="checkbox" /> 사용
    </label>
  )
}

export default async function ManagePage({ searchParams }: ManagePageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedTab = typeof params.tab === 'string' ? params.tab : 'accounts'
  const tab = tabs.some((item) => item.key === requestedTab) ? requestedTab as ManageTab : 'accounts'
  const ruleQuery = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const saved = typeof params.saved === 'string' ? params.saved : null
  const error = typeof params.error === 'string' ? params.error : null
  const data = await getManageData(household.householdId, { tab, ruleQuery })
  const tabCounts: Record<ManageTab, number> = {
    accounts: data.counts.accounts,
    categories: data.counts.categories,
    rules: data.counts.rules,
    unclassified: data.counts.unclassified,
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="manage" email={household.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div>
          <p className="text-sm font-medium text-emerald-700">기준 정보</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">가계부 관리</h1>
          <p className="mt-2 text-sm text-zinc-500">결제수단과 카테고리, 자동 추천 기준을 한곳에서 관리합니다.</p>
        </div>

        {saved && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{saved}</p>}
        {error && <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

        <nav aria-label="관리 메뉴" className="mt-6 flex gap-2 overflow-x-auto border-b border-zinc-200">
          {tabs.map((item) => (
            <Link
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === item.key ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-zinc-500 hover:text-zinc-900'}`}
              href={`/manage?tab=${item.key}`}
              key={item.key}
            >
              {item.label} <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{tabCounts[item.key]}</span>
            </Link>
          ))}
        </nav>

        {tab === 'accounts' && (
          <section className="mt-6 space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
              <h2 className="font-semibold text-zinc-950">결제수단 추가</h2>
              <form action={saveAccount} className="mt-4 grid gap-3 md:grid-cols-[1.3fr_.7fr_.7fr_1.5fr_auto] md:items-end">
                <label className="grid gap-1 text-xs font-medium text-zinc-600">이름<input className={inputClass} name="name" placeholder="예: DJ 현대카드" required /></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">소유자<input className={inputClass} defaultValue="DJ" list="account-owners" name="owner" required /></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">종류<select className={inputClass} defaultValue="card" name="type"><option value="card">카드</option><option value="cash">현금/계좌</option><option value="bank">은행</option><option value="other">기타</option></select></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">메모<input className={inputClass} name="memo" /></label>
                <SubmitButton className={saveButton} pendingLabel="추가 중…" type="submit">추가</SubmitButton>
              </form>
              <datalist id="account-owners"><option value="DJ" /><option value="YJ" /><option value="공용" /></datalist>
            </div>
            {data.accounts.map((account) => (
              <form action={saveAccount} className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-[1.3fr_.7fr_.7fr_1.5fr_auto_auto] md:items-end" key={account.id}>
                <input name="id" type="hidden" value={account.id} />
                <label className="grid gap-1 text-xs font-medium text-zinc-600">이름<input className={inputClass} defaultValue={account.name} name="name" required /></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">소유자<input className={inputClass} defaultValue={account.owner ?? ''} list="account-owners" name="owner" required /></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">종류<select className={inputClass} defaultValue={account.type ?? 'other'} name="type"><option value="card">카드</option><option value="cash">현금/계좌</option><option value="bank">은행</option><option value="other">기타</option></select></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">메모<input className={inputClass} defaultValue={account.memo ?? ''} name="memo" /><span className="font-normal text-zinc-400">거래 {account.transactionCount.toLocaleString('ko-KR')}건</span></label>
                <ActiveToggle checked={account.active} />
                <SubmitButton className={saveButton} pendingLabel="저장 중…" type="submit">저장</SubmitButton>
              </form>
            ))}
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">사용하지 않는 결제수단은 체크를 꺼 주세요. 과거 거래 연결을 보존하기 위해 삭제하지 않습니다.</p>
          </section>
        )}

        {tab === 'categories' && (
          <section className="mt-6 space-y-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
              <h2 className="font-semibold text-zinc-950">카테고리 추가</h2>
              <form action={saveCategory} className="mt-4 grid gap-3 sm:grid-cols-[.7fr_1fr_1fr_auto] sm:items-end">
                <label className="grid gap-1 text-xs font-medium text-zinc-600">유형<select className={inputClass} defaultValue="expense" name="kind"><option value="expense">지출</option><option value="income">수입</option><option value="saving">저축</option></select></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">대분류<input className={inputClass} name="major" required /></label>
                <label className="grid gap-1 text-xs font-medium text-zinc-600">소분류<input className={inputClass} name="sub" required /></label>
                <SubmitButton className={saveButton} pendingLabel="추가 중…" type="submit">추가</SubmitButton>
              </form>
            </div>
            {(['expense', 'income', 'saving'] as const).map((kind) => {
              const rows = data.categories.filter((category) => category.kind === kind)
              return (
                <div key={kind}>
                  <h2 className="mb-3 text-lg font-semibold text-zinc-950">{flowLabels[kind]} <span className="text-sm font-normal text-zinc-400">{rows.length}개</span></h2>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {rows.map((category) => (
                      <form action={saveCategory} className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" key={category.id}>
                        <input name="id" type="hidden" value={category.id} />
                        <input name="kind" type="hidden" value={category.kind} />
                        <label className="grid gap-1 text-xs font-medium text-zinc-600">대분류<input className={inputClass} defaultValue={category.major} name="major" required /></label>
                        <label className="grid gap-1 text-xs font-medium text-zinc-600">소분류<input className={inputClass} defaultValue={category.sub} name="sub" required /><span className="font-normal text-zinc-400">거래 {category.transactionCount.toLocaleString('ko-KR')}건{category.recurringCount ? ` · 정기 ${category.recurringCount}건` : ''}</span></label>
                        <ActiveToggle checked={!category.hidden} />
                        <SubmitButton className={saveButton} pendingLabel="저장 중…" type="submit">저장</SubmitButton>
                      </form>
                    ))}
                  </div>
                </div>
              )
            })}
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">기존 카테고리의 유형은 거래 일관성을 위해 바꿀 수 없습니다. 필요하면 새 카테고리를 추가하고 기존 항목은 숨겨 주세요.</p>
          </section>
        )}

        {tab === 'rules' && (
          <section className="mt-6 space-y-8">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div><h2 className="font-semibold text-zinc-950">가맹점 분류 추천</h2><p className="mt-1 text-xs text-zinc-500">총 {data.counts.rules.toLocaleString('ko-KR')}개 · 사용 횟수가 높은 순으로 100개까지 표시</p></div>
                <form className="flex gap-2" method="get"><input name="tab" type="hidden" value="rules" /><input aria-label="분류 규칙 검색" className={inputClass} defaultValue={ruleQuery} name="q" placeholder="정규화된 가맹점 검색" /><SubmitButton className={secondaryButton} pendingLabel="검색 중…" type="submit">검색</SubmitButton></form>
              </div>
            </div>
            <div className="space-y-3">
              {data.rules.map((rule) => {
                const flow = rule.flow ?? 'expense'
                return (
                  <form action={saveRule} className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-[1.2fr_.7fr_1.4fr_1fr_.5fr_.45fr_auto_auto] lg:items-end" key={rule.id}>
                    <input name="id" type="hidden" value={rule.id} />
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-950" title={rule.pattern}>{rule.pattern}</p><p className="mt-1 text-xs text-zinc-400">{rule.matchType} · {rule.hits.toLocaleString('ko-KR')}회 학습</p></div>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">유형<select className={inputClass} defaultValue={flow} name="flow"><option value="expense">지출</option><option value="income">수입</option><option value="saving">저축</option></select></label>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">카테고리<select className={inputClass} defaultValue={rule.categoryId ?? ''} name="categoryId"><option value="">미지정</option>{data.categories.filter((category) => category.kind === flow).map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">결제수단<select className={inputClass} defaultValue={rule.accountId ?? ''} name="accountId"><option value="">미지정</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">우선순위<input className={inputClass} defaultValue={rule.priority} max="999" min="0" name="priority" type="number" /></label>
                    <label className="flex items-center gap-2 whitespace-nowrap pb-2 text-sm text-zinc-700"><input defaultChecked={rule.fixed ?? false} name="fixed" type="checkbox" /> 고정비</label>
                    <SubmitButton className={saveButton} pendingLabel="저장 중…" type="submit">저장</SubmitButton>
                    <SubmitButton className="rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60" name="intent" pendingLabel="삭제 중…" type="submit" value="delete">삭제</SubmitButton>
                  </form>
                )
              })}
              {data.rules.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-10 text-center text-sm text-zinc-500">검색 조건에 맞는 추천 규칙이 없습니다.</p>}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-zinc-950">뱅크샐러드 결제수단 별칭</h2>
              <p className="mt-1 text-sm text-zinc-500">업로드 파일의 결제수단 이름을 우리 가계부 계정에 연결합니다. 새 별칭은 인박스 반영 과정에서 자동 학습됩니다.</p>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.aliases.map((alias) => (
                  <form action={saveAlias} className="grid grid-cols-[.5fr_1fr_1.2fr_auto_auto] items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={`${alias.owner}:${alias.alias}`}>
                    <input name="owner" type="hidden" value={alias.owner} /><input name="alias" type="hidden" value={alias.alias} />
                    <div><p className="text-xs text-zinc-500">소유자</p><p className="mt-2 text-sm font-medium text-zinc-800">{alias.owner}</p></div>
                    <div className="min-w-0"><p className="text-xs text-zinc-500">파일 표기</p><p className="mt-2 truncate text-sm font-medium text-zinc-800" title={alias.alias}>{alias.alias}</p></div>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">연결<select className={inputClass} defaultValue={alias.accountId} name="accountId">{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                    <SubmitButton className={saveButton} pendingLabel="저장 중…" type="submit">저장</SubmitButton>
                    <SubmitButton className="rounded-lg px-2 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60" name="intent" pendingLabel="삭제 중…" type="submit" value="delete">삭제</SubmitButton>
                  </form>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === 'unclassified' && (
          <section className="mt-6 space-y-3">
            {data.unclassified.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-12 text-center"><p className="font-semibold text-emerald-900">미분류 거래가 없습니다.</p><p className="mt-2 text-sm text-emerald-700">현재 모든 거래에 카테고리가 연결되어 있습니다.</p></div>
            ) : (
              <form action={bulkClassifyTransactions} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-col justify-between gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="font-semibold text-zinc-950">미분류 거래 일괄 분류</h2>
                    <p className="mt-1 text-xs text-zinc-500">처리할 거래를 선택하고 각 거래 유형에 맞는 카테고리를 지정해 주세요.</p>
                  </div>
                  <SubmitButton className={saveButton} pendingLabel="분류 중…" type="submit">선택 거래 저장</SubmitButton>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-zinc-50 text-xs text-zinc-500">
                      <tr>
                        <th className="w-14 px-4 py-3 font-medium">선택</th>
                        <th className="px-3 py-3 font-medium">날짜·유형</th>
                        <th className="px-3 py-3 font-medium">사용내역</th>
                        <th className="px-3 py-3 text-right font-medium">금액</th>
                        <th className="min-w-64 px-3 py-3 font-medium">카테고리</th>
                        <th className="px-3 py-3 font-medium">고정비</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {data.unclassified.map((transaction) => (
                        <tr className="hover:bg-zinc-50" key={transaction.id}>
                          <td className="px-4 py-3 text-center"><input aria-label={`${transaction.rawMerchant || transaction.memo || '거래'} 선택`} className="h-4 w-4 accent-emerald-700" name="ids" type="checkbox" value={transaction.id} /></td>
                          <td className="whitespace-nowrap px-3 py-3"><p className="text-xs text-zinc-500">{transaction.date}</p><p className="mt-1 font-medium text-zinc-800">{flowLabels[transaction.flow]}</p></td>
                          <td className="max-w-80 px-3 py-3"><p className="truncate font-medium text-zinc-950">{transaction.rawMerchant || transaction.memo || '내용 없음'}</p><p className="mt-1 truncate text-xs text-zinc-400">{transaction.accountName ?? '결제수단 없음'}</p></td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-zinc-900">{formatWon(transaction.amount)}원</td>
                          <td className="px-3 py-3"><select className={inputClass} defaultValue="" name={`category_${transaction.id}`}><option value="">선택</option>{data.categories.filter((category) => category.kind === transaction.flow && !category.hidden).map((category) => <option key={category.id} value={category.id}>{category.major} · {category.sub}</option>)}</select></td>
                          <td className="px-3 py-3">{transaction.flow === 'expense' ? <label className="flex items-center gap-2 whitespace-nowrap text-sm text-zinc-700"><input defaultChecked={transaction.fixed} name={`fixed_${transaction.id}`} type="checkbox" /> 고정</label> : <span className="text-xs text-zinc-400">해당 없음</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </form>
            )}
            {data.counts.unclassified > data.unclassified.length && <p className="text-center text-xs text-zinc-500">최근 100개만 표시됩니다. 먼저 보이는 거래를 분류하면 다음 항목이 나타납니다.</p>}
          </section>
        )}
      </main>
    </div>
  )
}

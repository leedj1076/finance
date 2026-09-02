import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ActionNotice } from '@/components/action-notice'
import { AppHeader } from '@/components/app-header'
import { SubmitButton } from '@/components/submit-button'
import { saveAlias } from '@/features/manage/actions'
import { AccountsManager } from '@/features/manage/accounts-manager'
import { BulkClassifyForm } from '@/features/manage/bulk-classify-form'
import { CategoriesManager } from '@/features/manage/categories-manager'
import { MerchantDictionary } from '@/features/manage/merchant-dictionary'
import { getManageData, type ManageTab } from '@/features/manage/queries'
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
  { key: 'rules', label: '가맹점 사전' },
  { key: 'unclassified', label: '미분류 거래' },
]

const inputClass = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
const secondaryButton = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50'
const saveButton = 'rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700'

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
          <p className="mt-2 text-sm text-zinc-500">결제수단과 카테고리, 가맹점별 추천 기준을 한곳에서 관리합니다.</p>
        </div>

        <ActionNotice error={error ?? undefined} notice={saved ?? undefined} />

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
          <AccountsManager initialRows={data.accounts} />
        )}

        {tab === 'categories' && (
          <CategoriesManager initialRows={data.categories} />
        )}

        {tab === 'rules' && (
          <section className="mt-6 space-y-8">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div><h2 className="font-semibold text-zinc-950">가맹점 사전</h2><p className="mt-1 text-xs text-zinc-500">총 {data.counts.rules.toLocaleString('ko-KR')}개 · 사용자 확정과 AI 추천을 사용 횟수 순으로 100개까지 표시</p></div>
                <form className="flex gap-2" method="get"><input name="tab" type="hidden" value="rules" /><input aria-label="가맹점 사전 검색" className={inputClass} defaultValue={ruleQuery} name="q" placeholder="가맹점·업종 검색" /><SubmitButton className={secondaryButton} pendingLabel="검색 중…" type="submit">검색</SubmitButton></form>
              </div>
            </div>
            <MerchantDictionary
              categories={data.categories.filter((category) => !category.hidden)}
              entries={data.dictionary}
            />

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
              <BulkClassifyForm
                categories={data.categories.filter((category) => !category.hidden)}
                rows={data.unclassified}
              />
            )}
            {data.counts.unclassified > data.unclassified.length && <p className="text-center text-xs text-zinc-500">최근 100개만 표시됩니다. 먼저 보이는 거래를 분류하면 다음 항목이 나타납니다.</p>}
          </section>
        )}
      </main>
    </div>
  )
}

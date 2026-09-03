import { redirect } from 'next/navigation'

import { ActionNotice } from '@/components/action-notice'
import { AppHeader } from '@/components/app-header'
import { SettingsNav, type SettingsSection } from '@/components/settings-nav'
import { SubmitButton } from '@/components/submit-button'
import { saveAlias } from '@/features/manage/actions'
import { AccountsManager } from '@/features/manage/accounts-manager'
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
  { key: 'rules', label: '가져오기 규칙' },
]

const inputClass = 'h-[34px] border border-finance-hairline bg-white px-3 text-[13px] text-finance-ink outline-none focus:border-finance-blue'
const secondaryButton = 'h-[34px] border border-finance-hairline bg-white px-3 text-xs font-semibold text-finance-ink hover:bg-finance-panel'
const saveButton = 'h-[34px] bg-finance-ink px-3 text-xs font-semibold text-white hover:opacity-80'

export default async function ManagePage({ searchParams }: ManagePageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const params = await searchParams
  const requestedTab = typeof params.tab === 'string' ? params.tab : 'accounts'
  if (requestedTab === 'unclassified') {
    const query = new URLSearchParams({ tab: 'unclassified' })
    if (typeof params.saved === 'string') query.set('notice', params.saved)
    if (typeof params.error === 'string') query.set('error', params.error)
    redirect(`/inbox?${query.toString()}`)
  }
  const tab = tabs.some((item) => item.key === requestedTab) ? requestedTab as ManageTab : 'accounts'
  const ruleQuery = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const saved = typeof params.saved === 'string' ? params.saved : null
  const error = typeof params.error === 'string' ? params.error : null
  const data = await getManageData(household.householdId, { tab, ruleQuery })
  const settingsSection: SettingsSection = tab === 'categories' ? 'categories' : tab === 'rules' ? 'rules' : 'accounts'

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="settings" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
          <SettingsNav active={settingsSection} />
          <div className="min-w-0">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">기준 정보</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">가계부 관리</h1>
          <p className="mt-2 text-xs text-finance-muted">결제수단과 카테고리, 가맹점별 추천 기준을 한곳에서 관리합니다.</p>
        </div>

        <ActionNotice error={error ?? undefined} notice={saved ?? undefined} />

        {tab === 'accounts' && (
          <AccountsManager initialRows={data.accounts} />
        )}

        {tab === 'categories' && (
          <CategoriesManager initialRows={data.categories} />
        )}

        {tab === 'rules' && (
          <section className="mt-6 space-y-8">
            <div className="border-t border-finance-ink py-4">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div><h2 className="text-sm font-bold text-finance-ink">가맹점 사전</h2><p className="mt-1 text-xs text-finance-muted">총 {data.counts.rules.toLocaleString('ko-KR')}개 · 사용자 확정과 AI 추천을 사용 횟수 순으로 100개까지 표시</p></div>
                <form className="flex gap-2" method="get"><input name="tab" type="hidden" value="rules" /><input aria-label="가맹점 사전 검색" className={inputClass} defaultValue={ruleQuery} name="q" placeholder="가맹점·업종 검색" /><SubmitButton className={secondaryButton} pendingLabel="검색 중…" type="submit">검색</SubmitButton></form>
              </div>
            </div>
            <MerchantDictionary
              categories={data.categories.filter((category) => !category.hidden)}
              entries={data.dictionary}
            />

            <div>
              <h2 className="border-t border-finance-ink pt-4 text-sm font-bold text-finance-ink">뱅크샐러드 결제수단 별칭</h2>
              <p className="mt-1 text-xs text-finance-muted">업로드 파일의 결제수단 이름을 우리 가계부 계정에 연결합니다. 새 별칭은 인박스 반영 과정에서 자동 학습됩니다.</p>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.aliases.map((alias) => (
                  <form action={saveAlias} className="grid items-end gap-2 border-b border-finance-hairline py-4 sm:grid-cols-[.5fr_1fr_1.2fr_auto_auto]" key={`${alias.owner}:${alias.alias}`}>
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

          </div>
        </div>
      </main>
    </div>
  )
}

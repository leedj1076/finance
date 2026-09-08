import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ActionNotice } from '@/components/action-notice'
import { AppHeader } from '@/components/app-header'
import { InboxReviewForm } from '@/features/inbox/inbox-review-form'
import { InboxHistoryList } from '@/features/inbox/history-list'
import { getInboxHistory } from '@/features/inbox/history-queries'
import { InboxTabs, InboxTabPanel, type ImportTab } from '@/features/inbox/inbox-tabs'
import { CARD_ISSUERS } from '@/features/inbox/parsers/cards'
import { getInboxData } from '@/features/inbox/queries'
import { InboxUploadForm } from '@/features/inbox/upload-form'
import { BulkClassifyForm } from '@/features/manage/bulk-classify-form'
import { getManageData } from '@/features/manage/queries'
import { requireHousehold } from '@/lib/household'

type InboxPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')

  const [data, params] = await Promise.all([
    getInboxData(household.householdId),
    searchParams,
  ])
  const requestedTab = firstParam(params.tab)
  const fallbackTab: ImportTab = data.counts.pending > 0 ? 'review' : 'upload'
  const tab = requestedTab === 'review'
    || requestedTab === 'upload'
    || requestedTab === 'history'
    || requestedTab === 'unclassified'
    ? requestedTab
    : undefined
  const notice = firstParam(params.notice)
  const error = firstParam(params.error)
  const history = tab === 'history' ? await getInboxHistory(household.householdId) : []
  const unclassifiedData = tab === 'unclassified'
    ? await getManageData(household.householdId, { tab: 'unclassified' })
    : null

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="inbox" email={household.email} />
      <main className="mx-auto max-w-[1680px] px-5 pb-14 pt-9 sm:px-12">
        <header>
          <p className="t-label uppercase text-finance-blue">새 거래 들여오기</p>
          <h1 className="mt-2 t-page-title text-finance-ink">가져오기</h1>
          <p className="mt-2 t-caption text-finance-muted">파일을 올리고 추천 결과를 확인한 뒤, 안전하게 거래 원장으로 반영합니다.</p>
        </header>

        <ActionNotice error={error} notice={notice} />

        <InboxTabs defaultTab={fallbackTab} pendingCount={data.counts.pending} requestedTab={tab} unclassifiedCount={data.counts.unclassified}>
        <InboxTabPanel tab="review">
          <section className="mt-6">
            <div className="mb-3 border-t border-finance-ink pt-4">
              <h2 className="t-section text-finance-ink">분류 확인</h2>
              <p className="mt-1 t-caption text-finance-muted">자동 분류를 포함한 모든 거래를 수정할 수 있습니다. 한 건씩 반영하거나 그룹을 선택해 한 번에 처리하세요.</p>
            </div>
            {data.truncated && <p className="mb-3 border-l-2 border-finance-amber py-2 pl-3 t-body text-finance-muted">대기 거래가 많아 최근 500건만 표시합니다. 먼저 반영하거나 제외하면 나머지가 이어서 표시됩니다.</p>}
            <InboxReviewForm accounts={data.accounts} categories={data.categories} highItems={data.highItems} reviewItems={data.reviewItems} />
          </section>
        </InboxTabPanel>

        <InboxTabPanel tab="upload">
          <section className="mt-6 border-b border-finance-border border-t border-finance-ink py-5">
            <h2 className="t-section text-finance-ink">거래 파일 가져오기</h2>
            <p className="mt-1 t-caption text-finance-muted">뱅크샐러드 파일은 DJ·YJ 최대 2개를, 카드사 명세서는 카드사와 소유자를 선택해 올려 주세요.</p>
            <InboxUploadForm accounts={data.accounts} cardIssuers={CARD_ISSUERS} />
          </section>
        </InboxTabPanel>

        <InboxTabPanel tab="history">
          <section className="mt-6 border-t border-finance-ink">
            <div className="border-b border-finance-border py-4">
              <h2 className="t-section text-finance-ink">처리 기록</h2>
              <p className="mt-1 t-caption text-finance-muted">업로드 날짜·소스별로 가져온 항목과 현재 처리 상태를 확인합니다. 같은 소스를 하루에 여러 번 올리면 합쳐 보이며, 선택 제외한 항목은 검토 대기로 다시 보낼 수 있습니다.</p>
            </div>
            {history.length > 0 ? (
              <InboxHistoryList history={history} />
            ) : (
              <div className="border-b border-dashed border-finance-border py-14 text-center"><p className="font-medium text-finance-ink">아직 처리 기록이 없습니다.</p><Link className="mt-3 inline-flex t-caption font-semibold text-finance-blue" href="/inbox?tab=upload">첫 파일 업로드 →</Link></div>
            )}
          </section>
        </InboxTabPanel>

        <InboxTabPanel tab="unclassified">
        {unclassifiedData && (
          <section className="mt-6 space-y-3">
            {unclassifiedData.unclassified.length === 0 ? (
              <div className="border-t border-finance-green py-12 text-center"><p className="font-semibold text-finance-green">미분류 거래가 없습니다.</p><p className="mt-2 t-caption text-finance-muted">현재 모든 거래에 카테고리가 연결되어 있습니다.</p></div>
            ) : (
              <BulkClassifyForm categories={unclassifiedData.categories.filter((category) => !category.hidden)} rows={unclassifiedData.unclassified} />
            )}
            {unclassifiedData.counts.unclassified > unclassifiedData.unclassified.length && <p className="text-center t-caption text-finance-muted">최근 100개만 표시됩니다. 먼저 보이는 거래를 분류하면 다음 항목이 나타납니다.</p>}
          </section>
        )}
        </InboxTabPanel>
        </InboxTabs>
      </main>
    </div>
  )
}

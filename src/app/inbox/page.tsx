import { redirect } from 'next/navigation'

import { ActionNotice } from '@/components/action-notice'
import { AppHeader } from '@/components/app-header'
import { InboxReviewForm } from '@/features/inbox/inbox-review-form'
import { CARD_ISSUERS } from '@/features/inbox/parsers/cards'
import { getInboxData } from '@/features/inbox/queries'
import { InboxUploadForm } from '@/features/inbox/upload-form'
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
  const notice = firstParam(params.notice)
  const error = firstParam(params.error)

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="inbox" email={household.email} />
      <main className="mx-auto max-w-none px-5 pb-12 pt-10 sm:px-12">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">가져오기 · 분류 확인</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">가져오기</h1>
          <p className="mt-2 text-xs text-finance-muted">
            뱅크샐러드와 카드사 명세서를 먼저 쌓아두고, 분류와 결제수단을 확인한 거래만 가계부에 반영합니다.
          </p>
        </div>

        <ActionNotice error={error} notice={notice} />

        <section className="mt-6 scroll-mt-20 border-b border-finance-border border-t border-finance-ink py-5" id="upload">
          <div>
            <h2 className="text-sm font-bold text-finance-ink">거래 파일 가져오기</h2>
            <p className="mt-1 text-xs leading-5 text-finance-muted">
              뱅크샐러드 파일은 DJ·YJ 최대 2개를, 카드사 명세서는 카드사와 소유자를 선택해 올려 주세요.
            </p>
          </div>
          <InboxUploadForm accounts={data.accounts} cardIssuers={CARD_ISSUERS} />
        </section>

        <section className="grid divide-y divide-finance-border border-b border-finance-ink sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <article className="py-5 pr-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-amber">확인 대기</p>
            <p className="mt-2 text-xl font-semibold text-finance-ink">{data.counts.pending.toLocaleString('ko-KR')}건</p>
          </article>
          <article className="px-6 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">반영 완료</p>
            <p className="mt-2 text-xl font-semibold text-finance-ink">{data.counts.done.toLocaleString('ko-KR')}건</p>
          </article>
          <article className="py-5 pl-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-finance-muted">제외</p>
            <p className="mt-2 text-xl font-semibold text-finance-ink">{data.counts.dismissed.toLocaleString('ko-KR')}건</p>
          </article>
        </section>

        <section className="mt-6">
          <div className="mb-3 border-t border-finance-ink pt-4">
            <h2 className="text-sm font-bold text-finance-ink">분류 확인</h2>
            <p className="mt-1 text-xs text-finance-muted">
              자동 분류를 포함한 모든 거래를 수정할 수 있습니다. 한 건씩 바로 반영하거나 필요한 거래를 선택해 한 번에 처리하세요.
            </p>
          </div>

          {data.truncated && (
            <p className="mb-3 border-l-2 border-finance-amber py-2 pl-3 text-[13px] text-finance-muted">
              대기 거래가 많아 최근 500건만 표시합니다. 먼저 반영하거나 제외하면 나머지가 이어서 표시됩니다.
            </p>
          )}

          {data.items.length > 0 ? (
            <InboxReviewForm
              accounts={data.accounts}
              categories={data.categories}
              highItems={data.highItems}
              reviewItems={data.reviewItems}
            />
          ) : (
            <div className="border-b border-dashed border-finance-border px-6 py-14 text-center">
              <p className="font-medium text-finance-ink">확인할 거래가 없습니다.</p>
              <p className="mt-2 text-[13px] text-finance-muted">위에서 새 거래 파일을 올려 주세요.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

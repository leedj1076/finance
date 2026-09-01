import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { InboxReviewForm } from '@/features/inbox/inbox-review-form'
import { getInboxData } from '@/features/inbox/queries'
import { BanksaladUploadForm } from '@/features/inbox/upload-form'
import { requireHousehold } from '@/lib/household'
import { createServerSupabase } from '@/lib/supabase/server'

type InboxPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const household = await requireHousehold()
  if (!household) redirect('/')

  const [data, params] = await Promise.all([
    getInboxData(household.householdId),
    searchParams,
  ])
  const notice = firstParam(params.notice)
  const error = firstParam(params.error)

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="inbox" email={user.email} />
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div>
          <p className="text-sm font-medium text-emerald-700">주간 가져오기</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">인박스</h1>
          <p className="mt-2 text-sm text-zinc-600">
            뱅크샐러드 내역을 먼저 쌓아두고, 분류와 결제수단을 확인한 거래만 가계부에 반영합니다.
          </p>
        </div>

        {notice && (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-zinc-950">뱅크샐러드 파일 가져오기</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              부부 각자의 최근 12개월 엑셀 파일을 함께 올려도 됩니다. 이전에 처리한 거래와 내부이체·카드대금은 자동으로 걸러집니다.
            </p>
          </div>
          <BanksaladUploadForm />
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-medium text-amber-700">확인 대기</p>
            <p className="mt-1 text-xl font-semibold text-amber-950">{data.counts.pending.toLocaleString('ko-KR')}건</p>
          </article>
          <article className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-zinc-500">반영 완료</p>
            <p className="mt-1 text-xl font-semibold text-zinc-950">{data.counts.done.toLocaleString('ko-KR')}건</p>
          </article>
          <article className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs font-medium text-zinc-500">제외</p>
            <p className="mt-1 text-xl font-semibold text-zinc-950">{data.counts.dismissed.toLocaleString('ko-KR')}건</p>
          </article>
        </section>

        <section className="mt-7">
          <div className="mb-3">
            <h2 className="font-semibold text-zinc-950">분류 확인</h2>
            <p className="mt-1 text-xs text-zinc-500">
              중복 의심 거래는 기본 선택이 해제되어 있습니다. 분류 수정은 다음 가져오기 추천에 학습됩니다.
            </p>
          </div>

          {data.truncated && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              대기 거래가 많아 최근 500건만 표시합니다. 먼저 반영하거나 제외하면 나머지가 이어서 표시됩니다.
            </p>
          )}

          {data.items.length > 0 ? (
            <InboxReviewForm
              accounts={data.accounts}
              categories={data.categories}
              items={data.items}
              key={data.items.map((item) => item.id).join('-')}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
              <p className="font-medium text-zinc-700">확인할 거래가 없습니다.</p>
              <p className="mt-2 text-sm text-zinc-500">위에서 새 뱅크샐러드 파일을 올려 주세요.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

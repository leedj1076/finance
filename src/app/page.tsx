import { createServerSupabase } from '@/lib/supabase/server'
import { requireHousehold } from '@/lib/household'

export default async function Home() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const household = await requireHousehold()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">우리집 가계부</h1>
      <p className="mt-3 text-zinc-600">로그인됨: {user?.email}</p>
      {household ? (
        <p className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
          가구 연결됨
        </p>
      ) : (
        <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">
          아직 가구에 연결되지 않았습니다. 관리자가 계정을 가구에 연결해야 합니다.
        </p>
      )}
      <form action="/auth/signout" method="post">
        <button
          className="mt-6 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          type="submit"
        >
          로그아웃
        </button>
      </form>
      <p className="mt-8 rounded-lg bg-zinc-100 p-4 text-sm text-zinc-600">
        대시보드와 가계부 화면은 다음 기능 단계에서 추가됩니다.
      </p>
    </main>
  )
}

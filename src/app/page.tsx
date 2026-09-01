import { createServerSupabase } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">우리집 가계부</h1>
      <p className="mt-3 text-zinc-600">로그인됨: {user?.email}</p>
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

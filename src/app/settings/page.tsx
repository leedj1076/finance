import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { createServerSupabase } from '@/lib/supabase/server'

import { PasswordChangeForm } from './password-change-form'

export default async function SettingsPage() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) redirect('/login')

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader active="settings" email={user.email} />
      <main className="mx-auto w-full max-w-lg px-6 py-12">
        <Link className="text-sm text-zinc-600 hover:text-zinc-950" href="/ledger">
          ← 가계부로 돌아가기
        </Link>
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-emerald-700">설정</p>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950">비밀번호 변경</h1>
          <p className="mt-2 text-sm text-zinc-500">로그인 계정: {user.email}</p>
          <PasswordChangeForm email={user.email} />
        </section>
      </main>
    </div>
  )
}

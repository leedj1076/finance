import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { getAuthContext } from '@/lib/household'

import { PasswordChangeForm } from './password-change-form'

type SettingsPageProps = {
  searchParams: Promise<{ passwordChanged?: string | string[] }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const auth = await getAuthContext()
  if (!auth) redirect('/login')
  const params = await searchParams

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="settings" email={auth.email} />
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link className="text-xs font-semibold text-finance-muted hover:text-finance-ink" href="/ledger">
          ← 가계부로 돌아가기
        </Link>
        <section className="mt-6 border-t border-finance-ink pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">설정</p>
          <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">비밀번호 변경</h1>
          <p className="mt-2 text-xs text-finance-muted">로그인 계정: {auth.email}</p>
          {params.passwordChanged === '1' && <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">비밀번호를 변경했습니다.</p>}
          <PasswordChangeForm />
        </section>
      </main>
    </div>
  )
}

import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app-header'
import { SettingsNav } from '@/components/settings-nav'
import { AssetAccountsManager } from '@/features/assets/asset-accounts-manager'
import { getAssetData } from '@/features/assets/queries'
import { requireHousehold } from '@/lib/household'

import { PasswordChangeForm } from './password-change-form'

type SettingsPageProps = {
  searchParams: Promise<{
    passwordChanged?: string | string[]
    saved?: string | string[]
    section?: string | string[]
  }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const params = await searchParams
  const section = params.section === 'assets' ? 'assets' : 'security'
  const assetData = section === 'assets' ? await getAssetData(household.householdId) : null

  return (
    <div className="min-h-screen bg-white">
      <AppHeader active="settings" email={household.email} />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-14 pt-10 sm:px-12">
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
          <SettingsNav active={section} />
          <div className="min-w-0">
            <header>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-finance-blue">가계부 기준 관리</p>
              <h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em] text-finance-ink">{section === 'assets' ? '자산 계정' : '계정 및 보안'}</h1>
              <p className="mt-2 text-xs text-finance-muted">{section === 'assets' ? '자산 그룹과 계정 이름을 관리합니다.' : `로그인 계정 · ${household.email}`}</p>
            </header>

            {section === 'assets' && assetData && (
              <>
                {params.saved === '1' && <p className="mt-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">자산 계정 변경사항을 저장했습니다.</p>}
                <AssetAccountsManager groups={assetData.overview.groups} />
              </>
            )}

            {section === 'security' && (
              <section className="mt-6 max-w-xl border-t border-finance-ink pt-6">
                {params.passwordChanged === '1' && <p className="mb-5 border-l-2 border-finance-green bg-finance-green-tint px-4 py-3 text-[13px] text-finance-green">비밀번호를 변경했습니다.</p>}
                <h2 className="text-sm font-bold text-finance-ink">비밀번호 변경</h2>
                <PasswordChangeForm />
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

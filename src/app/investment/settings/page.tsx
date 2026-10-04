import { redirect } from 'next/navigation'

import { AccountForm } from '@/features/investment/account-form'
import { InvestmentPageShell } from '@/features/investment/page-shell'
import { getInvestmentSettingsData } from '@/features/investment/queries'
import { requireHousehold } from '@/lib/household'

export default async function InvestmentSettingsPage() {
  const household = await requireHousehold()
  if (!household) redirect('/login')
  const { accounts } = await getInvestmentSettingsData(household.householdId)
  return (
    <InvestmentPageShell active="investment-settings" email={household.email} eyebrow="Settings" title="투자 설정" subtitle="증권 계좌"
      owners={[]} owner={null} ownerHref={() => '/investment/settings'}>
      <section className="py-7">
        <div><h2 className="t-section text-finance-ink">증권 계좌</h2><p className="mt-1 t-caption text-finance-faint">키움 계좌와 소유자. 앱키·시크릿은 여기 저장하지 않고 워커 Mac의 키체인에만 둡니다. 여기 적는 건 키체인 항목 이름입니다.</p></div>
        <div className="mt-4">
          {accounts.map((account) => <AccountForm account={account} key={account.id} />)}
          <h3 className="mt-6 t-caption-strong text-finance-muted">새 계좌</h3>
          <AccountForm />
        </div>
      </section>
      <section className="border-t border-finance-border py-7">
        <h2 className="t-section text-finance-ink">AI 지침 · 기업 상태 영역 · 일일 상한</h2>
        <p className="mt-2 t-caption text-finance-muted">헬스체크·어드바이저·발굴 지침 편집과 영역 편집기는 3단계에서 이 자리에 들어갑니다.</p>
      </section>
    </InvestmentPageShell>
  )
}

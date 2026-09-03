import Link from 'next/link'

export type SettingsSection = 'accounts' | 'assets' | 'categories' | 'recurring' | 'rules' | 'security'

const ITEMS: Array<{ key: SettingsSection; href: string; label: string }> = [
  { key: 'accounts', href: '/manage?tab=accounts', label: '결제수단' },
  { key: 'categories', href: '/manage?tab=categories', label: '카테고리' },
  { key: 'rules', href: '/manage?tab=rules', label: '가져오기 규칙' },
  { key: 'recurring', href: '/recurring', label: '정기거래 규칙' },
  { key: 'assets', href: '/settings?section=assets', label: '자산 계정' },
  { key: 'security', href: '/settings?section=security', label: '계정 및 보안' },
]

export function SettingsNav({ active }: { active: SettingsSection }) {
  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-finance-muted">설정</p>
      <nav aria-label="설정 메뉴" className="flex overflow-x-auto border-y border-finance-hairline lg:block lg:border-y-0 lg:border-l lg:border-finance-hairline">
        {ITEMS.map((item) => (
          <Link
            aria-current={active === item.key ? 'page' : undefined}
            className={`block shrink-0 border-b-2 px-4 py-3 text-[13px] font-semibold lg:border-b-0 lg:border-l-2 ${active === item.key ? 'border-finance-blue bg-finance-blue-tint text-finance-blue lg:-ml-px' : 'border-transparent text-finance-muted hover:text-finance-ink'}`}
            href={item.href}
            key={item.key}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}

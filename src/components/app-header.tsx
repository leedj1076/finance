import Link from 'next/link'

type AppHeaderProps = {
  active: 'budgets' | 'ledger' | 'settings'
  email: string
}

export function AppHeader({ active, email }: AppHeaderProps) {
  const navClass = (key: AppHeaderProps['active']) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      active === key
        ? 'bg-emerald-50 text-emerald-800'
        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
    }`

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3 sm:px-8">
        <Link className="shrink-0 font-semibold tracking-tight text-zinc-950" href="/ledger">
          우리집 가계부
        </Link>
        <nav className="flex items-center gap-1">
          <Link className={navClass('ledger')} href="/ledger">
            가계부
          </Link>
          <Link className={navClass('budgets')} href="/budgets">
            예산
          </Link>
          <Link className={navClass('settings')} href="/settings">
            설정
          </Link>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-xs text-zinc-500 sm:block">{email}</span>
          <form action="/auth/signout" method="post">
            <button
              className="whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              type="submit"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}

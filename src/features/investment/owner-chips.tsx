import Link from 'next/link'

export function OwnerChips({ owners, active, href }: { owners: string[]; active: string | null; href: (owner: string | null) => string }) {
  const items: Array<string | null> = [null, ...owners]
  return (
    <div className="flex border border-finance-border" role="group" aria-label="소유자">
      {items.map((owner) => (
        <Link
          aria-current={active === owner ? 'true' : undefined}
          className={`flex h-[34px] items-center border-r border-finance-border px-3.5 t-caption-strong last:border-r-0 ${active === owner ? 'bg-finance-ink text-white' : 'text-finance-muted hover:text-finance-ink'}`}
          href={href(owner)}
          key={owner ?? 'all'}
        >
          {owner ?? '전체'}
        </Link>
      ))}
    </div>
  )
}

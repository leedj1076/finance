import type { ReactNode } from 'react'

import { AppHeader } from '@/components/app-header'
import type { HeaderSection } from '@/components/app-header-menu'

import { OwnerChips } from './owner-chips'
import type { StatusLine } from './queries'
import { SpaceMemo } from './space-memo'
import { StatusLineView } from './status-line'

type Props = {
  active: HeaderSection
  email: string
  eyebrow: string
  title: string
  subtitle?: ReactNode
  status?: StatusLine
  owners: string[]
  owner: string | null
  ownerHref: (owner: string | null) => string
  children: ReactNode
}

export function InvestmentPageShell({ active, email, eyebrow, title, subtitle, status, owners, owner, ownerHref, children }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <AppHeader active={active} email={email} space="investment" />
      <SpaceMemo />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-24 pt-9 sm:px-12 sm:pb-14">
        <div className="flex flex-col items-start justify-between gap-4 min-[861px]:flex-row min-[861px]:items-end">
          <div>
            <p className="t-label uppercase text-finance-blue">{eyebrow}</p>
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 t-page-title text-finance-ink">
              {title}
              {subtitle && <span className="t-caption font-medium text-finance-muted">{subtitle}</span>}
            </h1>
          </div>
          {owners.length > 1 && <OwnerChips active={owner} href={ownerHref} owners={owners} />}
        </div>
        {status && <StatusLineView status={status} />}
        {children}
      </main>
    </div>
  )
}

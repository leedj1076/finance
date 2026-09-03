'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export type HeaderSection = 'assets' | 'budgets' | 'dashboard' | 'inbox' | 'ledger' | 'report' | 'settings'

type AppHeaderMenuProps = {
  active: HeaderSection
  email: string
  pendingInboxCount: number
}

type MenuName = 'more' | 'settings' | null

const primaryLinks: Array<{ key: HeaderSection; href: string; label: string; mobile?: boolean }> = [
  { key: 'dashboard', href: '/dashboard', label: '홈', mobile: true },
  { key: 'ledger', href: '/ledger', label: '거래', mobile: true },
  { key: 'inbox', href: '/inbox', label: '가져오기', mobile: true },
  { key: 'budgets', href: '/budgets', label: '예산', mobile: true },
  { key: 'report', href: '/report', label: '연간' },
  { key: 'assets', href: '/assets', label: '자산' },
]

const settingsLinks: Array<{ href: string; label: string; description: string }> = [
  { href: '/manage?tab=accounts', label: '결제수단', description: '카드와 계좌 관리' },
  { href: '/manage?tab=categories', label: '카테고리', description: '대분류와 소분류 편집' },
  { href: '/manage?tab=rules', label: '가져오기 규칙', description: '가맹점 사전과 결제수단 별칭' },
  { href: '/recurring', label: '정기거래 규칙', description: '정기 수입·지출·저축' },
  { href: '/settings', label: '계정 및 보안', description: '비밀번호와 로그인 계정' },
]

function isMoreSection(active: HeaderSection) {
  return active === 'assets' || active === 'report' || active === 'settings'
}

export function AppHeaderMenu({ active, email, pendingInboxCount }: AppHeaderMenuProps) {
  const pathname = usePathname()
  const [openMenu, setOpenMenu] = useState<MenuName>(null)
  const headerRef = useRef<HTMLElement>(null)
  const previousPathname = useRef(pathname)
  const initials = email.split('@')[0]?.slice(0, 2).toUpperCase() || 'ME'

  useEffect(() => {
    if (previousPathname.current !== pathname) setOpenMenu(null)
    previousPathname.current = pathname
  }, [pathname])

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const navClass = (selected: boolean) => `finance-nav-link ${selected ? 'is-active' : ''}`
  const toggleMenu = (menu: Exclude<MenuName, null>) => setOpenMenu((current) => current === menu ? null : menu)

  return (
    <header className="finance-header" ref={headerRef}>
      <div className="finance-header-inner">
        <Link aria-label="우리집 가계부 홈" className="finance-brand" href="/dashboard">
          <span aria-hidden="true" className="finance-brand-mark">₩</span>
          <span>우리집 가계부</span>
        </Link>

        <nav aria-label="주 메뉴" className="finance-desktop-nav">
          {primaryLinks.map((link) => (
            <Link className={navClass(active === link.key)} href={link.href} key={link.href}>
              {link.label}
              {link.key === 'inbox' && pendingInboxCount > 0 && (
                <span aria-label={`처리할 거래 ${pendingInboxCount}건`} className="finance-count-badge">
                  {pendingInboxCount > 99 ? '99+' : pendingInboxCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="finance-user-actions">
          <div className="finance-popover-wrap">
            <button
              aria-expanded={openMenu === 'settings'}
              aria-haspopup="menu"
              aria-label="설정 메뉴"
              className={`finance-settings-button ${active === 'settings' ? 'is-active' : ''}`}
              onClick={() => toggleMenu('settings')}
              type="button"
            >
              <span aria-hidden="true">⚙</span>
            </button>
            {openMenu === 'settings' && <HeaderSettingsPopover email={email} />}
          </div>
          <span aria-label={email} className="finance-user-initial" title={email}>{initials}</span>
        </div>

        <nav aria-label="모바일 주 메뉴" className="finance-mobile-bottom-nav">
          {primaryLinks.filter((link) => link.mobile).map((link) => (
            <Link className={navClass(active === link.key)} href={link.href} key={link.href}>
              <span>{link.label}</span>
              {link.key === 'inbox' && pendingInboxCount > 0 && (
                <span aria-label={`처리할 거래 ${pendingInboxCount}건`} className="finance-count-badge">
                  {pendingInboxCount > 99 ? '99+' : pendingInboxCount}
                </span>
              )}
            </Link>
          ))}
          <button
            aria-expanded={openMenu === 'more'}
            aria-haspopup="menu"
            className={navClass(isMoreSection(active))}
            onClick={() => toggleMenu('more')}
            type="button"
          >
            더보기
          </button>
        </nav>

        {openMenu === 'more' && (
          <div className="finance-mobile-more" role="menu">
            <p>업무</p>
            <Link className={navClass(active === 'report')} href="/report" role="menuitem">연간</Link>
            <Link className={navClass(active === 'assets')} href="/assets" role="menuitem">자산</Link>
            <p>설정</p>
            {settingsLinks.map((link) => (
              <Link className={navClass(active === 'settings')} href={link.href} key={link.href} role="menuitem">
                {link.label}
              </Link>
            ))}
            <div className="finance-mobile-account">
              <span title={email}>{email}</span>
              <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function HeaderSettingsPopover({ email }: { email: string }) {
  return (
    <div className="finance-popover is-right" role="menu">
      {settingsLinks.map((link) => (
        <Link className="finance-popover-item" href={link.href} key={link.href} role="menuitem">
          <span>{link.label}</span>
          <small>{link.description}</small>
        </Link>
      ))}
      <div className="finance-popover-account">
        <span title={email}>{email}</span>
        <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
      </div>
    </div>
  )
}

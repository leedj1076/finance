'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { rememberSpace, SPACE_HOME, type Space } from '@/features/investment/space'

import { ThemeSelector } from './theme-selector'

export type HeaderSection =
  | 'assets' | 'budgets' | 'dashboard' | 'inbox' | 'ledger' | 'report' | 'settings'
  | 'investment' | 'investment-trend' | 'investment-transactions' | 'investment-watch' | 'investment-advisor' | 'investment-settings'

type AppHeaderMenuProps = {
  active: HeaderSection
  email: string
  pendingInboxCount: number
  space?: Space
}

type MenuName = 'more' | 'settings' | 'space' | null
type NavLink = { key: HeaderSection; href: string; label: string; mobile?: boolean }

const ledgerLinks: NavLink[] = [
  { key: 'dashboard', href: '/dashboard', label: '홈', mobile: true },
  { key: 'ledger', href: '/ledger', label: '내역', mobile: true },
  { key: 'budgets', href: '/budgets', label: '예산', mobile: true },
  { key: 'assets', href: '/assets', label: '자산' },
  { key: 'report', href: '/report', label: '통계' },
  { key: 'inbox', href: '/inbox', label: '가져오기', mobile: true },
]

const investmentLinks: NavLink[] = [
  { key: 'investment', href: '/investment', label: '보유', mobile: true },
  { key: 'investment-trend', href: '/investment/trend', label: '추이', mobile: true },
  { key: 'investment-transactions', href: '/investment/transactions', label: '거래', mobile: true },
  { key: 'investment-watch', href: '/investment/watch', label: '관심', mobile: true },
  { key: 'investment-advisor', href: '/investment/advisor', label: '어드바이저' },
]

const ledgerSettings: Array<{ href: string; label: string; description: string }> = [
  { href: '/manage?tab=accounts', label: '결제수단', description: '카드와 계좌 관리' },
  { href: '/manage?tab=categories', label: '카테고리', description: '대분류와 소분류 편집' },
  { href: '/manage?tab=rules', label: '가져오기 규칙', description: '가맹점 사전과 결제수단 별칭' },
  { href: '/recurring', label: '정기거래 규칙', description: '정기 수입·지출·저축' },
  { href: '/settings?section=assets', label: '자산 계정', description: '자산 그룹과 계정 이름' },
  { href: '/settings?section=security', label: '계정 및 보안', description: '비밀번호와 로그인 계정' },
]

const investmentSettings: Array<{ href: string; label: string; description: string }> = [
  { href: '/investment/settings', label: '증권 계좌', description: '키움 계좌와 소유자' },
  { href: '/settings?section=security', label: '계정 및 보안', description: '비밀번호와 로그인 계정' },
]

const SPACES: Array<{ key: Space; label: string; mark: string; description: string }> = [
  { key: 'ledger', label: '우리집 가계부', mark: '₩', description: '수입·지출·예산·자산' },
  { key: 'investment', label: '우리집 투자', mark: '↗', description: '보유·헬스체크·어드바이저' },
]

function isMoreSection(space: Space, active: HeaderSection) {
  if (space === 'investment') return active === 'investment-advisor' || active === 'investment-settings'
  return active === 'assets' || active === 'report' || active === 'settings'
}

export function AppHeaderMenu({ active, email, pendingInboxCount, space = 'ledger' }: AppHeaderMenuProps) {
  const pathname = usePathname()
  const [openMenu, setOpenMenu] = useState<MenuName>(null)
  const headerRef = useRef<HTMLElement>(null)
  const previousPathname = useRef(pathname)
  const initials = email.split('@')[0]?.slice(0, 2).toUpperCase() || 'ME'
  const links = space === 'investment' ? investmentLinks : ledgerLinks
  const settingsLinks = space === 'investment' ? investmentSettings : ledgerSettings
  const current = SPACES.find((item) => item.key === space) ?? SPACES[0]
  const other = SPACES.find((item) => item.key !== space) ?? SPACES[1]

  useEffect(() => {
    if (previousPathname.current !== pathname) setOpenMenu(null)
    previousPathname.current = pathname
  }, [pathname])

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.defaultPrevented) return
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
  const toggleMenu = (menu: Exclude<MenuName, null>) => setOpenMenu((value) => value === menu ? null : menu)
  const badge = (link: NavLink) => link.key === 'inbox' && pendingInboxCount > 0 && (
    <span aria-label={`처리할 거래 ${pendingInboxCount}건`} className="finance-count-badge">{pendingInboxCount > 99 ? '99+' : pendingInboxCount}</span>
  )

  return (
    <header className="finance-header" ref={headerRef}>
      <div className="finance-header-inner">
        <div className="finance-popover-wrap finance-space-switcher">
          <button
            aria-expanded={openMenu === 'space'}
            aria-haspopup="menu"
            aria-label="공간 전환"
            className="finance-brand"
            onClick={() => toggleMenu('space')}
            type="button"
          >
            <span aria-hidden="true" className="finance-brand-mark">{current.mark}</span>
            <span>{current.label}</span>
            <span aria-hidden="true" className="finance-brand-caret">⌄</span>
          </button>
          {openMenu === 'space' && (
            <div className="finance-popover" role="menu">
              {SPACES.map((item) => (
                <Link
                  aria-current={item.key === space ? 'true' : undefined}
                  className={`finance-popover-item ${item.key === space ? 'is-current' : ''}`}
                  href={SPACE_HOME[item.key]}
                  key={item.key}
                  onClick={() => rememberSpace(item.key)}
                  role="menuitem"
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </Link>
              ))}
            </div>
          )}
        </div>

        <nav aria-label="주 메뉴" className="finance-desktop-nav">
          {links.map((link) => (
            <Link aria-current={active === link.key ? 'page' : undefined} className={navClass(active === link.key)} href={link.href} key={link.href}>
              {link.label}{badge(link)}
            </Link>
          ))}
        </nav>

        <div className="finance-user-actions">
          <div onClickCapture={() => setOpenMenu(null)}><ThemeSelector /></div>
          {space === 'investment' ? (
            <Link aria-label="투자 설정" className={`finance-settings-button ${active === 'investment-settings' ? 'is-active' : ''}`} href="/investment/settings"><span aria-hidden="true">⚙</span></Link>
          ) : <div className="finance-popover-wrap">
            <button
              aria-expanded={openMenu === 'settings'}
              aria-haspopup="menu"
              aria-label="설정 메뉴"
              className={`finance-settings-button ${active === 'settings' || active === 'investment-settings' ? 'is-active' : ''}`}
              onClick={() => toggleMenu('settings')}
              type="button"
            >
              <span aria-hidden="true">⚙</span>
            </button>
            {openMenu === 'settings' && (
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
            )}
          </div>}
          <span aria-label={email} className="finance-user-initial" title={email}>{initials}</span>
        </div>

        <nav aria-label="모바일 주 메뉴" className="finance-mobile-bottom-nav">
          {links.filter((link) => link.mobile).map((link) => (
            <Link aria-current={active === link.key ? 'page' : undefined} className={navClass(active === link.key)} href={link.href} key={link.href}>
              <span>{link.label}</span>{badge(link)}
            </Link>
          ))}
          <button aria-expanded={openMenu === 'more'} aria-haspopup="menu" className={navClass(isMoreSection(space, active))} onClick={() => toggleMenu('more')} type="button">
            더보기
          </button>
        </nav>

        {openMenu === 'more' && (
          <div className="finance-mobile-more" role="menu">
            <p>업무</p>
            {links.filter((link) => !link.mobile).map((link) => (
              <Link className={navClass(active === link.key)} href={link.href} key={link.href} role="menuitem">{link.label}</Link>
            ))}
            <p>설정</p>
            {settingsLinks.map((link) => (
              <Link className={navClass(active === 'settings' || active === 'investment-settings')} href={link.href} key={link.href} role="menuitem">{link.label}</Link>
            ))}
            <p>공간</p>
            <Link className="finance-nav-link" href={SPACE_HOME[other.key]} onClick={() => rememberSpace(other.key)} role="menuitem">{other.label}로 전환</Link>
            <p>테마</p>
            <ThemeSelector mobile />
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

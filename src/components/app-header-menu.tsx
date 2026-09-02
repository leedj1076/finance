'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export type HeaderSection = 'analysis' | 'assets' | 'budgets' | 'dashboard' | 'inbox' | 'ledger' | 'manage' | 'recurring' | 'report' | 'settings'

type AppHeaderMenuProps = {
  active: HeaderSection
  email: string
  pendingInboxCount: number
}

type MenuName = 'analysis' | 'settings' | 'mobile' | null

const directLinks: Array<{ key: HeaderSection; href: string; label: string }> = [
  { key: 'ledger', href: '/ledger', label: '가계부' },
  { key: 'dashboard', href: '/dashboard', label: '대시보드' },
  { key: 'assets', href: '/assets', label: '자산' },
  { key: 'inbox', href: '/inbox', label: '인박스' },
]

const analysisLinks: Array<{ key: HeaderSection; href: string; label: string; description: string }> = [
  { key: 'analysis', href: '/analysis', label: '분석', description: '지출 변화와 가맹점 분석' },
  { key: 'analysis', href: '/category', label: '항목별 상세', description: '대분류 하나를 골라 깊이 보기' },
  { key: 'budgets', href: '/budgets', label: '예산', description: '월 예산과 사용 속도' },
  { key: 'report', href: '/report', label: '연간결산', description: '연간 비교와 현금흐름' },
]

const settingsLinks: Array<{ key: HeaderSection; href: string; label: string; description: string }> = [
  { key: 'inbox', href: '/inbox#upload', label: '가져오기', description: '뱅샐·카드사 파일 업로드' },
  { key: 'manage', href: '/manage?tab=accounts', label: '결제수단', description: '카드와 계좌 관리' },
  { key: 'manage', href: '/manage?tab=categories', label: '항목 관리', description: '대분류와 소분류 편집' },
  { key: 'recurring', href: '/recurring', label: '고정비용', description: '정기 수입·지출·저축' },
  { key: 'settings', href: '/settings', label: '계정 설정', description: '비밀번호와 로그인 계정' },
]

function isAnalysisSection(active: HeaderSection) {
  return active === 'analysis' || active === 'budgets' || active === 'report'
}

function isSettingsSection(active: HeaderSection) {
  return active === 'manage' || active === 'recurring' || active === 'settings'
}

export function AppHeaderMenu({ active, email, pendingInboxCount }: AppHeaderMenuProps) {
  const pathname = usePathname()
  const [openMenu, setOpenMenu] = useState<MenuName>(null)
  const headerRef = useRef<HTMLElement>(null)
  const previousPathname = useRef(pathname)

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
        <Link aria-label="우리집 가계부 대시보드" className="finance-brand" href="/dashboard">
          <span aria-hidden="true" className="finance-brand-mark">₩</span>
          <span>우리집 가계부</span>
        </Link>
        <nav aria-label="주 메뉴" className="finance-desktop-nav">
          {directLinks.map((link) => (
            <Link className={navClass(active === link.key)} href={link.href} key={link.href}>
              {link.label}
              {link.key === 'inbox' && pendingInboxCount > 0 && (
                <span aria-label={`처리할 거래 ${pendingInboxCount}건`} className="finance-count-badge">{pendingInboxCount > 99 ? '99+' : pendingInboxCount}</span>
              )}
            </Link>
          ))}
          <div className="finance-popover-wrap">
            <button aria-expanded={openMenu === 'analysis'} aria-haspopup="menu" className={navClass(isAnalysisSection(active))} onClick={() => toggleMenu('analysis')} type="button">
              분석·예산 <span aria-hidden="true" className="finance-chevron">⌄</span>
            </button>
            {openMenu === 'analysis' && <HeaderPopover links={analysisLinks} />}
          </div>
          <div className="finance-popover-wrap">
            <button aria-expanded={openMenu === 'settings'} aria-haspopup="menu" className={navClass(isSettingsSection(active))} onClick={() => toggleMenu('settings')} type="button">
              설정 <span aria-hidden="true" className="finance-chevron">⌄</span>
            </button>
            {openMenu === 'settings' && <HeaderPopover align="right" links={settingsLinks} />}
          </div>
        </nav>
        <div className="finance-user-actions">
          <span className="finance-user-email" title={email}>{email}</span>
          <form action="/auth/signout" method="post"><button className="finance-signout" type="submit">로그아웃</button></form>
        </div>
        <button aria-expanded={openMenu === 'mobile'} aria-label="메뉴 열기" className="finance-mobile-toggle" onClick={() => toggleMenu('mobile')} type="button">
          <span aria-hidden="true">☰</span>
          {pendingInboxCount > 0 && <span className="finance-count-badge">{pendingInboxCount > 99 ? '99+' : pendingInboxCount}</span>}
        </button>
        {openMenu === 'mobile' && (
          <div className="finance-mobile-menu">
            {[...directLinks, ...analysisLinks, ...settingsLinks].map((link, index) => (
              <Link className={navClass(active === link.key)} href={link.href} key={`${link.href}-${index}`}>
                {link.label}
                {link.key === 'inbox' && pendingInboxCount > 0 && <span className="finance-count-badge">{pendingInboxCount}</span>}
              </Link>
            ))}
            <div className="finance-mobile-account">
              <span>{email}</span>
              <form action="/auth/signout" method="post"><button type="submit">로그아웃</button></form>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

function HeaderPopover({ align = 'left', links }: { align?: 'left' | 'right'; links: Array<{ href: string; label: string; description: string }> }) {
  return (
    <div className={`finance-popover ${align === 'right' ? 'is-right' : ''}`} role="menu">
      {links.map((link) => (
        <Link className="finance-popover-item" href={link.href} key={link.href} role="menuitem">
          <span>{link.label}</span><small>{link.description}</small>
        </Link>
      ))}
    </div>
  )
}

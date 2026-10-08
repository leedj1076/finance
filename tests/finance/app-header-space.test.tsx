import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/investment' }))
vi.mock('@/components/theme-selector', () => ({ ThemeSelector: () => null }))

import { AppHeaderMenu } from '@/components/app-header-menu'
import { parseSpace } from '@/features/investment/space'

describe('parseSpace', () => {
  it('defaults to ledger and accepts investment', () => {
    expect(parseSpace(undefined)).toBe('ledger')
    expect(parseSpace('nonsense')).toBe('ledger')
    expect(parseSpace('investment')).toBe('investment')
  })
})

describe('AppHeaderMenu spaces', () => {
  it('renders the investment brand and menu without ledger links', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="investment" email="a@b.c" pendingInboxCount={0} space="investment" />)
    expect(html).toContain('우리집 투자')
    for (const label of ['보유', '추이', '거래', '관심', '어드바이저']) expect(html).toContain(`>${label}<`)
    expect(html).not.toContain('href="/ledger"')
    expect(html).not.toContain('href="/budgets"')
    expect(html).toContain('aria-label="설정 메뉴"')
    expect(html).toMatch(/href="\/investment"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/investment"|is-active[^>]*href="\/investment"/)
  })

  it('keeps the ledger header unchanged and never adds an investment link to it', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="dashboard" email="a@b.c" pendingInboxCount={0} />)
    expect(html).toContain('우리집 가계부')
    expect(html).toContain('href="/ledger"')
    expect(html).not.toContain('href="/investment"')
  })

  it('marks the current space in the brand switcher', () => {
    const html = renderToStaticMarkup(<AppHeaderMenu active="investment" email="a@b.c" pendingInboxCount={0} space="investment" />)
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="공간 전환"')
  })
})

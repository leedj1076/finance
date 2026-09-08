'use client'

import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  applySystemThemeChange,
  applyThemePreference,
  isThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from '@/features/theme/theme'

const options: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
  { value: 'system', label: '시스템' },
]

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === 'light') {
    return (
      <svg aria-hidden="true" className="finance-theme-icon" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="3.25" />
        <path d="M10 1.75v2M10 16.25v2M1.75 10h2M16.25 10h2M4.16 4.16l1.42 1.42M14.42 14.42l1.42 1.42M15.84 4.16l-1.42 1.42M5.58 14.42l-1.42 1.42" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg aria-hidden="true" className="finance-theme-icon" viewBox="0 0 20 20">
        <path d="M16.72 12.18A6.8 6.8 0 0 1 7.82 3.28a6.8 6.8 0 1 0 8.9 8.9Z" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" className="finance-theme-icon" viewBox="0 0 20 20">
      <rect height="10.5" rx="1.5" width="15" x="2.5" y="3" />
      <path d="M7 17h6M10 13.5V17" />
    </svg>
  )
}

export function ThemeSelector({ mobile = false }: { mobile?: boolean }) {
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = mobile ? 'finance-theme-menu-mobile' : 'finance-theme-menu-desktop'
  const currentLabel = options.find((option) => option.value === theme)?.label ?? '시스템'

  useEffect(() => {
    const syncFromDocument = () => {
      const applied = document.documentElement.dataset.themePreference
      setTheme(isThemePreference(applied) ? applied : 'system')
    }

    syncFromDocument()
    window.addEventListener(THEME_CHANGE_EVENT, syncFromDocument)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, syncFromDocument)
  }, [])

  useEffect(() => {
    if (!open) return

    const selectedIndex = options.findIndex((option) => option.value === theme)
    optionRefs.current[selectedIndex]?.focus()
  }, [open, theme])

  useEffect(() => {
    if (!open) return

    function closeOnOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [open])

  function closeAndRestoreFocus() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function selectTheme(nextTheme: ThemePreference) {
    applyThemePreference(nextTheme)
    closeAndRestoreFocus()
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget as Node | null
    if (!nextTarget || !containerRef.current?.contains(nextTarget)) setOpen(false)
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement)
    if (currentIndex < 0) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % options.length
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + options.length) % options.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = options.length - 1
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectTheme(options[currentIndex].value)
      return
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestoreFocus()
      return
    } else if (event.key === 'Tab') {
      setOpen(false)
      return
    }

    if (nextIndex !== null) {
      event.preventDefault()
      optionRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <div
      className={`finance-theme-selector ${mobile ? 'is-mobile' : ''}`}
      onBlur={handleBlur}
      ref={containerRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`화면 테마: ${currentLabel}`}
        className="finance-theme-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <ThemeIcon theme={theme} />
        <span aria-hidden="true" className="finance-theme-trigger-label">{currentLabel}</span>
        <span aria-hidden="true" className="finance-theme-chevron">⌄</span>
      </button>

      {open && (
        <div
          aria-label="화면 테마 선택"
          className="finance-theme-menu"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          role="menu"
        >
          {options.map((option, index) => (
            <button
              aria-checked={theme === option.value}
              aria-label={option.label}
              className="finance-theme-menu-item"
              key={option.value}
              onClick={() => selectTheme(option.value)}
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              role="menuitemradio"
              tabIndex={theme === option.value ? 0 : -1}
              type="button"
            >
              <ThemeIcon theme={option.value} />
              <span>{option.label}</span>
              <span aria-hidden="true" className="finance-theme-check">✓</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ThemeController() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => applySystemThemeChange(media.matches)

    media.addEventListener('change', syncSystemTheme)
    return () => media.removeEventListener('change', syncSystemTheme)
  }, [])

  return null
}

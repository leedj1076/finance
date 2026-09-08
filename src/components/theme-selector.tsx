'use client'

import { useEffect, useState } from 'react'

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

export function ThemeSelector({ mobile = false }: { mobile?: boolean }) {
  const [theme, setTheme] = useState<ThemePreference>('system')

  useEffect(() => {
    const syncFromDocument = () => {
      const applied = document.documentElement.dataset.themePreference
      setTheme(isThemePreference(applied) ? applied : 'system')
    }

    syncFromDocument()
    window.addEventListener(THEME_CHANGE_EVENT, syncFromDocument)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, syncFromDocument)
  }, [])

  return (
    <div
      aria-label="화면 테마"
      className={`finance-theme-selector ${mobile ? 'is-mobile' : ''}`}
      role="group"
    >
      {options.map((option) => (
        <button
          aria-pressed={theme === option.value}
          className={theme === option.value ? 'is-active' : ''}
          key={option.value}
          onClick={() => applyThemePreference(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
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

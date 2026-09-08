import { afterEach, describe, expect, test, vi } from 'vitest'

import { subscribeToChartThemeChanges } from '@/features/analytics/chart-js'
import {
  applyThemePreference,
  applySystemThemeChange,
  readThemePreference,
  THEME_CHANGE_EVENT,
  THEME_INIT_SCRIPT,
} from '@/features/theme/theme'

function storageWith(value: string | null): Storage {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
  } as unknown as Storage
}

function runInitScript(storage: Storage, prefersDark = false) {
  const root = { dataset: {} as DOMStringMap }
  const execute = new Function('document', 'localStorage', 'matchMedia', THEME_INIT_SCRIPT)
  execute({ documentElement: root }, storage, () => ({ matches: prefersDark }))
  return root.dataset
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('theme preference', () => {
  test('uses the persisted valid preference during the first paint', () => {
    expect(runInitScript(storageWith('dark'))).toMatchObject({ theme: 'dark', themePreference: 'dark' })
  })

  test('falls back to system during the first paint when storage access is denied', () => {
    const deniedStorage = storageWith(null)
    vi.mocked(deniedStorage.getItem).mockImplementation(() => {
      throw new Error('denied')
    })

    expect(runInitScript(deniedStorage, true)).toMatchObject({ theme: 'dark', themePreference: 'system' })
  })

  test('treats missing and malformed stored values as system', () => {
    expect(readThemePreference(storageWith(null))).toBe('system')
    expect(readThemePreference(storageWith('sepia'))).toBe('system')
  })

  test('applies and announces a manual preference even when persistence is denied', () => {
    const root = { dataset: {} as DOMStringMap }
    const deniedStorage = storageWith(null)
    vi.mocked(deniedStorage.setItem).mockImplementation(() => {
      throw new Error('denied')
    })
    const events = new EventTarget()
    const changed = vi.fn()
    events.addEventListener(THEME_CHANGE_EVENT, changed)

    applyThemePreference('light', { root, storage: deniedStorage, events })

    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.themePreference).toBe('light')
    expect(changed).toHaveBeenCalledOnce()
  })

  test('applies a manual preference when the localStorage getter itself is denied', () => {
    const root = { dataset: {} as DOMStringMap }
    const events = new EventTarget()
    const deniedWindow = Object.defineProperty(events, 'localStorage', {
      get() { throw new Error('denied') },
    })
    vi.stubGlobal('window', deniedWindow)

    expect(() => applyThemePreference('dark', { root, events })).not.toThrow()
    expect(root.dataset.theme).toBe('dark')
  })

  test('resolves system against the browser preference', () => {
    const root = { dataset: {} as DOMStringMap }

    applyThemePreference('system', {
      root,
      storage: storageWith(null),
      events: new EventTarget(),
      media: { matches: true } as MediaQueryList,
    })

    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themePreference).toBe('system')
  })

  test('announces a system color change only after the resolved theme is applied', () => {
    const root = { dataset: { theme: 'dark', themePreference: 'system' } as DOMStringMap }
    const events = new EventTarget()
    const observedThemes: Array<string | undefined> = []
    events.addEventListener(THEME_CHANGE_EVENT, () => observedThemes.push(root.dataset.theme))

    applySystemThemeChange(false, { root, events })

    expect(observedThemes).toEqual(['light'])
  })

  test('persists a selected preference for later navigation and reloads', () => {
    const root = { dataset: {} as DOMStringMap }
    const storage = storageWith(null)

    applyThemePreference('dark', { root, storage, events: new EventTarget() })

    expect(storage.setItem).toHaveBeenCalledWith('finance-theme', 'dark')
  })
})

test('chart theme subscription responds to manual and system theme changes', () => {
  const events = new EventTarget()
  const mediaListeners = new Set<EventListener>()
  const media = {
    addEventListener: (_name: string, listener: EventListener) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: EventListener) => mediaListeners.delete(listener),
  } as unknown as MediaQueryList
  const update = vi.fn()

  const unsubscribe = subscribeToChartThemeChanges(update, { events, media })
  events.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  mediaListeners.forEach((listener) => listener(new Event('change')))

  expect(update).toHaveBeenCalledTimes(2)

  unsubscribe()
  events.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  mediaListeners.forEach((listener) => listener(new Event('change')))
  expect(update).toHaveBeenCalledTimes(2)
})

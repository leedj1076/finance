export const THEME_STORAGE_KEY = 'finance-theme'
export const THEME_CHANGE_EVENT = 'finance-theme-change'

export type ThemePreference = 'light' | 'dark' | 'system'

type ThemeRoot = Pick<HTMLElement, 'dataset'>

type ApplyThemeOptions = {
  root?: ThemeRoot
  storage?: Pick<Storage, 'setItem'> | null
  events?: Pick<EventTarget, 'dispatchEvent'>
  media?: Pick<MediaQueryList, 'matches'>
}

export const THEME_INIT_SCRIPT = `(()=>{let p='system';try{const s=localStorage.getItem('finance-theme');if(s==='light'||s==='dark'||s==='system')p=s}catch{}const d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);const r=document.documentElement.dataset;r.themePreference=p;r.theme=d?'dark':'light'})()`

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readThemePreference(storage?: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

export function resolveThemePreference(theme: ThemePreference, prefersDark: boolean) {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}

export function applyThemePreference(
  theme: ThemePreference,
  options: ApplyThemeOptions = {},
) {
  const root = options.root ?? document.documentElement
  const events = options.events ?? window
  let storage = options.storage
  if (storage === undefined) {
    try {
      storage = window.localStorage
    } catch {
      storage = null
    }
  }
  const prefersDark = theme === 'system'
    ? (options.media ?? window.matchMedia('(prefers-color-scheme: dark)')).matches
    : false
  root.dataset.themePreference = theme
  root.dataset.theme = resolveThemePreference(theme, prefersDark)
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // A private or locked-down browser can deny storage while still allowing
    // the in-page preference to work.
  }
  events.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

export function applySystemThemeChange(
  prefersDark: boolean,
  {
    root = document.documentElement,
    events = window,
  }: Pick<ApplyThemeOptions, 'root' | 'events'> = {},
) {
  if (root.dataset.themePreference !== 'system') return
  root.dataset.theme = resolveThemePreference('system', prefersDark)
  events.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

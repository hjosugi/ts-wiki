import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'ts-wiki:theme'
const mode = ref<ThemeMode>('system')
let started = false

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

/** Whether a given mode resolves to a dark appearance right now. */
export const resolveDark = (m: ThemeMode): boolean => (m === 'system' ? prefersDark() : m === 'dark')

/** Toggle order for the header button: light → dark → system → light. */
export const nextMode = (m: ThemeMode): ThemeMode => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light')

const applyMode = (): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolveDark(mode.value))
  }
}

const readStored = (): ThemeMode | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : null
  } catch {
    return null
  }
}

const setMode = (next: ThemeMode, persist: boolean): void => {
  mode.value = next
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable — session-only is fine */
    }
  }
  applyMode()
}

/** Apply the stored (or OS) theme immediately and follow OS changes in system mode. */
export function initTheme(): void {
  if (started) return
  started = true
  mode.value = readStored() ?? 'system'
  applyMode()
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (mode.value === 'system') applyMode()
  })
}

/**
 * Use the admin site theme as the default when the visitor hasn't chosen one.
 * Applied without persisting, so it stays a default rather than a user choice.
 */
export function applySiteDefault(theme: ThemeMode | undefined): void {
  if (!theme || readStored()) return
  setMode(theme, false)
}

export function useTheme() {
  return {
    mode,
    cycle: () => setMode(nextMode(mode.value), true),
    setMode: (next: ThemeMode) => setMode(next, true),
  }
}

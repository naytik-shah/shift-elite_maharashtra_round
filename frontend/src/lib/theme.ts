import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark'

export function useTheme() {
  const [theme, set] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('fd.theme', t) } catch { /* ignore */ }
    set(t)
  }, [])
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}

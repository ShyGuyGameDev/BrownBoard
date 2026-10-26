import { useEffect, useState } from 'react'
import type { Theme } from '../design/tokens'

export const initialTheme = (): Theme => {
  const saved = localStorage.getItem('devboard.theme') as Theme | null
  return saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

/** Theme lives on <html data-theme>, so every screen (onboarding, rooms, board) shares it. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('devboard.theme', theme)
  }, [theme])
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return { theme, toggle }
}

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
    // Phone browsers tint their own toolbars to match the page's top bar.
    const panel = getComputedStyle(document.documentElement).getPropertyValue('--dv-panel').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', panel)
  }, [theme])
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return { theme, toggle }
}

/**
 * Design tokens — the single source of truth for colour, type, spacing, radius, elevation and motion.
 *
 * Three tiers (the structure the W3C Design Tokens Community Group format uses):
 *   1. `primitive` — raw values with no meaning attached (a grey, a blue, 8px).
 *   2. `semantic`  — what a value is *for* (`bg`, `text`, `accent`), defined per theme.
 *   3. component styles in devboard.css consume semantic tokens only, never primitives.
 *
 * `installTokens()` writes everything below as `--dv-*` CSS custom properties, so CSS and the
 * canvas (which draws with JS and can't read CSS variables cheaply every frame) share one set of values.
 * Change a value here, never in devboard.css.
 */

/* ------------------------------------------------------------------ */
/* 1. Primitives                                                       */
/* ------------------------------------------------------------------ */

export const primitive = {
  gray: {
    0: '#ffffff',
    25: '#f7f7f5',
    50: '#f4f5f7',
    100: '#eceef2',
    200: '#dfe2e8',
    250: '#d9dce3',
    500: '#6b7280',
    550: '#8f94a1',
    600: '#9499a6',
    800: '#343843',
    850: '#2b2e36',
    900: '#1f2127',
    925: '#1b1d23',
    950: '#17181d',
    975: '#0f1013',
    990: '#0d0e11',
    1000: '#15171c',
    ink: '#e8e9ee',
  },
  indigo: { 500: '#4a62f0', 300: '#7d8cff' },
  red: { 500: '#e5484d', 300: '#ff6b70' },
  green: { 500: '#22c55e', 300: '#4ade80' },
  amber: { 500: '#f59e0b', 300: '#fbbf24' },
} as const

/* ------------------------------------------------------------------ */
/* 2. Semantic colour (per theme)                                      */
/* ------------------------------------------------------------------ */

const g = primitive.gray

export const color = {
  light: {
    bg: g[50],
    panel: g[0],
    'panel-2': g[100],
    border: g[200],
    text: g[1000],
    muted: g[500],
    accent: primitive.indigo[500],
    'accent-fg': g[0],
    'accent-soft': 'rgba(74, 98, 240, 0.12)',
    danger: primitive.red[500],
    success: primitive.green[500],
    warning: primitive.amber[500],
    shadow: '0 12px 34px rgba(16, 24, 40, 0.12), 0 1px 2px rgba(16, 24, 40, 0.08)',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.12)',
    'shadow-card': '0 2px 10px rgba(16, 24, 40, 0.08)',
  },
  dark: {
    bg: g[975],
    panel: g[950],
    'panel-2': g[900],
    border: g[850],
    text: g.ink,
    muted: g[550],
    accent: primitive.indigo[300],
    'accent-fg': g[975],
    'accent-soft': 'rgba(125, 140, 255, 0.16)',
    danger: primitive.red[300],
    success: primitive.green[300],
    warning: primitive.amber[300],
    shadow: '0 14px 40px rgba(0, 0, 0, 0.55), 0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-card': '0 2px 10px rgba(0, 0, 0, 0.35)',
  },
} as const

export type Theme = keyof typeof color

/** The canvas is a slightly different surface from the app chrome (warmer paper, deeper night). */
export const canvas = {
  light: {
    bg: g[25],
    dot: 'rgba(21,23,28,0.18)',
    line: 'rgba(21,23,28,0.07)',
    ink: g[1000],
    panel: g[0],
    border: g[250],
    muted: g[500],
    accent: primitive.indigo[500],
    link: '#5b6272',
  },
  dark: {
    bg: g[990],
    dot: 'rgba(255,255,255,0.15)',
    line: 'rgba(255,255,255,0.06)',
    ink: g.ink,
    panel: g[925],
    border: g[800],
    muted: g[600],
    accent: primitive.indigo[300],
    link: '#a0a5b3',
  },
} as const

/** Ink colours offered on the canvas and in pickers. Saturated enough to read on both themes. */
export const swatches = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

/** Sticky-note fills (always drawn with dark text, so they're the same in both themes). */
export const noteColors = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa']
export const noteInk = '#27272a'

/* ------------------------------------------------------------------ */
/* 3. Scales shared by both themes                                     */
/* ------------------------------------------------------------------ */

export const font = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

/** Compact, app-style type scale (px). The UI is dense, so the steps are small. */
export const text = {
  '2xs': '10.5px',
  xs: '11px',
  sm: '12.5px',
  md: '13px',
  lg: '14px',
  xl: '18px',
  '2xl': '24px',
} as const

export const weight = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const

/** 4px base grid. */
export const space = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
} as const

export const radius = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '14px',
  full: '999px',
} as const

/** Control heights, so buttons, inputs and segmented controls line up. */
export const size = {
  'control-sm': '28px',
  control: '30px',
  'control-lg': '40px',
  icon: '32px',
  header: '48px',
} as const

export const motion = {
  fast: '100ms',
  base: '140ms',
  slow: '240ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const

export const z = { header: '30', popover: '50', modal: '80', toast: '100' } as const

/* ------------------------------------------------------------------ */
/* CSS output                                                          */
/* ------------------------------------------------------------------ */

const vars = (prefix: string, obj: Record<string | number, string>) =>
  Object.entries(obj).map(([k, v]) => `--dv-${prefix}${k}: ${v};`)

const themeVars = (t: Theme) => vars('', color[t]).join('\n  ')

const shared = [
  `--dv-font: ${font.sans};`,
  `--dv-mono: ${font.mono};`,
  ...vars('text-', text),
  ...vars('weight-', weight),
  ...vars('space-', space),
  ...vars('radius-', radius),
  ...vars('size-', size),
  `--dv-dur-fast: ${motion.fast};`,
  `--dv-dur-base: ${motion.base};`,
  `--dv-dur-slow: ${motion.slow};`,
  `--dv-ease: ${motion.ease};`,
  ...vars('z-', z),
].join('\n  ')

export const tokensCss = `:root {
  ${shared}
  ${themeVars('light')}
  color-scheme: light;
}
:root[data-theme='dark'] {
  ${themeVars('dark')}
  color-scheme: dark;
}`

/** Injects the tokens as CSS variables. Call once, before the first render. */
export function installTokens() {
  if (document.getElementById('dv-tokens')) return
  const style = document.createElement('style')
  style.id = 'dv-tokens'
  style.textContent = tokensCss
  document.head.prepend(style)
}

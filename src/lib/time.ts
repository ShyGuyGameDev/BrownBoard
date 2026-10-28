/** "3 hours ago", "yesterday", "just now". */
export const relative = (iso: string) => {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, secs] of steps)
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit)
  return 'just now'
}

export const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

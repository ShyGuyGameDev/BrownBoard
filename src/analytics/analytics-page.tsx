import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type Counts = { pageviews: number; visitors: number }
type Metric = keyof Counts
type Day = Counts & { date: string }
type Item = Counts & { name: string }
type Visits = {
  visits: number
  bounces: number
  avgSeconds: number
  medianSeconds: number
  screensPerVisit: number
  activeNow: number
  hours: number[]
  lengths: Record<string, number>
  landings: Record<string, number>
  screenSizes: Record<string, number>
  languages: Record<string, number>
}
type Data = {
  total: Counts
  previous: Counts | null
  days: Day[]
  breakdowns: Record<string, Item[] | null>
  visits: Visits | null
  updatedAt: string
}

const METRICS: Record<Metric, string> = { visitors: 'Visitors', pageviews: 'Page views' }
const fmt = (n: number) => n.toLocaleString()
const dayLabel = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const regions = new Intl.DisplayNames(undefined, { type: 'region', fallback: 'code' })

const isOther = (name: string) => /^others?$/i.test(name)
function country(code: string) {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}
const languages = new Intl.DisplayNames(undefined, { type: 'language', fallback: 'code' })
const language = (code: string) => {
  try {
    return code === 'unknown' ? 'Unknown' : (languages.of(code) ?? code)
  } catch {
    return code
  }
}
const duration = (s: number) =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–')
const change = (now: number, before: number | undefined) => {
  if (!before) return null
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct > 0 ? '+' : ''}${pct}% vs previous period`
}
const SIZES: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', laptop: 'Laptop', large: 'Large screen' }
const LENGTHS = ['Under 10 seconds', '10 to 59 seconds', '1 to 5 minutes', '5 to 30 minutes', 'Over 30 minutes']

/** Breakdowns from Vercel, in page order. Campaigns only show when there are some. */
const BREAKDOWNS: { key: string; title: string; label?: (s: string) => string; empty?: string; hideEmpty?: boolean }[] = [
  { key: 'referrers', title: 'Referrers', empty: 'Direct or unknown' },
  { key: 'countries', title: 'Countries', label: country },
  { key: 'pages', title: 'Pages' },
  { key: 'devices', title: 'Devices', label: (s) => capital(s) },
  { key: 'browsers', title: 'Browsers' },
  { key: 'systems', title: 'Operating systems' },
  { key: 'utmSources', title: 'Campaign sources', hideEmpty: true },
  { key: 'utmMediums', title: 'Campaign mediums', hideEmpty: true },
  { key: 'utmCampaigns', title: 'Campaigns', hideEmpty: true },
]

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

async function load(range: number): Promise<Data> {
  const res = await fetch(`/api/analytics?range=${range}`)
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('Analytics are unavailable')
  return res.json()
}

export function AnalyticsPage() {
  const [range, setRange] = useState(30)
  const [metric, setMetric] = useState<Metric>('visitors')
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['analytics', range],
    queryFn: () => load(range),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  return (
    <div className="an-page">
      <header className="an-header">
        <a className="an-brand" href="/">
          <img src="/brownboard-mark.svg" alt="" />
          BrownBoard
        </a>
        <div className="an-ranges" role="group" aria-label="Time range">
          {[7, 30].map((n) => (
            <button key={n} aria-pressed={range === n} onClick={() => setRange(n)}>
              {n} days
            </button>
          ))}
        </div>
      </header>
      <main>
        <h1>Analytics</h1>
        {isPending && <p className="an-note" role="status">Loading…</p>}
        {isError && !data && (
          <p className="an-note" role="alert">
            Couldn’t load analytics. <button className="an-retry" onClick={() => refetch()}>Try again</button>
          </p>
        )}
        {data && (
          <>
            <section className="an-card">
              <div className="an-tiles" role="group" aria-label="Metric">
                {(Object.keys(METRICS) as Metric[]).map((m) => (
                  <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                    <span>{METRICS[m]}</span>
                    <strong>{fmt(data.total[m])}</strong>
                    <small>{change(data.total[m], data.previous?.[m])}</small>
                  </button>
                ))}
              </div>
              <Chart days={data.days} metric={metric} />
              <details>
                <summary>Show as table</summary>
                <table>
                  <thead>
                    <tr><th>Date (UTC)</th><th>Visitors</th><th>Page views</th></tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{fmt(d.visitors)}</td><td>{fmt(d.pageviews)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
            <Stats data={data} />
            <div className="an-grid">
              {BREAKDOWNS.map(({ key, title, label, empty, hideEmpty }) => {
                const items = data.breakdowns[key]
                if (!items || (hideEmpty && !items.some((i) => i.name))) return null
                return <Breakdown key={key} title={title} items={items} metric={metric} label={label} empty={empty} />
              })}
            </div>
            {data.visits ? (
              <VisitDetails visits={data.visits} />
            ) : (
              <p className="an-note">Bounce rate and visit details are unavailable right now.</p>
            )}
            <p className="an-note">
              Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Days are in
              UTC, and today is still in progress. Visitors are counted once per day. A bounce is a visit that opened one
              screen for under 10 seconds.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

const H = 240
const PAD = { top: 12, right: 14, bottom: 28, left: 44 }

/** A round axis maximum that splits into four whole-number steps. */
function axisMax(max: number) {
  if (max <= 4) return 4
  const step = max / 4
  const pow = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 2.5, 5, 10].map((n) => n * pow).find((n) => n >= step && Number.isInteger(n)) ?? Math.ceil(step)
  return nice * 4
}

function Chart({ days, metric }: { days: Day[]; metric: Metric }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  useLayoutEffect(() => {
    setWidth(box.current!.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])

  const last = days.length - 1
  const max = axisMax(Math.max(...days.map((d) => d[metric])))
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const x = (i: number) => PAD.left + (i / last) * plotW
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[metric])}`).join('')
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotW / 80))))
  // The range can shrink while a later day is selected.
  const index = active === null ? null : Math.min(active, last)
  const current = index === null ? null : days[index]

  return (
    <div
      ref={box}
      className="an-chart"
      role="group"
      tabIndex={0}
      aria-label={`${METRICS[metric]} per day. Use the left and right arrow keys to read each day.`}
      onFocus={() => setActive((a) => a ?? last)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        if (!step) return
        e.preventDefault()
        setActive(Math.max(0, Math.min(last, (index ?? last) + step)))
      }}
      onPointerMove={(e) => {
        if (!plotW) return
        const px = e.clientX - box.current!.getBoundingClientRect().left
        setActive(Math.max(0, Math.min(last, Math.round(((px - PAD.left) / plotW) * last))))
      }}
      onPointerLeave={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={H} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((n) => (
            <g key={n}>
              <line className="an-gridline" x1={PAD.left} x2={width - PAD.right} y1={y((max * n) / 4)} y2={y((max * n) / 4)} />
              <text x={PAD.left - 8} y={y((max * n) / 4) + 4} textAnchor="end">{fmt((max * n) / 4)}</text>
            </g>
          ))}
          {days.map((d, i) =>
            (last - i) % every === 0 ? (
              <text key={d.date} x={x(i)} y={H - 6} textAnchor={i === last ? 'end' : i === 0 ? 'start' : 'middle'}>{dayLabel(d.date)}</text>
            ) : null,
          )}
          <path className="an-area" d={`${line}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`} />
          <path className="an-line" d={line} />
          {index !== null && current && (
            <>
              <line className="an-cross" x1={x(index)} x2={x(index)} y1={PAD.top} y2={y(0)} />
              <circle className="an-dot" cx={x(index)} cy={y(current[metric])} r={5} />
            </>
          )}
        </svg>
      )}
      {index !== null && current && width > 0 && (
        <div className="an-tip" role="status" style={{ left: Math.max(64, Math.min(width - 64, x(index))) }}>
          <strong>{fmt(current[metric])}</strong> {METRICS[metric].toLowerCase()}
          <div>{dayLabel(current.date)}</div>
        </div>
      )}
    </div>
  )
}

function Breakdown({ title, items, metric, label = (s) => s, empty = 'Unknown' }: {
  title: string
  items: Item[]
  metric: Metric
  label?: (name: string) => string
  empty?: string
}) {
  // Largest first, with the grouped remainder always last.
  const rows = items
    .filter((i) => i[metric] > 0)
    .sort((a, b) => Number(isOther(a.name)) - Number(isOther(b.name)) || b[metric] - a[metric])
  const max = Math.max(1, ...rows.map((r) => r[metric]))
  return (
    <section className="an-card">
      <h2>{title}</h2>
      {rows.length === 0 && <p className="an-note">No data yet</p>}
      <ul>
        {rows.map((r) => {
          const name = !r.name ? empty : isOther(r.name) ? 'Other' : label(r.name)
          return (
            <li key={r.name} title={`${name}: ${fmt(r.visitors)} visitors, ${fmt(r.pageviews)} page views`}>
              <span className="an-name">{name}</span>
              <span>{fmt(r[metric])}</span>
              <span className="an-bar" style={{ width: `${(r[metric] / max) * 100}%` }} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Stats({ data: { total, days, visits } }: { data: Data }) {
  const best = days.reduce((a, d) => (d.visitors > a.visitors ? d : a))
  const stats: [string, string][] = [
    ['Views per visitor', total.visitors ? (total.pageviews / total.visitors).toFixed(1) : '–'],
    ['Average visitors a day', (total.visitors / days.length).toFixed(1)],
    ['Visitors today', fmt(days[days.length - 1].visitors)],
    ['Busiest day', best.visitors ? `${dayLabel(best.date)} (${fmt(best.visitors)})` : '–'],
  ]
  if (visits) {
    const any = visits.visits > 0
    stats.unshift(
      ['On the site now', fmt(visits.activeNow)],
      ['Visits', fmt(visits.visits)],
      ['Bounce rate', share(visits.bounces, visits.visits)],
      ['Average visit', any ? duration(visits.avgSeconds) : '–'],
      ['Typical (median) visit', any ? duration(visits.medianSeconds) : '–'],
      ['Screens per visit', any ? String(visits.screensPerVisit) : '–'],
    )
  }
  return (
    <dl className="an-card an-stats">
      {stats.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function VisitDetails({ visits }: { visits: Visits }) {
  const toItems = (o: Record<string, number>) => Object.entries(o).map(([name, n]) => ({ name, n }))
  const sorted = (o: Record<string, number>) => toItems(o).sort((a, b) => b.n - a.n)
  // Hours come in UTC; show them on the viewer's clock.
  const offset = Math.round(-new Date().getTimezoneOffset() / 60)
  const hours = Array.from({ length: 24 }, (_, h) => visits.hours[(h - offset + 48) % 24])
  const max = Math.max(1, ...hours)
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })
  return (
    <>
      <section className="an-card an-gap">
        <h2>Visits by hour (your time)</h2>
        <div className="an-hours">
          {hours.map((n, h) => (
            <div key={h} className="an-hour" tabIndex={0} role="img" aria-label={`${hourLabel(h)}: ${fmt(n)} visits`}>
              <span style={{ height: `${(n / max) * 100}%` }} />
              <div className="an-tip"><strong>{fmt(n)}</strong> visits at {hourLabel(h)}</div>
            </div>
          ))}
        </div>
        <div className="an-hour-labels">
          {[0, 6, 12, 18].map((h) => <span key={h}>{hourLabel(h)}</span>)}
        </div>
      </section>
      <div className="an-grid">
        <VisitList title="Visit length" items={LENGTHS.map((name) => ({ name, n: visits.lengths[name] ?? 0 }))} total={visits.visits} />
        <VisitList title="Landed on" items={sorted(visits.landings)} total={visits.visits} label={(s) => (s === 'room' ? 'A room link' : 'Home')} />
        <VisitList title="Screen sizes" items={sorted(visits.screenSizes)} total={visits.visits} label={(s) => SIZES[s] ?? 'Unknown'} />
        <VisitList title="Languages" items={sorted(visits.languages)} total={visits.visits} label={language} />
      </div>
    </>
  )
}

function VisitList({ title, items, total, label = (s) => s }: {
  title: string
  items: { name: string; n: number }[]
  total: number
  label?: (name: string) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.n))
  return (
    <section className="an-card">
      <h2>{title}</h2>
      {total === 0 ? (
        <p className="an-note">No data yet</p>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.name}>
              <span className="an-name">{label(i.name)}</span>
              <span>{fmt(i.n)} <small>{share(i.n, total)}</small></span>
              <span className="an-bar" style={{ width: `${(i.n / max) * 100}%` }} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Public, read-only site totals for /analytics. Runs on Vercel, where the access token stays.
 * Only fixed totals are returned: no page paths, because they could reveal room links.
 */
const API = 'https://api.vercel.com/v1/query/web-analytics/visits/'
const DAY = 86_400_000
const CACHE_MS = 5 * 60_000
const RANGES = [7, 30]

type Row = Record<string, string | number | null>
const cache = new Map<number, { at: number; body: unknown }>()

async function query(path: string, since: number, until: number, extra: Record<string, string> = {}) {
  const token = process.env.VERCEL_ANALYTICS_TOKEN
  const projectId = process.env.VERCEL_ANALYTICS_PROJECT_ID
  if (!token || !projectId) throw new Error('VERCEL_ANALYTICS_TOKEN or VERCEL_ANALYTICS_PROJECT_ID is not set')
  const params = new URLSearchParams({ projectId, since: String(since), until: String(until), ...extra })
  const teamId = process.env.VERCEL_ANALYTICS_TEAM_ID
  if (teamId) params.set('teamId', teamId)
  const res = await fetch(`${API}${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Vercel ${path} ${extra.by ?? ''} responded ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return ((await res.json()) as { data: unknown }).data
}

const counts = (row: Row) => ({ pageviews: Number(row.pageviews ?? 0), visitors: Number(row.visitors ?? 0) })

// Room links are never shown, even if one ends up in a path.
const PAGES: Record<string, string> = { '/': 'Home and rooms', '/privacy.html': 'Privacy', '/terms.html': 'Terms' }

const DIMENSIONS = {
  pages: 'requestPath',
  referrers: 'referrerHostname',
  countries: 'country',
  devices: 'deviceType',
  browsers: 'browserName',
  systems: 'osName',
  utmSources: 'utmSource',
  utmMediums: 'utmMedium',
  utmCampaigns: 'utmCampaign',
}

/** A part that may be missing (a paid feature, or not set up yet) without failing the page. */
async function optional<T>(name: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch (error) {
    console.warn(`analytics: ${name} skipped:`, error)
    return null
  }
}

async function visitStats(range: number): Promise<unknown> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set')
  const res = await fetch(`${url}/rest/v1/rpc/site_visit_stats`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_days: range }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Supabase responded ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function load(range: number) {
  const until = Date.now()
  const since = Math.floor(until / DAY) * DAY - (range - 1) * DAY
  const breakdown = async (by: string) => {
    const rows = (await query('aggregate', since, until, { by, limit: '10' })) as Row[]
    const merged = new Map<string, { pageviews: number; visitors: number }>()
    for (const row of rows) {
      let name = String(row[by] ?? '')
      if (by === 'requestPath') name = PAGES[name.split(/[?#]/)[0]] ?? 'Other pages'
      const c = counts(row)
      const sum = merged.get(name) ?? { pageviews: 0, visitors: 0 }
      merged.set(name, { pageviews: sum.pageviews + c.pageviews, visitors: sum.visitors + c.visitors })
    }
    return [...merged].map(([name, c]) => ({ name, ...c }))
  }
  const daily = (from: number, to: number) =>
    query('aggregate', from, to, { by: 'day', limit: '100' }) as Promise<Row[]>
  const sum = (rows: { pageviews: number; visitors: number }[]) =>
    rows.reduce((a, r) => ({ pageviews: a.pageviews + r.pageviews, visitors: a.visitors + r.visitors }), {
      pageviews: 0,
      visitors: 0,
    })

  const [dayRows, previousRows, visits, parts] = await Promise.all([
    daily(since, until),
    optional('previous period', daily(since - range * DAY, since - 1)),
    optional('visits', visitStats(range)),
    Promise.all(
      Object.entries(DIMENSIONS).map(async ([key, by]) => [key, await optional(by, breakdown(by))] as const),
    ),
  ])
  // Days without visits may be missing from the response; the chart needs every day.
  const byDay = new Map(dayRows.map((row) => [String(row.timestamp).slice(0, 10), counts(row)]))
  const days = Array.from({ length: range }, (_, i) => {
    const date = new Date(since + i * DAY).toISOString().slice(0, 10)
    return { date, ...(byDay.get(date) ?? { pageviews: 0, visitors: 0 }) }
  })
  const first = new Date(since).toISOString().slice(0, 10)
  const previous = previousRows?.filter((r) => String(r.timestamp).slice(0, 10) < first).map(counts)
  return {
    // Added up from the days: Vercel's own count leaves out today.
    total: sum(days),
    previous: previous ? sum(previous) : null,
    days,
    breakdowns: Object.fromEntries(parts),
    visits,
    updatedAt: new Date(until).toISOString(),
  }
}

export async function GET(request: Request) {
  const { search, searchParams } = new URL(request.url)
  const range = Number(searchParams.get('range'))
  // Exact match, so extra parameters can't be used to get around the cache.
  if (!RANGES.includes(range) || search !== `?range=${range}`) {
    return Response.json({ error: 'Use ?range=7 or ?range=30' }, { status: 400 })
  }
  try {
    let hit = cache.get(range)
    if (!hit || Date.now() - hit.at > CACHE_MS) {
      hit = { at: Date.now(), body: await load(range) }
      cache.set(range, hit)
    }
    return Response.json(hit.body, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    })
  } catch (error) {
    console.error('analytics:', error)
    return Response.json({ error: 'Analytics are unavailable right now.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

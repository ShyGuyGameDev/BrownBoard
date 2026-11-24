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

async function load(range: number) {
  const until = Date.now()
  const since = Math.floor(until / DAY) * DAY - (range - 1) * DAY
  const breakdown = async (by: string) => {
    const rows = (await query('aggregate', since, until, { by, limit: '8' })) as Row[]
    return rows.map((row) => ({ name: String(row[by] ?? ''), ...counts(row) }))
  }
  const [total, dayRows, referrers, countries, devices] = await Promise.all([
    query('count', since, until) as Promise<Row>,
    query('aggregate', since, until, { by: 'day', limit: '100' }) as Promise<Row[]>,
    breakdown('referrerHostname'),
    breakdown('country'),
    breakdown('deviceType'),
  ])
  // Days without visits may be missing from the response; the chart needs every day.
  const byDay = new Map(dayRows.map((row) => [String(row.timestamp).slice(0, 10), counts(row)]))
  const days = Array.from({ length: range }, (_, i) => {
    const date = new Date(since + i * DAY).toISOString().slice(0, 10)
    return { date, ...(byDay.get(date) ?? { pageviews: 0, visitors: 0 }) }
  })
  return { total: counts(total), days, referrers, countries, devices, updatedAt: new Date(until).toISOString() }
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

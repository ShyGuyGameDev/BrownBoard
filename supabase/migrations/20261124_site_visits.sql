-- =====================================================================
-- Anonymous visit stats for /analytics: bounce rate, visit length, busiest hours, people on now.
--
-- One row per page load. No account, IP address, room or card is recorded, and the visit id is
-- random and forgotten when the tab closes. Rows are deleted after 90 days.
--
-- Clients can't touch the table. track_visit() adds to it and site_visit_stats() returns totals.
--
-- Safe to re-run.
-- =====================================================================

create table if not exists private.site_visits (
  id uuid primary key,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seconds int not null default 0,
  screens int not null default 1,
  landed_on text not null,
  screen_size text not null,
  language text not null
);
create index if not exists site_visits_started_at on private.site_visits (started_at);
alter table private.site_visits enable row level security;
revoke all on private.site_visits from public, anon, authenticated;

create or replace function public.track_visit(
  p_id uuid, p_seconds int, p_screens int, p_landed_on text, p_screen_size text, p_language text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null then return; end if;
  if random() < 0.01 then
    delete from private.site_visits where started_at < now() - interval '90 days';
  end if;
  insert into private.site_visits as v (id, seconds, screens, landed_on, screen_size, language)
  values (
    p_id,
    0,
    least(greatest(coalesce(p_screens, 1), 1), 1000),
    case when p_landed_on = 'room' then 'room' else 'home' end,
    case when p_screen_size in ('phone', 'tablet', 'laptop', 'large') then p_screen_size else 'unknown' end,
    case when p_language ~ '^[a-z]{2,3}$' then p_language else 'unknown' end
  )
  on conflict (id) do update set
    last_seen_at = now(),
    -- Never longer than the visit has existed, whatever the client says.
    seconds = greatest(v.seconds, least(
      coalesce(p_seconds, 0), 86400, extract(epoch from now() - v.started_at)::int + 5)),
    screens = greatest(v.screens, excluded.screens)
  where v.started_at > now() - interval '1 day';
end;
$$;
revoke execute on function public.track_visit(uuid, int, int, text, text, text) from public;
grant execute on function public.track_visit(uuid, int, int, text, text, text) to anon, authenticated;

/** Totals since midnight UTC, p_days days ago. A bounce saw one screen for under 10 seconds. */
create or replace function public.site_visit_stats(p_days int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select * from private.site_visits
    where started_at >= ((date_trunc('day', now() at time zone 'utc')
      - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30) - 1)) at time zone 'utc')
  )
  select jsonb_build_object(
    'visits', (select count(*) from v),
    'bounces', (select count(*) from v where screens = 1 and seconds < 10),
    'avgSeconds', (select coalesce(round(avg(seconds)), 0) from v),
    'medianSeconds', (select coalesce(round(percentile_cont(0.5) within group (order by seconds)), 0) from v),
    'screensPerVisit', (select coalesce(round(avg(screens), 1), 0) from v),
    'activeNow', (select count(*) from private.site_visits where last_seen_at > now() - interval '75 seconds'),
    'hours', (
      select jsonb_agg(coalesce(c.n, 0) order by h)
      from generate_series(0, 23) h
      left join (
        select extract(hour from started_at at time zone 'utc')::int as hour, count(*) as n from v group by 1
      ) c on c.hour = h
    ),
    'lengths', (
      select coalesce(jsonb_object_agg(k, n), '{}') from (
        select case when seconds < 10 then 'Under 10 seconds' when seconds < 60 then '10 to 59 seconds'
          when seconds < 300 then '1 to 5 minutes' when seconds < 1800 then '5 to 30 minutes'
          else 'Over 30 minutes' end as k, count(*) as n from v group by 1) s
    ),
    'landings', (select coalesce(jsonb_object_agg(k, n), '{}') from (select landed_on k, count(*) n from v group by 1) s),
    'screenSizes', (select coalesce(jsonb_object_agg(k, n), '{}') from (select screen_size k, count(*) n from v group by 1) s),
    'languages', (
      select coalesce(jsonb_object_agg(k, n), '{}')
      from (select language k, count(*) n from v group by 1 order by n desc limit 10) s
    )
  );
$$;
revoke execute on function public.site_visit_stats(int) from public;
grant execute on function public.site_visit_stats(int) to anon, authenticated;

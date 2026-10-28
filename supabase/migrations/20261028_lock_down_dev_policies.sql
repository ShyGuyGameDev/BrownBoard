-- =====================================================================
-- Remove leftover dev-era policies that bypass room membership.
--
-- The live project still had policies created by hand in the dashboard before rooms existed:
-- "devboard open access" (USING true / WITH CHECK true, for anon and authenticated) and
-- "Authenticated users can read ..." (any signed-in user reads every row). Postgres ORs
-- permissive policies together, so these let anyone read and rewrite every room's board,
-- whatever "members manage ..." says. Drop them so only the membership policies remain.
--
-- Also locks down public.rls_auto_enable(), a dashboard-created event trigger helper that was
-- left callable over /rest/v1/rpc. Event triggers don't need EXECUTE grants to fire.
--
-- Run after 20261027_untitled_rooms.sql. Safe to re-run.
-- =====================================================================

drop policy if exists "devboard open access" on public.categories;
drop policy if exists "devboard open access" on public.tasks;
drop policy if exists "devboard open access" on public.task_options;
drop policy if exists "devboard open access" on public.strokes;

drop policy if exists "Authenticated users can read categories" on public.categories;
drop policy if exists "Authenticated users can read tasks" on public.tasks;
drop policy if exists "Authenticated users can read task options" on public.task_options;
drop policy if exists "Authenticated users can read strokes" on public.strokes;

-- Signed-out visitors get nothing from board tables (repeated from 20261025_rooms_auth.sql in
-- case the dashboard re-granted it).
revoke all on public.categories, public.tasks, public.task_options, public.strokes from anon;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Anything else on these tables that isn't from our migrations should show up here. Expect only
-- the "members manage ..." policies.
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('categories', 'tasks', 'task_options', 'strokes')
order by tablename, policyname;

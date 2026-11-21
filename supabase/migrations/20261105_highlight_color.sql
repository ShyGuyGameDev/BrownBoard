-- =====================================================================
-- Highlight colour: what others see around whatever you're editing in a room.
--
-- highlight_color is a #rrggbb colour, or null for the default colour picked from your account id.
-- With highlight_sync on, the app keeps it matched to your profile picture (a sync with no picture
-- stores null, the default being the colour of your initials circle).
--
-- Run after 20261027_profile_pictures.sql. Safe to re-run.
-- =====================================================================

alter table public.profiles add column if not exists highlight_color text;
alter table public.profiles add column if not exists highlight_sync boolean not null default false;

alter table public.profiles drop constraint if exists profiles_highlight_color_check;
alter table public.profiles add constraint profiles_highlight_color_check
  check (highlight_color is null or highlight_color ~ '^#[0-9a-f]{6}$');

/** Sets your highlight colour (null for the default) and whether it follows your picture. */
create or replace function public.update_profile_highlight(p_color text, p_sync boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_color text := lower(p_color);
begin
  if v_user is null or private.is_guest(v_user) then
    raise exception 'Sign in to set a highlight color.' using errcode = '42501';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'That color can''t be used.' using errcode = '22023';
  end if;
  update public.profiles
  set highlight_color = v_color, highlight_sync = coalesce(p_sync, false)
  where id = v_user;
end;
$$;

revoke all on function public.update_profile_highlight(text, boolean) from public, anon, authenticated;
grant execute on function public.update_profile_highlight(text, boolean) to authenticated;

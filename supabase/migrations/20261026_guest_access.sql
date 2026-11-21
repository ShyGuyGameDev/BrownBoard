-- =====================================================================
-- Guest access per room (on by default). The owner can turn it off in room settings.
--
-- Off means: guests (anonymous sessions) can't join with the password, and any guests already
-- in the room are removed, so the room's data is closed to them by the existing RLS policies.
-- Turning it back on doesn't bring them back; they join again with the password.
--
-- Run after 20261026_room_cards.sql. Safe to re-run.
-- =====================================================================

alter table public.rooms add column if not exists allow_guests boolean not null default true;
grant select (allow_guests) on public.rooms to authenticated;

-- Older two-argument version, if an earlier run left it behind (it makes calls ambiguous).
drop function if exists public.join_room(text, text);

-- join_room: same as before, plus the guest check (after the password, so only people who know
-- it learn the room is accounts-only).
create or replace function public.join_room(p_name text, p_password text, p_room_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lookup text;
  r record;
  dn text;
  guest boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  if (select count(*) from private.room_join_attempts
      where user_id = uid and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  lookup := lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));

  if not exists (
    select 1 from public.rooms where (p_room_id is null and name_key = lookup) or id = p_room_id
  ) then
    insert into private.room_join_attempts (user_id) values (uid);
    if exists (
      select 1 from private.deleted_rooms where (p_room_id is null and name_key = lookup) or id = p_room_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'deleted');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Several rooms may share this name; the password picks which one.
  select id, name, allow_guests into r
  from public.rooms
  where ((p_room_id is null and name_key = lookup) or id = p_room_id)
    and password_hash is not null
    and password_hash = extensions.crypt(coalesce(p_password, ''), password_hash)
  order by created_at
  limit 1;

  if not found then
    insert into private.room_join_attempts (user_id) values (uid);
    return jsonb_build_object('ok', false, 'error', 'wrong_password');
  end if;

  guest := private.is_guest(uid);
  if guest and not r.allow_guests then
    return jsonb_build_object('ok', false, 'error', 'guests_disabled');
  end if;

  dn := private.display_name_for(uid, r.id);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (r.id, uid, dn, guest)
  on conflict (room_id, user_id) do update
    set last_active_at = now(), display_name = excluded.display_name;

  return jsonb_build_object('ok', true, 'room_id', r.id, 'room_name', r.name, 'display_name', dn,
    'is_owner', private.is_room_owner(r.id), 'allow_guests', r.allow_guests);
end;
$$;

create or replace function public.enter_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  dn text;
  r record;
begin
  if uid is null or not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  select name, allow_guests into r from public.rooms where id = p_room_id;
  if not r.allow_guests and private.is_guest(uid) then
    delete from public.room_members where room_id = p_room_id and user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'guests_disabled');
  end if;
  dn := private.display_name_for(uid, p_room_id);
  update public.room_members set last_active_at = now(), display_name = dn
  where room_id = p_room_id and user_id = uid;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', r.name, 'display_name', dn,
    'is_owner', private.is_room_owner(p_room_id), 'allow_guests', r.allow_guests);
end;
$$;

/** Owner only. Turning guests off also removes the guests already in the room. */
create or replace function public.set_room_guest_access(p_room_id text, p_allow boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int := 0;
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  update public.rooms set allow_guests = coalesce(p_allow, true) where id = p_room_id;
  if not coalesce(p_allow, true) then
    delete from public.room_members where room_id = p_room_id and is_guest;
    get diagnostics removed = row_count;
  end if;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'allow_guests', coalesce(p_allow, true),
    'removed', removed);
end;
$$;

revoke execute on function public.set_room_guest_access(text, boolean) from public, anon;
grant execute on function public.set_room_guest_access(text, boolean) to authenticated;

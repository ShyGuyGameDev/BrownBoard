-- =====================================================================
-- Quick rooms: start a room with no name or password, name it later.
--
-- An unnamed room has no password, so nobody else can join it, and it isn't kept: the app
-- discards it when its creator leaves, and any left behind (closed tab, crash) are removed the
-- next time that person starts one, or after a day. Saving it (name + password together, from
-- the room's settings or before sharing) turns it into an ordinary room.
--
-- Run after 20261026_guest_access.sql. Safe to re-run.
-- =====================================================================

alter table public.rooms add column if not exists unnamed boolean not null default false;
grant select (unnamed) on public.rooms to authenticated;

/** Removes unnamed rooms: the caller's, and anyone's older than a day. */
create or replace function private.prune_unnamed_rooms(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rooms
  where unnamed and (created_by = p_user or created_at < now() - interval '1 day');
$$;

create or replace function public.create_quick_room()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid text;
  dn text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if (select count(*) from public.rooms where created_by = uid and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  perform private.prune_unnamed_rooms(uid);

  -- No password_hash, so join_room can never match it.
  insert into public.rooms (name, created_by, unnamed) values ('Untitled room', uid, true)
  returning id into rid;

  dn := private.display_name_for(uid, rid);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (rid, uid, dn, private.is_guest(uid));

  return jsonb_build_object('ok', true, 'room_id', rid, 'room_name', 'Untitled room',
    'display_name', dn, 'is_owner', private.is_room_owner(rid), 'allow_guests', true,
    'unnamed', true);
end;
$$;

/**
 * Names an unnamed room and sets its password, so it's kept and people can join it.
 * The creator can do this even as a guest (they're the only member).
 */
create or replace function public.save_room(p_room_id text, p_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if uid is null or not exists (
    select 1 from public.rooms where id = p_room_id and created_by = uid and unnamed
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if char_length(clean) not between 2 and 48 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if char_length(coalesce(p_password, '')) not between 4 and 72 then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  if exists (
    select 1 from public.rooms
    where id <> p_room_id and name_key = lower(clean)
      and password_hash = extensions.crypt(p_password, password_hash)
  ) then
    return jsonb_build_object('ok', false, 'error', 'same_password');
  end if;

  update public.rooms set name = clean, unnamed = false, last_edited_at = now()
  where id = p_room_id;
  perform private.store_room_password(p_room_id, p_password);
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

/** Throws away an unnamed room. Not recorded in deleted_rooms: nobody else ever had it. */
create or replace function public.discard_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rooms where id = p_room_id and created_by = auth.uid() and unnamed;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

-- enter_room: same as 20261026_guest_access.sql, plus `unnamed`.
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
  select name, allow_guests, unnamed into r from public.rooms where id = p_room_id;
  if not r.allow_guests and private.is_guest(uid) then
    delete from public.room_members where room_id = p_room_id and user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'guests_disabled');
  end if;
  dn := private.display_name_for(uid, p_room_id);
  update public.room_members set last_active_at = now(), display_name = dn
  where room_id = p_room_id and user_id = uid;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', r.name, 'display_name', dn,
    'is_owner', private.is_room_owner(p_room_id), 'allow_guests', r.allow_guests,
    'unnamed', r.unnamed);
end;
$$;

-- rename_room: unnamed rooms are named through save_room, and their placeholder name never
-- counts as taken.
create or replace function public.rename_room(p_room_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if not private.is_room_owner(p_room_id)
    or exists (select 1 from public.rooms where id = p_room_id and unnamed) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if char_length(clean) not between 2 and 48 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if exists (
    select 1 from public.rooms where name_key = lower(clean) and id <> p_room_id and not unnamed
  ) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  update public.rooms set name = clean, last_edited_at = now() where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

-- change_room_password: likewise, a password only comes with a name (save_room).
create or replace function public.change_room_password(p_room_id text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id)
    or exists (select 1 from public.rooms where id = p_room_id and unnamed) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if char_length(coalesce(p_password, '')) not between 4 and 72 then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  if exists (
    select 1 from public.rooms o
    where o.id <> p_room_id
      and o.name_key = (select name_key from public.rooms where id = p_room_id)
      and o.password_hash = extensions.crypt(p_password, o.password_hash)
  ) then
    return jsonb_build_object('ok', false, 'error', 'same_password');
  end if;
  perform private.store_room_password(p_room_id, p_password);
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------

revoke execute on function private.prune_unnamed_rooms(uuid) from public, anon, authenticated;

revoke execute on function public.create_quick_room() from public, anon;
grant execute on function public.create_quick_room() to authenticated;
revoke execute on function public.save_room(text, text, text) from public, anon;
grant execute on function public.save_room(text, text, text) to authenticated;
revoke execute on function public.discard_room(text) from public, anon;
grant execute on function public.discard_room(text) to authenticated;

-- =====================================================================
-- Room names are unique per owner, not per name + password.
--
-- Each owner (rooms.created_by) can have one room with a given name; different owners can reuse
-- names, with any password. Unnamed rooms all share a placeholder name, so they're left out.
-- Passwords no longer have to differ between same-named rooms. Joining by name + password then
-- picks the oldest match, as before; invite links always point at one exact room.
--
-- Run after 20261026_quick_rooms.sql. Safe to re-run. If an owner already has two rooms with the
-- same name, the index below fails: rename one of them, then run this again.
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_name_key_unique;
drop index if exists public.rooms_name_key_unique;

create unique index if not exists rooms_owner_name_unique
  on public.rooms (created_by, name_key) where not unnamed;

/** Whether `p_owner` already has a named room called `p_name_key`, other than `p_except`. */
create or replace function private.owner_has_room_named(
  p_owner uuid, p_name_key text, p_except text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms
    where created_by = p_owner and name_key = p_name_key and not unnamed
      and id is distinct from p_except
  );
$$;

-- create_room: same as 20261026_room_cards.sql, with the owner + name check.
create or replace function public.create_room(p_name text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  rid text;
  dn text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if char_length(clean) not between 2 and 48 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if char_length(coalesce(p_password, '')) not between 4 and 72 then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;
  if (select count(*) from public.rooms where created_by = uid and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if private.owner_has_room_named(uid, lower(clean)) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  insert into public.rooms (name, created_by) values (clean, uid) returning id into rid;
  perform private.store_room_password(rid, p_password);

  dn := private.display_name_for(uid, rid);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (rid, uid, dn, private.is_guest(uid));

  return jsonb_build_object('ok', true, 'room_id', rid, 'room_name', clean, 'display_name', dn,
    'is_owner', private.is_room_owner(rid));
end;
$$;

-- save_room: same as 20261026_quick_rooms.sql, with the owner + name check.
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
  if private.owner_has_room_named(uid, lower(clean), p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  update public.rooms set name = clean, unnamed = false, last_edited_at = now()
  where id = p_room_id;
  perform private.store_room_password(p_room_id, p_password);
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

-- rename_room: same as 20261026_quick_rooms.sql, checking only the owner's own rooms.
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
  if private.owner_has_room_named(auth.uid(), lower(clean), p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  update public.rooms set name = clean, last_edited_at = now() where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

-- change_room_password: same as 20261026_quick_rooms.sql, without the same-password check.
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
  perform private.store_room_password(p_room_id, p_password);
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

revoke execute on function private.owner_has_room_named(uuid, text, text) from public, anon, authenticated;

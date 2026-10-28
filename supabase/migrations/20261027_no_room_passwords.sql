-- =====================================================================
-- Rooms have no passwords. A room's share link (its id) is all you need to join it.
--
-- Room ids are unguessable, so the link is the secret. Unnamed rooms can't be joined at all:
-- naming one (save_room, name only) is what opens it to anyone with the link.
-- Guest access still applies: with it off, only signed-in accounts can join.
--
-- The old password columns (rooms.password_hash, rooms.password_secret_id and the Vault
-- secrets) are no longer read; they're left in place and removed with the room on delete.
--
-- Run after 20261026_link_only_join.sql. Safe to re-run.
-- =====================================================================

drop function if exists public.join_room(text, text, text);
drop function if exists public.create_room(text, text);
drop function if exists public.save_room(text, text, text);
drop function if exists public.change_room_password(text, text);
drop function if exists public.room_password(text);

/** Join the room a share link points to. */
create or replace function public.join_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r record;
  dn text;
  guest boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  -- Limits guessing room ids.
  if (select count(*) from private.room_join_attempts
      where user_id = uid and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select id, name, allow_guests into r from public.rooms where id = p_room_id and not unnamed;
  if not found then
    insert into private.room_join_attempts (user_id) values (uid);
    if exists (select 1 from private.deleted_rooms where id = p_room_id) then
      return jsonb_build_object('ok', false, 'error', 'deleted');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
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
    'is_owner', private.is_room_owner(r.id), 'allow_guests', r.allow_guests, 'unnamed', false);
end;
$$;

/**
 * Names an unnamed room, so it's kept and anyone with its link can join.
 * The creator can do this even as a guest (they're the only member).
 */
create or replace function public.save_room(p_room_id text, p_name text)
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
  if private.owner_has_room_named(uid, lower(clean), p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  update public.rooms set name = clean, unnamed = false, last_edited_at = now()
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

-- room_invite_info: same as 20261025_rooms_auth.sql, but an unnamed room looks like no room.
create or replace function public.room_invite_info(p_room_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('name', name, 'deleted', false) from public.rooms
     where id = p_room_id and not unnamed),
    (select jsonb_build_object('name', null, 'deleted', true) from private.deleted_rooms where id = p_room_id)
  );
$$;

revoke execute on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
revoke execute on function public.save_room(text, text) from public, anon;
grant execute on function public.save_room(text, text) to authenticated;

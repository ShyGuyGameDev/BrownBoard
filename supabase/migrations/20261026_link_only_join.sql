-- =====================================================================
-- Joining only through a share link: join_room needs the room id from the link.
--
-- The name is no longer used to find a room (several rooms can share one), only the id. The
-- signature stays the same so existing grants and clients keep working.
--
-- Run after 20261026_owner_room_names.sql. Safe to re-run.
-- =====================================================================

-- join_room: same as 20261026_guest_access.sql, but looks the room up by id only.
create or replace function public.join_room(p_name text, p_password text, p_room_id text default null)
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

  if (select count(*) from private.room_join_attempts
      where user_id = uid and at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if p_room_id is null or not exists (select 1 from public.rooms where id = p_room_id) then
    insert into private.room_join_attempts (user_id) values (uid);
    if exists (select 1 from private.deleted_rooms where id = p_room_id) then
      return jsonb_build_object('ok', false, 'error', 'deleted');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select id, name, allow_guests into r
  from public.rooms
  where id = p_room_id
    and password_hash is not null
    and password_hash = extensions.crypt(coalesce(p_password, ''), password_hash);

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

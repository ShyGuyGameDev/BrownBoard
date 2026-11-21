-- =====================================================================
-- Untitled rooms are kept for accounts.
--
-- An account's untitled room is an ordinary room it can leave and come back to, listed as
-- "Untitled room 1", "Untitled room 2", … (the lowest number free among that account's untitled
-- rooms when it's made; it keeps its number). It still can't be joined until it's named.
-- A guest's untitled room is still temporary: removed when they start another, or after a day.
--
-- Run after 20261027_room_claims.sql. Safe to re-run.
-- =====================================================================

/** "Untitled room <n>", with the lowest n not used by `p_owner`'s other untitled rooms. */
create or replace function private.next_untitled_name(p_owner uuid, p_except text default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'Untitled room ' || n
  from generate_series(1, 10000) n
  where not exists (
    select 1 from public.rooms
    where created_by = p_owner and unnamed and id is distinct from p_except
      and name_key = 'untitled room ' || n
  )
  order by n
  limit 1;
$$;

-- Number the untitled rooms that already exist (oldest first, per owner).
update public.rooms r
set name = 'Untitled room ' || x.n
from (
  select id, row_number() over (partition by created_by order by created_at) as n
  from public.rooms where unnamed
) x
where r.id = x.id and r.name <> 'Untitled room ' || x.n;

/** Removes guests' untitled rooms: the caller's, and any older than a day. */
create or replace function private.prune_unnamed_rooms(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rooms
  where unnamed and private.is_guest(created_by)
    and (created_by = p_user or created_at < now() - interval '1 day');
$$;

-- create_quick_room: same as 20261026_quick_rooms.sql, with a numbered name.
create or replace function public.create_quick_room()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid text;
  rname text;
  dn text;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if (select count(*) from public.rooms where created_by = uid and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  perform private.prune_unnamed_rooms(uid);

  rname := private.next_untitled_name(uid);
  insert into public.rooms (name, created_by, unnamed) values (rname, uid, true)
  returning id into rid;

  dn := private.display_name_for(uid, rid);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (rid, uid, dn, private.is_guest(uid));

  return jsonb_build_object('ok', true, 'room_id', rid, 'room_name', rname,
    'display_name', dn, 'is_owner', private.is_room_owner(rid), 'allow_guests', true,
    'unnamed', true, 'is_creator', true, 'has_owner', not private.is_guest(uid));
end;
$$;

-- claim_room: same as 20261027_room_claims.sql, but an untitled room gets the next free number
-- on the account it moves to.
create or replace function public.claim_room(p_room_id text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c record;
  r record;
  base text;
  candidate text;
  n int := 1;
begin
  if uid is null or private.is_guest(uid) then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  select * into c from private.room_claims
  where room_id = p_room_id and token = p_token and created_at > now() - interval '1 day';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  select name, unnamed, created_by into r from public.rooms where id = p_room_id;
  if r.created_by is distinct from c.guest_id then
    delete from private.room_claims where room_id = p_room_id;
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if r.unnamed then
    candidate := private.next_untitled_name(uid, p_room_id);
  else
    candidate := r.name;
    base := left(r.name, 45);
    while private.owner_has_room_named(uid, lower(candidate), p_room_id) loop
      n := n + 1;
      candidate := base || ' ' || n;
    end loop;
  end if;

  update public.rooms set created_by = uid, name = candidate where id = p_room_id;
  delete from public.room_members where room_id = p_room_id and user_id = c.guest_id;
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (p_room_id, uid, private.display_name_for(uid, p_room_id), false)
  on conflict (room_id, user_id) do update set last_active_at = now();
  delete from private.room_claims where room_id = p_room_id;

  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', candidate);
end;
$$;

revoke execute on function private.next_untitled_name(uuid, text) from public, anon, authenticated;

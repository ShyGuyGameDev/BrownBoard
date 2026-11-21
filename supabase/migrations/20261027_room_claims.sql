-- =====================================================================
-- Rooms are owned by accounts. A guest who starts a room signs in to keep or share it, and the
-- room moves to their account.
--
-- Signing in replaces the guest (anonymous) session with a different user, so the guest first
-- asks for a one-time claim code (start_room_claim), and the account it signs in to redeems it
-- (claim_room). Codes only work for the guest who made the room, and expire after a day.
--
-- Rooms made by guests before this have no owner. Their creator can claim them the same way.
--
-- Run after 20261027_no_room_passwords.sql. Safe to re-run.
-- =====================================================================

create table if not exists private.room_claims (
  room_id text primary key references public.rooms (id) on delete cascade,
  token text not null,
  guest_id uuid not null,
  created_at timestamptz not null default now()
);
revoke all on private.room_claims from public, anon, authenticated;

/** Called by the guest who made the room, right before signing in. Returns { token }. */
create or replace function public.start_room_claim(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if uid is null or not private.is_guest(uid) or not exists (
    select 1 from public.rooms where id = p_room_id and created_by = uid
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  -- Reuse a fresh code, so two quick requests (a double click) don't leave the first one stale.
  insert into private.room_claims (room_id, token, guest_id) values (p_room_id, t, uid)
  on conflict (room_id) do update set token = excluded.token, guest_id = excluded.guest_id,
    created_at = now()
  where private.room_claims.guest_id <> excluded.guest_id
    or private.room_claims.created_at < now() - interval '1 hour';
  select token into t from private.room_claims where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'token', t);
end;
$$;

/**
 * Called by the account the guest signed in to: the room becomes theirs, and they take the
 * guest's place in it. If they already own a room with this name, a number is added.
 */
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

  candidate := r.name;
  if not r.unnamed then
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

-- save_room: same as 20261027_no_room_passwords.sql, but only for accounts.
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
  if uid is null or private.is_guest(uid) then
    return jsonb_build_object('ok', false, 'error', 'needs_account');
  end if;
  if not exists (
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

-- enter_room: same as 20261026_quick_rooms.sql, plus `is_creator` (you made it, even as a guest)
-- and `has_owner` (it belongs to an account).
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
  select name, allow_guests, unnamed, created_by into r from public.rooms where id = p_room_id;
  if not r.allow_guests and private.is_guest(uid) then
    delete from public.room_members where room_id = p_room_id and user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'guests_disabled');
  end if;
  dn := private.display_name_for(uid, p_room_id);
  update public.room_members set last_active_at = now(), display_name = dn
  where room_id = p_room_id and user_id = uid;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', r.name, 'display_name', dn,
    'is_owner', private.is_room_owner(p_room_id), 'allow_guests', r.allow_guests,
    'unnamed', r.unnamed, 'is_creator', r.created_by = uid,
    'has_owner', not private.is_guest(r.created_by));
end;
$$;

-- join_room: same as 20261027_no_room_passwords.sql, plus `is_creator` and `has_owner`.
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

  select id, name, allow_guests, created_by into r
  from public.rooms where id = p_room_id and not unnamed;
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
    'is_owner', private.is_room_owner(r.id), 'allow_guests', r.allow_guests, 'unnamed', false,
    'is_creator', r.created_by = uid, 'has_owner', not private.is_guest(r.created_by));
end;
$$;

revoke execute on function public.start_room_claim(text) from public, anon;
grant execute on function public.start_room_claim(text) to authenticated;
revoke execute on function public.claim_room(text, text) from public, anon;
grant execute on function public.claim_room(text, text) to authenticated;

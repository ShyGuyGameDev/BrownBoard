-- =====================================================================
-- Room cards: "last edited" tracking + showing the room password to members.
--
-- Run after 20261025_rooms_auth.sql and 20261026_grants_fix.sql. Safe to re-run.
--
-- Passwords: rooms keep their bcrypt hash for checking joins. To be able to SHOW the password,
-- an encrypted copy is kept in Supabase Vault (encrypted at rest; the key isn't stored in the
-- database). Only members of a room can read it, through room_password().
-- Rooms created before this migration have no stored copy until the owner sets a new password.
-- =====================================================================

create extension if not exists supabase_vault with schema vault;

alter table public.rooms add column if not exists last_edited_at timestamptz not null default now();
-- Vault secret holding the readable password. Not granted to any client role.
alter table public.rooms add column if not exists password_secret_id uuid;

-- Backfill: the newest content in each room (rows only carry created_at, so this is a best guess).
update public.rooms r
set last_edited_at = greatest(r.created_at, coalesce(c.latest, r.created_at))
from (
  select room_id, max(created_at) as latest from (
    select room_id, created_at from public.categories
    union all select room_id, created_at from public.tasks
    union all select room_id, created_at from public.strokes
  ) x group by room_id
) c
where c.room_id = r.id;

grant select (last_edited_at) on public.rooms to authenticated;

-- ---------------------------------------------------------------------
-- Last edited: any change to the board or canvas bumps the room.
-- Throttled to once a minute so drawing (many stroke inserts) doesn't hammer the rooms row.
-- ---------------------------------------------------------------------

create or replace function private.touch_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid text := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
begin
  update public.rooms
  set last_edited_at = now()
  where id = rid and last_edited_at < now() - interval '1 minute';
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['categories', 'tasks', 'task_options', 'strokes'] loop
    execute format('drop trigger if exists touch_room on public.%I', t);
    execute format(
      'create trigger touch_room after insert or update or delete on public.%I
       for each row execute function private.touch_room()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Password storage
-- ---------------------------------------------------------------------

/** Sets the join hash and the readable (encrypted) copy together. */
create or replace function private.store_room_password(p_room_id text, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  select password_secret_id into sid from public.rooms where id = p_room_id;
  if sid is null then
    sid := vault.create_secret(p_password, 'room_password:' || p_room_id, 'Join password for room ' || p_room_id);
  else
    perform vault.update_secret(sid, p_password);
  end if;
  update public.rooms
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      password_secret_id = sid
  where id = p_room_id;
end;
$$;

/** For members only: { ok, password } (password is null for rooms made before this migration). */
create or replace function public.room_password(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pw text;
begin
  if not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  select s.decrypted_secret into pw
  from public.rooms r
  join vault.decrypted_secrets s on s.id = r.password_secret_id
  where r.id = p_room_id;
  return jsonb_build_object('ok', true, 'password', pw);
end;
$$;

-- create_room: same as before, but stores the password through store_room_password.
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
  -- Same name + same password would make the two rooms indistinguishable when joining.
  if exists (
    select 1 from public.rooms
    where name_key = lower(clean) and password_hash = extensions.crypt(p_password, password_hash)
  ) then
    return jsonb_build_object('ok', false, 'error', 'same_password');
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

create or replace function public.change_room_password(p_room_id text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id) then
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

create or replace function public.delete_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  insert into private.deleted_rooms (id, name_key)
  select id, name_key from public.rooms where id = p_room_id
  on conflict (id) do nothing;
  select password_secret_id into sid from public.rooms where id = p_room_id;
  delete from public.rooms where id = p_room_id;
  if sid is not null then
    delete from vault.secrets where id = sid;
  end if;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

-- Renaming counts as an edit.
create or replace function public.rename_room(p_room_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if char_length(clean) not between 2 and 48 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if exists (select 1 from public.rooms where name_key = lower(clean) and id <> p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  update public.rooms set name = clean, last_edited_at = now() where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------

revoke execute on function private.touch_room() from public, anon, authenticated;
revoke execute on function private.store_room_password(text, text) from public, anon, authenticated;

revoke execute on function public.room_password(text) from public, anon;
grant execute on function public.room_password(text) to authenticated;

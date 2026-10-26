-- =====================================================================
-- Rooms, accounts and row-level security
--
-- Run this once in the Supabase SQL editor (or `supabase db push`).
-- It is written to be safe to re-run.
--
-- Dashboard settings this relies on (Authentication → Sign In / Providers):
--   • Anonymous sign-ins: ON            (guests joining a room get an anonymous session)
--   • Email provider → Confirm email: OFF (username accounts use a placeholder email)
--   • Email provider → Secure email change: OFF (the old placeholder address can't confirm)
--   • Google provider: ON, with your OAuth client id/secret
--   • URL configuration → add your site URL(s) to Redirect URLs
-- And Realtime → Settings → "Allow public access": OFF (so the channel policies below apply).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Helpers and internal tables live here. It is not exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Profiles (one per permanent account; anonymous guests don't get one)
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  signup_method text not null check (signup_method in ('username', 'oauth')),
  -- The synthetic email a username account was created with. When auth.users.email no longer
  -- matches it, the user has attached a real email and signs in with that instead.
  placeholder_email text,
  created_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  tries int := 0;
  method text;
begin
  if new.is_anonymous then
    return new;
  end if;

  if new.raw_user_meta_data ? 'username' then
    method := 'username';
    candidate := lower(btrim(new.raw_user_meta_data ->> 'username'));
    if candidate !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'Usernames are 3–24 characters: letters, numbers and underscores.' using errcode = '22023';
    end if;
  else
    -- OAuth (Google): derive a username from their profile and make it unique.
    method := 'oauth';
    base := lower(regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'preferred_username', new.raw_user_meta_data ->> 'name',
               split_part(new.email, '@', 1), 'user'),
      '[^a-zA-Z0-9_]', '', 'g'));
    base := left(base, 19);
    if length(base) < 3 then base := base || 'user'; end if;
    candidate := base;
    while exists (select 1 from public.profiles where username = candidate) and tries < 50 loop
      tries := tries + 1;
      candidate := base || (floor(random() * 9000) + 1000)::int;
    end loop;
  end if;

  insert into public.profiles (id, username, signup_method, placeholder_email)
  values (new.id, candidate, method, case when method = 'username' then new.email end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Rooms and membership
-- ---------------------------------------------------------------------

create table if not exists public.rooms (
  id text primary key default encode(extensions.gen_random_bytes(8), 'hex'),
  name text not null check (char_length(btrim(name)) between 1 and 64),
  name_key text generated always as (lower(btrim(name))) stored,
  -- bcrypt hash. NULL = nobody can join with a password (used for rooms imported below).
  password_hash text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Names can repeat. A room is found by name + password together, and no two rooms with the
-- same name may share a password (enforced in create_room / change_room_password).
create index if not exists rooms_name_key_idx on public.rooms (name_key);

create table if not exists public.room_members (
  room_id text not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  is_guest boolean not null default false,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_recent on public.room_members (user_id, last_active_at desc);

-- Failed join attempts, for rate limiting password guessing.
create table if not exists private.room_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists room_join_attempts_user_at on private.room_join_attempts (user_id, at desc);

-- Rooms that were deleted, so people who try to join one later are told why it's gone.
create table if not exists private.deleted_rooms (
  id text primary key,
  name_key text not null,
  deleted_at timestamptz not null default now()
);
create index if not exists deleted_rooms_name_key on private.deleted_rooms (name_key);

-- Bring every room id already used by existing rows into `rooms`, so nothing is orphaned.
-- These rooms are locked (no password) until you set one, e.g.:
--   update public.rooms set name = 'Team board',
--     password_hash = extensions.crypt('your-password', extensions.gen_salt('bf', 10))
--   where id = 'room_1';
insert into public.rooms (id, name)
select r.room_id, left(r.room_id, 64)
from (
  select room_id from public.categories
  union select room_id from public.tasks
  union select room_id from public.task_options
  union select room_id from public.strokes
) r
where r.room_id is not null
on conflict do nothing;

-- Content tables: every row must belong to a real room. No more implicit 'room_1'.
alter table public.categories alter column room_id drop default;
alter table public.tasks alter column room_id drop default;
alter table public.task_options alter column room_id drop default;

do $$
declare t text;
begin
  foreach t in array array['categories', 'tasks', 'task_options', 'strokes'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_room_id_fkey') then
      execute format(
        'alter table public.%I add constraint %I foreign key (room_id) references public.rooms (id) on delete cascade',
        t, t || '_room_id_fkey');
    end if;
    execute format('create index if not exists %I on public.%I (room_id)', t || '_room_id_idx', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------

create or replace function private.is_room_member(p_room_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_guest(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_anonymous from auth.users where id = p_user), true);
$$;

/**
 * The room's owner: the signed-in account that created it. Rooms created by a guest have no
 * owner, so nobody can rename, re-password, delete or clear them.
 */
create or replace function private.is_room_owner(p_room_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.created_by = (select auth.uid())
  ) and not private.is_guest((select auth.uid()));
$$;

/** Username for accounts; for guests, their existing animal in this room or a fresh one. */
create or replace function private.display_name_for(p_user uuid, p_room text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  animals text[] := array[
    'Cat', 'Dog', 'Fox', 'Owl', 'Panda', 'Koala', 'Otter', 'Penguin', 'Tiger', 'Rabbit',
    'Bear', 'Wolf', 'Hedgehog', 'Raccoon', 'Deer', 'Frog', 'Dolphin', 'Turtle', 'Llama', 'Sloth',
    'Moose', 'Badger', 'Lynx', 'Giraffe', 'Zebra', 'Kangaroo', 'Squirrel', 'Hamster', 'Duck', 'Octopus'];
  free text[];
  existing text;
  uname text;
begin
  if not private.is_guest(p_user) then
    select username into uname from public.profiles where id = p_user;
    return coalesce(uname, 'user-' || left(p_user::text, 4));
  end if;

  select display_name into existing from public.room_members where room_id = p_room and user_id = p_user;
  if existing is not null then
    return existing;
  end if;

  select array_agg(a) into free
  from unnest(animals) a
  where 'Anonymous ' || a not in (select display_name from public.room_members where room_id = p_room);

  if free is not null then
    return 'Anonymous ' || free[1 + floor(random() * array_length(free, 1))::int];
  end if;
  return 'Anonymous ' || animals[1 + floor(random() * array_length(animals, 1))::int] || ' '
    || (select count(*) + 1 from public.room_members where room_id = p_room);
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs called by the app
-- All return jsonb { ok: true, ... } or { ok: false, error: '<code>' } instead of raising,
-- so failed attempts are still recorded for rate limiting.
-- ---------------------------------------------------------------------

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

  insert into public.rooms (name, password_hash, created_by)
  values (clean, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), uid)
  returning id into rid;

  dn := private.display_name_for(uid, rid);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (rid, uid, dn, private.is_guest(uid));

  return jsonb_build_object('ok', true, 'room_id', rid, 'room_name', clean, 'display_name', dn,
    'is_owner', private.is_room_owner(rid));
end;
$$;

-- p_room_id (optional) pins the join to one room, for invite links: names can repeat.
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
  select id, name into r
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
  dn := private.display_name_for(uid, r.id);
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (r.id, uid, dn, guest)
  on conflict (room_id, user_id) do update
    set last_active_at = now(), display_name = excluded.display_name;

  return jsonb_build_object('ok', true, 'room_id', r.id, 'room_name', r.name, 'display_name', dn,
    'is_owner', private.is_room_owner(r.id));
end;
$$;

/** Re-enter a room you're already a member of (from your rooms list or a link). */
create or replace function public.enter_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  dn text;
  rname text;
begin
  if uid is null or not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  dn := private.display_name_for(uid, p_room_id);
  update public.room_members set last_active_at = now(), display_name = dn
  where room_id = p_room_id and user_id = uid;
  select name into rname from public.rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', rname, 'display_name', dn,
    'is_owner', private.is_room_owner(p_room_id));
end;
$$;

-- Owner-only room management ------------------------------------------

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
  -- Passwords are stored as one-way hashes, so we can't tell whether this room's password
  -- matches another same-named room's. Block renaming onto a name that's in use instead.
  if exists (select 1 from public.rooms where name_key = lower(clean) and id <> p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  update public.rooms set name = clean where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id, 'room_name', clean);
end;
$$;

/** New password for joining. People already in the room stay in; it only affects new joins. */
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
  update public.rooms
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10))
  where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

/** Deletes the room and, through the foreign keys, its board, canvas and member list. */
create or replace function public.delete_room(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  insert into private.deleted_rooms (id, name_key)
  select id, name_key from public.rooms where id = p_room_id
  on conflict (id) do nothing;
  delete from public.rooms where id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

/** Wipes the whole canvas. Members can still erase individual items with the eraser. */
create or replace function public.clear_canvas(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  delete from public.strokes where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

/**
 * What an invite link points to: { name } for a live room, { deleted: true } for a deleted one,
 * or NULL. Room ids are unguessable, so knowing one already means you were sent it.
 */
create or replace function public.room_invite_info(p_room_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('name', name, 'deleted', false) from public.rooms where id = p_room_id),
    (select jsonb_build_object('name', null, 'deleted', true) from private.deleted_rooms where id = p_room_id)
  );
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where username = lower(btrim(p_username)));
$$;

/**
 * After a username sign-in fails: tells the app whether this account signs in another way
 * ('google', 'email'), or 'password' if it is a normal username account. NULL if no such user.
 * Never returns the email itself.
 */
create or replace function public.username_sign_in_method(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.signup_method = 'oauth' then 'google'
    when u.email is distinct from p.placeholder_email then 'email'
    else 'password'
  end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(btrim(p_username));
$$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default. Be explicit instead.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_room_member(text) to authenticated;
-- Supabase Auth inserts into auth.users and fires the profile trigger.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;

revoke execute on function public.create_room(text, text) from public, anon;
revoke execute on function public.join_room(text, text, text) from public, anon;
revoke execute on function public.enter_room(text) from public, anon;
grant execute on function public.create_room(text, text) to authenticated;
grant execute on function public.join_room(text, text, text) to authenticated;
grant execute on function public.enter_room(text) to authenticated;

revoke execute on function public.rename_room(text, text) from public, anon;
revoke execute on function public.change_room_password(text, text) from public, anon;
revoke execute on function public.delete_room(text) from public, anon;
revoke execute on function public.clear_canvas(text) from public, anon;
grant execute on function public.rename_room(text, text) to authenticated;
grant execute on function public.change_room_password(text, text) to authenticated;
grant execute on function public.delete_room(text) to authenticated;
grant execute on function public.clear_canvas(text) to authenticated;

revoke execute on function public.room_invite_info(text) from public;
revoke execute on function public.username_available(text) from public;
revoke execute on function public.username_sign_in_method(text) from public;
grant execute on function public.room_invite_info(text) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.username_sign_in_method(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.categories enable row level security;
alter table public.tasks enable row level security;
alter table public.task_options enable row level security;
alter table public.strokes enable row level security;
alter table private.room_join_attempts enable row level security;

-- Signed-out visitors (the `anon` role) get nothing from any table.
revoke all on public.profiles, public.rooms, public.room_members,
  public.categories, public.tasks, public.task_options, public.strokes from anon;
revoke all on all tables in schema private from anon, authenticated;

-- Signed-in users need table access before RLS can decide which rows they get.
-- (Some projects don't grant this automatically.) The policies below narrow it down.
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, delete on public.room_members to authenticated;
grant select, insert, update, delete on
  public.categories, public.tasks, public.task_options, public.strokes
to authenticated;

-- profiles: read your own. Created only by the trigger.
revoke insert, update, delete on public.profiles from authenticated;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- rooms: members can read the room, but never the password hash. Writes only through the RPCs.
revoke all on public.rooms from authenticated;
grant select (id, name, created_by, created_at) on public.rooms to authenticated;
drop policy if exists "members read room" on public.rooms;
create policy "members read room" on public.rooms
  for select to authenticated
  using ((select private.is_room_member(id)));

-- room_members: see who's in rooms you're in; leave a room by deleting your own row.
revoke insert, update on public.room_members from authenticated;
drop policy if exists "members read members" on public.room_members;
create policy "members read members" on public.room_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_room_member(room_id)));
drop policy if exists "leave room" on public.room_members;
create policy "leave room" on public.room_members
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Board and canvas content: members of the row's room only.
drop policy if exists "members manage categories" on public.categories;
create policy "members manage categories" on public.categories
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

drop policy if exists "members manage tasks" on public.tasks;
create policy "members manage tasks" on public.tasks
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check (
    (select private.is_room_member(room_id))
    -- a task's column must be in the same room as the task
    and exists (select 1 from public.categories c where c.id = tasks.category_id and c.room_id = tasks.room_id)
  );

drop policy if exists "members manage task options" on public.task_options;
create policy "members manage task options" on public.task_options
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

drop policy if exists "members manage strokes" on public.strokes;
create policy "members manage strokes" on public.strokes
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

-- ---------------------------------------------------------------------
-- Storage: board-assets/<room_id>/...
-- The bucket stays public-read (images are referenced by URL inside strokes and tasks, and
-- the paths contain random UUIDs), but only room members can upload, replace or delete.
-- ---------------------------------------------------------------------

-- Remove older policies on this bucket (e.g. "allow anon uploads") so they can't OR past these.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%board-assets%' or coalesce(with_check, '') ilike '%board-assets%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy "board-assets: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'board-assets' and (select private.is_room_member((storage.foldername(name))[1])));

create policy "board-assets: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'board-assets' and (select private.is_room_member((storage.foldername(name))[1])));

create policy "board-assets: members update" on storage.objects
  for update to authenticated
  using (bucket_id = 'board-assets' and (select private.is_room_member((storage.foldername(name))[1])));

create policy "board-assets: members delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'board-assets' and (select private.is_room_member((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- Realtime: private channels named devboard:<room_id>
-- (RLS is already enabled on realtime.messages; don't try to enable it.)
-- ---------------------------------------------------------------------

drop policy if exists "room members receive" on realtime.messages;
create policy "room members receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'devboard:%'
    and (select private.is_room_member(split_part((select realtime.topic()), ':', 2)))
  );

drop policy if exists "room members send" on realtime.messages;
create policy "room members send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'devboard:%'
    and (select private.is_room_member(split_part((select realtime.topic()), ':', 2)))
  );

-- ---------------------------------------------------------------------
-- Username → email directory (admin only)
-- One row per account; anonymous guests are left out. A view rather than a copied table, so it
-- can't drift when someone adds or changes their email. Not exposed to the API and unreadable by
-- anon / authenticated: view it in the Table Editor (schema: private) or with the service role.
-- ---------------------------------------------------------------------

create or replace view private.user_emails as
select
  p.id as user_id,
  p.username,
  -- NULL until a username-only account adds a real email.
  nullif(u.email, p.placeholder_email) as email,
  p.signup_method,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id;

revoke all on private.user_emails from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Optional housekeeping: anonymous guests pile up in auth.users. Run occasionally (or via pg_cron):
--   delete from auth.users where is_anonymous and created_at < now() - interval '30 days';
-- ---------------------------------------------------------------------

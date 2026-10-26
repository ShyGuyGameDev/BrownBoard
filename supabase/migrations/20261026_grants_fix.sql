-- =====================================================================
-- Fix: "permission denied for table room_members" (and profiles).
--
-- Row-level security decides WHICH rows a signed-in user can touch, but Postgres first checks
-- whether the role may use the table at all. This project doesn't grant that automatically,
-- so grant it explicitly. The RLS policies from 20261025_rooms_auth.sql still apply on top.
--
-- Safe to run more than once. Already folded into 20261025_rooms_auth.sql for fresh setups.
-- =====================================================================

grant usage on schema public to authenticated;

-- Read your own profile (RLS: own row only). Profiles are created by the sign-up trigger.
grant select on public.profiles to authenticated;

-- See members of your rooms, and leave a room. Joining goes through join_room / create_room.
grant select, delete on public.room_members to authenticated;

-- Rooms: every column except password_hash. Changes go through the owner-only functions.
grant select (id, name, created_by, created_at) on public.rooms to authenticated;

-- Board and canvas content (RLS: members of the row's room only).
grant select, insert, update, delete on
  public.categories, public.tasks, public.task_options, public.strokes
to authenticated;

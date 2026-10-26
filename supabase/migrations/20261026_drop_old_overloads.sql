-- =====================================================================
-- Fix: "Could not choose the best candidate function between public.join_room(...)".
--
-- An earlier run created join_room(p_name, p_password). The current version adds an optional
-- p_room_id, and `create or replace` with a different argument list makes a second function
-- instead of replacing the first, so calls with two arguments became ambiguous.
-- Drop the old versions; the current ones stay. Safe to run more than once.
-- =====================================================================

drop function if exists public.join_room(text, text);

-- Replaced by room_invite_info(text); no longer used by the app.
drop function if exists public.room_invite_name(text);

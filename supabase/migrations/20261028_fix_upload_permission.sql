-- =====================================================================
-- Fix: "permission denied for function is_guest" on every storage upload.
--
-- "avatars: own upload" called private.is_guest(), which signed-in users can't execute. Postgres
-- checks EXECUTE on every function in the INSERT policies of storage.objects, whichever bucket is
-- being written, so uploads to board-assets failed too. Read the guest flag from the sign-in
-- token instead; it's the same auth.users.is_anonymous value.
--
-- Run after 20261028_room_files.sql. Safe to re-run. Already folded into
-- 20261027_profile_pictures.sql for fresh setups.
-- =====================================================================

drop policy if exists "avatars: own upload" on storage.objects;
create policy "avatars: own upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true)
  );

-- Any other storage policy still calling a private function a signed-in user can't execute would
-- break uploads the same way. Expect no rows.
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ilike '%is_guest%' or coalesce(with_check, '') ilike '%is_guest%');

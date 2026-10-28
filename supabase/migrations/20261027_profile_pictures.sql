-- =====================================================================
-- Profile pictures.
--
-- Stored in the public "avatars" bucket at avatars/<user id>/<file>; each account can only write
-- its own folder, and guests can't upload. profiles.avatar_url points at the current one and is
-- set through update_profile_avatar, which only accepts that account's own avatar URLs.
--
-- Run after 20261027_profile_edits.sql. Safe to re-run.
-- =====================================================================

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket: anyone can view a picture by URL. Writes are limited to your own folder.
drop policy if exists "avatars: own upload" on storage.objects;
create policy "avatars: own upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    -- From the token, not private.is_guest(): signed-in users can't execute that, and a policy
    -- calling it breaks uploads to every bucket (see 20261028_fix_upload_permission.sql).
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true)
  );

drop policy if exists "avatars: own update" on storage.objects;
create policy "avatars: own update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: own delete" on storage.objects;
create policy "avatars: own delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Listing your own folder, so old pictures can be cleaned up after a new one is saved.
drop policy if exists "avatars: own list" on storage.objects;
create policy "avatars: own list" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

/** Sets (or, with null, removes) your profile picture. Returns the saved URL. */
create or replace function public.update_profile_avatar(p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or private.is_guest(v_user) then
    raise exception 'Sign in to set a profile picture.' using errcode = '42501';
  end if;
  if p_url is not null and p_url !~ (
    '^https://[^/]+/storage/v1/object/public/avatars/' || v_user::text || '/[A-Za-z0-9._-]+$'
  ) then
    raise exception 'That picture can''t be used.' using errcode = '22023';
  end if;
  update public.profiles set avatar_url = p_url where id = v_user;
  return p_url;
end;
$$;

revoke all on function public.update_profile_avatar(text) from public, anon, authenticated;
grant execute on function public.update_profile_avatar(text) to authenticated;

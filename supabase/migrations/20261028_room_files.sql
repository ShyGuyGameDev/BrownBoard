-- =====================================================================
-- Any kind of file on tasks and the canvas, not just images.
--
-- board-assets accepts every file type up to 50 MB (Supabase's free-plan cap; raise both this and
-- the project's global limit under Storage → Settings on a paid plan). Who can read and write is
-- unchanged: room members only, per 20261025_rooms_auth.sql.
--
-- tasks.attachments holds [{ url, name, type, size }]. The older tasks.images (bare image URLs) is
-- still read by the app and folded into attachments the next time that task's files change.
--
-- Run after 20261028_lock_down_dev_policies.sql. Safe to re-run.
-- =====================================================================

update storage.buckets
set file_size_limit = 52428800, allowed_mime_types = null
where id = 'board-assets';

alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.tasks drop constraint if exists tasks_attachments_shape;
alter table public.tasks add constraint tasks_attachments_shape
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 100);

-- =====================================================================
-- Optional categories per task, and a room-chosen "done" status.
--
-- 1. A task only carries the categories that were added to it. Status and Urgency become
--    nullable (null = not on this card); a custom category is on a card only when its id is a
--    key in tasks.custom_fields. Before this, a missing custom key meant "show the default", so
--    existing tasks get their defaults written in, and they look the same as before.
-- 2. task_board_settings holds which category + status marks a task done (greyed out, crossed
--    off, sunk to the bottom of its list). Defaults to Status / Completed.
-- Safe to re-run.
-- =====================================================================

alter table public.tasks alter column status drop not null;
alter table public.tasks alter column urgency drop not null;

-- Keep existing cards showing the custom categories they showed before.
update public.tasks t
set custom_fields = coalesce(t.custom_fields, '{}'::jsonb) || coalesce((
  select jsonb_object_agg(f.id::text, f.default_value)
  from public.task_custom_fields f
  where f.room_id = t.room_id
    and f.default_value is not null
    and not (coalesce(t.custom_fields, '{}'::jsonb) ? f.id::text)
), '{}'::jsonb)
where exists (
  select 1
  from public.task_custom_fields f
  where f.room_id = t.room_id
    and f.default_value is not null
    and not (coalesce(t.custom_fields, '{}'::jsonb) ? f.id::text)
);

-- ---------------------------------------------------------------------
-- Which status marks a task done
-- ---------------------------------------------------------------------

create table if not exists public.task_board_settings (
  room_id text primary key references public.rooms(id) on delete cascade,
  -- 'status', 'urgency', or a task_custom_fields id
  done_field text not null default 'status',
  done_value text not null default 'completed',
  constraint task_board_settings_done_field_len check (char_length(done_field) between 1 and 60),
  constraint task_board_settings_done_value_len check (char_length(done_value) between 1 and 60)
);

alter table public.task_board_settings enable row level security;
grant select, insert, update, delete on public.task_board_settings to authenticated;

drop policy if exists "members manage task board settings" on public.task_board_settings;
create policy "members manage task board settings" on public.task_board_settings
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

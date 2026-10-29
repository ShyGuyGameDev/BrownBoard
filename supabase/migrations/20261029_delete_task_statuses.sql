-- =====================================================================
-- Deleting statuses from a category (Status, Urgency, or a custom category).
--
-- The built-in statuses (Not started, In progress, ... / Critical, High, ...) become ordinary
-- task_options rows in each room, so any status can be deleted for one room by deleting its row.
-- New rooms get them on creation; existing rooms are backfilled below.
-- The database refuses to delete a status while a task in the room still uses it.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Built-in statuses as per-room rows
-- ---------------------------------------------------------------------

create or replace function private.seed_room_task_options(p_room_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_options (room_id, type, value, label, color, created_at)
  select p_room_id, d.type, d.value, d.label, d.color,
         -- Spaced out so ordering by created_at keeps the built-in order.
         now() + d.ord * interval '1 millisecond'
  from (values
    (1, 'status',  'not_started', 'Not started', '#71717a'),
    (2, 'status',  'in_progress', 'In progress', '#f59e0b'),
    (3, 'status',  'completed',   'Completed',   '#10b981'),
    (4, 'status',  'tabled',      'Tabled',      '#3b82f6'),
    (5, 'urgency', 'critical',    'Critical',    '#ef4444'),
    (6, 'urgency', 'high',        'High',        '#f97316'),
    (7, 'urgency', 'medium',      'Medium',      '#eab308'),
    (8, 'urgency', 'low',         'Low',         '#22c55e'),
    (9, 'urgency', 'tabled',      'Tabled',      '#3b82f6')
  ) as d(ord, type, value, label, color)
  -- Rooms that already renamed or recoloured a built-in keep their row.
  where not exists (
    select 1 from public.task_options o
    where o.room_id = p_room_id and o.type = d.type and o.value = d.value
  );
$$;

revoke execute on function private.seed_room_task_options(text) from public, anon, authenticated;

create or replace function private.seed_new_room_task_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_room_task_options(new.id);
  return null;
end;
$$;

revoke execute on function private.seed_new_room_task_options() from public, anon, authenticated;

drop trigger if exists seed_task_options on public.rooms;
create trigger seed_task_options after insert on public.rooms
  for each row execute function private.seed_new_room_task_options();

-- Backfill every existing room.
select private.seed_room_task_options(id) from public.rooms;

-- ---------------------------------------------------------------------
-- No deleting a status that's in use
-- ---------------------------------------------------------------------

create or replace function private.prevent_used_status_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  in_use boolean;
begin
  if tg_table_name = 'task_options' then
    -- A room being deleted is already gone by the time its rows cascade here; let that through.
    select exists (
      select 1
      from public.tasks t
      where t.room_id = old.room_id
        and exists (select 1 from public.rooms r where r.id = old.room_id)
        and case old.type when 'status' then t.status else t.urgency end = old.value
    ) into in_use;
  else
    -- Likewise a whole custom category being removed: its row is gone, so nothing matches.
    select exists (
      select 1
      from public.task_custom_fields f
      join public.tasks t on t.room_id = f.room_id
      where f.id = old.field_id
        and t.custom_fields ->> old.field_id::text = old.value
    ) into in_use;
  end if;

  if in_use then
    raise exception 'That status is still used by a task. Move those tasks to another status first.';
  end if;
  return old;
end;
$$;

revoke execute on function private.prevent_used_status_delete() from public, anon, authenticated;

drop trigger if exists prevent_used_status_delete on public.task_options;
create trigger prevent_used_status_delete
  before delete on public.task_options
  for each row execute function private.prevent_used_status_delete();

drop trigger if exists prevent_used_status_delete on public.task_custom_field_options;
create trigger prevent_used_status_delete
  before delete on public.task_custom_field_options
  for each row execute function private.prevent_used_status_delete();

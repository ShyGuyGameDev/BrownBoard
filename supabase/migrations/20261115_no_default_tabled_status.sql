-- =====================================================================
-- Tabled is no longer a built-in Status for new rooms (it stays a built-in Urgency).
--
-- Existing rooms keep their Tabled status row; it can be deleted per room like any status.
-- Safe to re-run.
-- =====================================================================

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
    (4, 'urgency', 'critical',    'Critical',    '#ef4444'),
    (5, 'urgency', 'high',        'High',        '#f97316'),
    (6, 'urgency', 'medium',      'Medium',      '#eab308'),
    (7, 'urgency', 'low',         'Low',         '#22c55e'),
    (8, 'urgency', 'tabled',      'Tabled',      '#3b82f6')
  ) as d(ord, type, value, label, color)
  -- Rooms that already renamed or recoloured a built-in keep their row.
  where not exists (
    select 1 from public.task_options o
    where o.room_id = p_room_id and o.type = d.type and o.value = d.value
  );
$$;

revoke execute on function private.seed_room_task_options(text) from public, anon, authenticated;

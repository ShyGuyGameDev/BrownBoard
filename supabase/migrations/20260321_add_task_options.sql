create extension if not exists "pgcrypto";

create table if not exists task_options (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('status', 'urgency')),
  value text not null,
  label text not null,
  color text not null default '#6b7280',
  created_at timestamptz not null default now(),
  unique (type, value)
);

-- Seed defaults to mirror current built-in options
insert into task_options (type, value, label, color)
values
  ('status', 'not_started', 'Not started', '#6b7280'),
  ('status', 'in_progress', 'In progress', '#f59e0b'),
  ('status', 'completed', 'Completed', '#10b981'),
  ('status', 'tabled', 'Tabled', '#3b82f6'),
  ('urgency', 'critical', 'Critical', '#ef4444'),
  ('urgency', 'high', 'High', '#f97316'),
  ('urgency', 'medium', 'Medium', '#eab308'),
  ('urgency', 'low', 'Low', '#22c55e'),
  ('urgency', 'tabled', 'Tabled', '#3b82f6')
on conflict do nothing;

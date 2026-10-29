alter table public.task_field_category_names
  add column if not exists default_value text,
  add column if not exists is_deleted boolean not null default false;

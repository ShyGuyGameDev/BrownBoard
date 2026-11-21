alter table public.task_custom_fields
  add column if not exists default_value text;

update public.task_custom_fields f
set default_value = (
  select o.value
  from public.task_custom_field_options o
  where o.field_id = f.id
  order by o.created_at, o.id
  limit 1
)
where f.default_value is null
  and exists (
    select 1
    from public.task_custom_field_options o
    where o.field_id = f.id
  );

create table if not exists public.task_field_category_names (
  room_id text not null references public.rooms(id) on delete cascade,
  field_type text not null check (field_type in ('status', 'urgency')),
  name text not null,
  default_value text,
  is_deleted boolean not null default false,
  primary key (room_id, field_type),
  constraint task_field_category_names_len check (char_length(name) between 1 and 40)
);

alter table public.task_field_category_names enable row level security;
grant select, insert, update, delete on public.task_field_category_names to authenticated;

drop policy if exists "members manage task field category names" on public.task_field_category_names;
create policy "members manage task field category names" on public.task_field_category_names
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

create or replace function private.clean_task_field_category_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := private.clean_text(new.name, 40);
  return new;
end;
$$;

drop trigger if exists clean_task_field_category_name on public.task_field_category_names;
create trigger clean_task_field_category_name
  before insert or update on public.task_field_category_names
  for each row execute function private.clean_task_field_category_name();

revoke execute on function private.clean_task_field_category_name() from public, anon, authenticated;

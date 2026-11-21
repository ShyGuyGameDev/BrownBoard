alter table public.tasks
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create table if not exists public.task_custom_fields (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (room_id, name),
  constraint task_custom_fields_name_len check (char_length(name) between 1 and 40)
);

create table if not exists public.task_custom_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.task_custom_fields(id) on delete cascade,
  value text not null check (value ~ '^[a-z0-9_]{1,60}$'),
  label text not null,
  color text not null default '#71717a',
  created_at timestamptz not null default now(),
  unique (field_id, value),
  constraint task_custom_field_options_label_len check (char_length(label) between 1 and 40),
  constraint task_custom_field_options_color_hex check (color ~ '^#[0-9a-f]{6}$')
);

create or replace function private.clean_task_custom_field_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'task_custom_fields' then
    new.name := private.clean_text(new.name, 40);
  else
    new.label := private.clean_text(new.label, 40);
    new.color := case
      when new.color ~ '^#[0-9a-fA-F]{6}$' then lower(new.color)
      else '#71717a'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists clean_custom_task_field_text on public.task_custom_fields;
create trigger clean_custom_task_field_text
  before insert or update on public.task_custom_fields
  for each row execute function private.clean_task_custom_field_text();

drop trigger if exists clean_custom_task_field_option_text on public.task_custom_field_options;
create trigger clean_custom_task_field_option_text
  before insert or update on public.task_custom_field_options
  for each row execute function private.clean_task_custom_field_text();

revoke execute on function private.clean_task_custom_field_text() from public, anon, authenticated;

alter table public.task_custom_fields enable row level security;
alter table public.task_custom_field_options enable row level security;

grant select, insert, update, delete on
  public.task_custom_fields, public.task_custom_field_options
to authenticated;

drop policy if exists "members manage task custom fields" on public.task_custom_fields;
create policy "members manage task custom fields" on public.task_custom_fields
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

drop policy if exists "members manage task custom field options" on public.task_custom_field_options;
create policy "members manage task custom field options" on public.task_custom_field_options
  for all to authenticated
  using (exists (
    select 1
    from public.task_custom_fields f
    where f.id = task_custom_field_options.field_id
      and (select private.is_room_member(f.room_id))
  ))
  with check (exists (
    select 1
    from public.task_custom_fields f
    where f.id = task_custom_field_options.field_id
      and (select private.is_room_member(f.room_id))
  ));

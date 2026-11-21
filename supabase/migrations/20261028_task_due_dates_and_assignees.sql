-- Add task due dates and account-only assignments. Assignment options are limited to accounts
-- that have visited the room; anonymous guests are never recorded in private.room_visitors.

alter table public.tasks
  add column if not exists due_date date,
  add column if not exists assignee_id uuid references public.profiles (id) on delete set null;

create or replace function private.validate_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and not exists (
    select 1
    from private.room_visitors v
    where v.room_id = new.room_id and v.user_id = new.assignee_id
  ) then
    raise exception 'Assignee must have been a signed-in member of this room';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_task_assignee on public.tasks;
create trigger validate_task_assignee
  before insert or update of room_id, assignee_id on public.tasks
  for each row execute function private.validate_task_assignee();

create or replace function public.task_assignees(p_room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.username,
      'avatar_url', p.avatar_url
    ) order by p.username)
    from private.room_visitors v
    join public.profiles p on p.id = v.user_id
    where v.room_id = p_room_id
  ), '[]'::jsonb));
end;
$$;

revoke execute on function private.validate_task_assignee() from public, anon, authenticated;
revoke execute on function public.task_assignees(text) from public, anon;
grant execute on function public.task_assignees(text) to authenticated;

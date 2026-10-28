-- =====================================================================
-- Leaving rooms, and handing a room to someone else when its owner leaves.
--
-- Every account that has been in a room is remembered (private.room_visitors), even after it
-- leaves, so an owner who wants to leave can pick any of them to take over. Guests aren't
-- recorded: they can't own rooms.
--
-- leave_room is the only way out of a room for accounts: members just leave; the owner has to
-- name a new owner, who is added back to the room if they'd left it.
--
-- Run after 20261027_untitled_rooms.sql. Safe to re-run.
-- =====================================================================

create table if not exists private.room_visitors (
  room_id text not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_visitors_user on private.room_visitors (user_id);
revoke all on private.room_visitors from public, anon, authenticated;

/** Records accounts as they join or re-enter a room (join_room, enter_room, claim_room, …). */
create or replace function private.track_room_visitor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_guest then
    insert into private.room_visitors (room_id, user_id, first_seen_at, last_seen_at)
    values (new.room_id, new.user_id, new.joined_at, new.last_active_at)
    on conflict (room_id, user_id) do update set last_seen_at = excluded.last_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists track_room_visitor on public.room_members;
create trigger track_room_visitor after insert or update on public.room_members
  for each row execute function private.track_room_visitor();

-- Everyone already in a room.
insert into private.room_visitors (room_id, user_id, first_seen_at, last_seen_at)
select room_id, user_id, joined_at, last_active_at from public.room_members where not is_guest
on conflict (room_id, user_id) do nothing;

/**
 * Owner only: the other accounts that have been in the room, most recently seen first, for
 * picking who takes over. `is_member`: still in the room (the others have left it).
 */
create or replace function public.room_people(p_room_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object(
        'user_id', v.user_id,
        'username', p.username,
        'avatar_url', p.avatar_url,
        'last_seen_at', v.last_seen_at,
        'is_member', m.user_id is not null)
      order by v.last_seen_at desc)
    from private.room_visitors v
    join public.profiles p on p.id = v.user_id
    left join public.room_members m on m.room_id = v.room_id and m.user_id = v.user_id
    where v.room_id = p_room_id and v.user_id <> auth.uid() and not private.is_guest(v.user_id)
  ), '[]'::jsonb));
end;
$$;

/**
 * Leave a room. Its owner has to pass `p_new_owner`: someone who has been in the room, who then
 * owns it (and is added back if they'd left). If they already own a room with this name, it gets
 * a number, like claim_room does. Returns the room's name afterwards, for telling the room.
 */
create or replace function public.leave_room(p_room_id text, p_new_owner uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r record;
  base text;
  candidate text;
  n int := 1;
  new_name text;
begin
  if uid is null or private.is_guest(uid) then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;

  -- Locked so two owners-to-be can't race (e.g. leaving from two tabs).
  select name, unnamed, created_by into r from public.rooms where id = p_room_id for update;

  if r.created_by is distinct from uid then
    delete from public.room_members where room_id = p_room_id and user_id = uid;
    return jsonb_build_object('ok', true, 'room_name', r.name);
  end if;

  if p_new_owner is null then
    return jsonb_build_object('ok', false, 'error', 'pick_owner');
  end if;
  if p_new_owner = uid or private.is_guest(p_new_owner) or not exists (
    select 1 from private.room_visitors where room_id = p_room_id and user_id = p_new_owner
  ) then
    return jsonb_build_object('ok', false, 'error', 'bad_owner');
  end if;

  if r.unnamed then
    candidate := private.next_untitled_name(p_new_owner, p_room_id);
  else
    candidate := r.name;
    base := left(r.name, 45);
    while private.owner_has_room_named(p_new_owner, lower(candidate), p_room_id) loop
      n := n + 1;
      candidate := base || ' ' || n;
    end loop;
  end if;

  update public.rooms set created_by = p_new_owner, name = candidate where id = p_room_id;
  insert into public.room_members (room_id, user_id, display_name, is_guest)
  values (p_room_id, p_new_owner, private.display_name_for(p_new_owner, p_room_id), false)
  on conflict (room_id, user_id) do nothing;
  delete from public.room_members where room_id = p_room_id and user_id = uid;
  delete from private.room_claims where room_id = p_room_id;

  select username into new_name from public.profiles where id = p_new_owner;
  return jsonb_build_object('ok', true, 'room_name', candidate, 'new_owner_name', new_name);
end;
$$;

-- Owners leave through leave_room, which hands the room on; members can still delete their row.
drop policy if exists "leave room" on public.room_members;
create policy "leave room" on public.room_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and not (select private.is_room_owner(room_id)));

revoke execute on function private.track_room_visitor() from public, anon, authenticated;
revoke execute on function public.room_people(text) from public, anon;
grant execute on function public.room_people(text) to authenticated;
revoke execute on function public.leave_room(text, uuid) from public, anon;
grant execute on function public.leave_room(text, uuid) to authenticated;

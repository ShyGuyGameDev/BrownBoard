-- =====================================================================
-- Deleting your account.
--
-- delete_my_account() deletes every room you own (like delete_room), then the account itself.
-- That removes you from every other room, along with your watches, notifications and picture
-- row (all on delete cascade). Your comments in other people's rooms stay, under the name you
-- had, so the discussion still makes sense to everyone else.
--
-- Uploaded files (room images, your profile pictures) can't be removed from SQL; the app removes
-- them through Storage before calling this.
--
-- Run after 20261031_cards_labels_comments.sql. Safe to re-run.
-- =====================================================================

-- Comments outlive their author: the author link is cleared instead of deleting the comment.
alter table public.task_comments alter column author_id drop not null;
alter table public.task_comments drop constraint if exists task_comments_author_id_fkey;
alter table public.task_comments
  add constraint task_comments_author_id_fkey
  foreign key (author_id) references auth.users (id) on delete set null;

-- As in 20261031_cards_labels_comments.sql, plus: let that cleared author link through (it would
-- otherwise be put back, and the account couldn't be deleted). Clients can't do the same: the
-- update policy only accepts rows whose author is you.
create or replace function private.prepare_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.author_id is null and old.author_id is not null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_name := coalesce((
      select m.display_name from public.room_members m
      where m.room_id = new.room_id and m.user_id = new.author_id
    ), 'Someone');
    new.created_at := now();
    new.edited_at := null;
  else
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.task_id := old.task_id;
    new.room_id := old.room_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;
  new.body := private.clean_text(new.body, 4000, true);
  new.mentions := coalesce((
    select array_agg(distinct m)
    from unnest(new.mentions) as m
    where exists (
      select 1 from private.room_visitors v where v.room_id = new.room_id and v.user_id = m
    )
  ), '{}');
  return new;
end;
$$;
revoke execute on function private.prepare_task_comment() from public, anon, authenticated;

/** Deletes the rooms you own, then your account. Returns how many rooms were deleted. */
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r record;
  n int := 0;
begin
  if uid is null or private.is_guest(uid) then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  for r in select id, name_key, password_secret_id from public.rooms where created_by = uid for update
  loop
    insert into private.deleted_rooms (id, name_key)
    values (r.id, r.name_key)
    on conflict (id) do nothing;
    delete from public.rooms where id = r.id;
    if r.password_secret_id is not null then
      delete from vault.secrets where id = r.password_secret_id;
    end if;
    n := n + 1;
  end loop;

  delete from auth.users where id = uid;
  return jsonb_build_object('ok', true, 'rooms_deleted', n);
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- Trello-style card features.
--
--   Labels       task_labels (room-wide), tasks.label_ids
--   Checklists   tasks.checklists  [{id, title, items: [{id, text, done}]}]
--   Covers       tasks.cover       {"color": "#rrggbb"} | {"url": "<an image attachment>"}
--   Members      tasks.member_ids  (replaces the single assignee; assignee_id mirrors the first)
--   Archive      tasks.archived_at, categories.archived_at
--   Watching     task_watchers
--   Comments     task_comments  (with @mentions)
--   Activity     task_activity  (written by triggers: created, moved, archived, members, due, fields)
--   Bell         notifications  (written by triggers: mentions, comments / changes on watched
--                cards, being added to a card). "Due soon" is worked out in the app.
--
-- Run after 20261030_optional_task_categories.sql. Safe to re-run.
-- =====================================================================

-- Text cleaning used below (also in 20261026_sanitize_text.sql, which not every database has).
create or replace function private.clean_text(p text, p_max int, p_multiline boolean default false)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := p;
begin
  if t is null then
    return null;
  end if;
  t := normalize(t, NFC);
  t := regexp_replace(t, '[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]', '', 'g');
  if p_multiline then
    t := replace(replace(t, E'\r\n', E'\n'), E'\r', E'\n');
    t := regexp_replace(t, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', 'g');
    t := regexp_replace(t, '[ \t]+$', '', 'gn');          -- trailing spaces on each line
    t := regexp_replace(t, E'\n{3,}', E'\n\n', 'g');      -- at most one blank line in a row
  else
    t := regexp_replace(t, '[\x01-\x1F\x7F-\x9F]', ' ', 'g');
    t := regexp_replace(t, '\s+', ' ', 'g');
  end if;
  t := btrim(t, E' \n\t');
  return left(t, p_max);
end;
$$;
revoke execute on function private.clean_text(text, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------

create table if not exists public.task_labels (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  -- May be empty: a label can be just a colour, as in Trello.
  name text not null default '',
  color text not null default '#3b82f6',
  created_at timestamptz not null default now(),
  constraint task_labels_name_len check (char_length(name) <= 40),
  constraint task_labels_color_hex check (color ~ '^#[0-9a-f]{6}$')
);
create index if not exists task_labels_room on public.task_labels (room_id, created_at);

create or replace function private.clean_task_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := coalesce(private.clean_text(new.name, 40), '');
  new.color := case when new.color ~ '^#[0-9a-fA-F]{6}$' then lower(new.color) else '#3b82f6' end;
  return new;
end;
$$;
revoke execute on function private.clean_task_label() from public, anon, authenticated;

drop trigger if exists clean_task_label on public.task_labels;
create trigger clean_task_label before insert or update on public.task_labels
  for each row execute function private.clean_task_label();

alter table public.task_labels enable row level security;
grant select, insert, update, delete on public.task_labels to authenticated;
drop policy if exists "members manage task labels" on public.task_labels;
create policy "members manage task labels" on public.task_labels
  for all to authenticated
  using ((select private.is_room_member(room_id)))
  with check ((select private.is_room_member(room_id)));

-- ---------------------------------------------------------------------
-- New task / list columns
-- ---------------------------------------------------------------------

alter table public.tasks
  add column if not exists label_ids uuid[] not null default '{}',
  add column if not exists checklists jsonb not null default '[]'::jsonb,
  add column if not exists cover jsonb,
  add column if not exists member_ids uuid[] not null default '{}',
  add column if not exists archived_at timestamptz;

alter table public.categories
  add column if not exists archived_at timestamptz;

-- The single assignee becomes the first member.
update public.tasks
set member_ids = array[assignee_id]
where assignee_id is not null and member_ids = '{}';

-- Removing a label takes it off every card.
create or replace function private.unlink_deleted_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks
  set label_ids = array_remove(label_ids, old.id)
  where room_id = old.room_id and old.id = any(label_ids);
  return old;
end;
$$;
revoke execute on function private.unlink_deleted_label() from public, anon, authenticated;

drop trigger if exists unlink_deleted_label on public.task_labels;
create trigger unlink_deleted_label after delete on public.task_labels
  for each row execute function private.unlink_deleted_label();

-- Members must be signed-in people who have been in the room (as assignees were); the first one
-- is mirrored into assignee_id for anything still reading it.
create or replace function private.validate_task_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.member_ids := coalesce((
    select array_agg(distinct m)
    from unnest(new.member_ids) as m
    where exists (
      select 1 from private.room_visitors v where v.room_id = new.room_id and v.user_id = m
    )
  ), '{}');
  new.assignee_id := new.member_ids[1];
  -- Labels must belong to the room too.
  new.label_ids := coalesce((
    select array_agg(distinct l)
    from unnest(new.label_ids) as l
    where exists (select 1 from public.task_labels t where t.id = l and t.room_id = new.room_id)
  ), '{}');
  if jsonb_typeof(new.checklists) is distinct from 'array' then
    new.checklists := '[]'::jsonb;
  end if;
  if new.cover is not null and jsonb_typeof(new.cover) <> 'object' then
    new.cover := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.validate_task_members() from public, anon, authenticated;

drop trigger if exists validate_task_members on public.tasks;
create trigger validate_task_members
  before insert or update of room_id, member_ids, label_ids, checklists, cover on public.tasks
  for each row execute function private.validate_task_members();

-- ---------------------------------------------------------------------
-- Watching
-- ---------------------------------------------------------------------

create table if not exists public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists task_watchers_user on public.task_watchers (user_id);

alter table public.task_watchers enable row level security;
grant select, insert, delete on public.task_watchers to authenticated;
drop policy if exists "members see watchers" on public.task_watchers;
create policy "members see watchers" on public.task_watchers
  for select to authenticated using ((select private.is_room_member(room_id)));
drop policy if exists "watch as yourself" on public.task_watchers;
create policy "watch as yourself" on public.task_watchers
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_room_member(room_id)));
drop policy if exists "unwatch as yourself" on public.task_watchers;
create policy "unwatch as yourself" on public.task_watchers
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '',
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint task_comments_body_len check (char_length(body) between 1 and 4000)
);
create index if not exists task_comments_task on public.task_comments (task_id, created_at);
create index if not exists task_comments_room on public.task_comments (room_id);

-- Who wrote it comes from the session, never the client; mentions are kept to people who can be
-- notified (signed-in people who have been in the room).
create or replace function private.prepare_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

drop trigger if exists prepare_task_comment on public.task_comments;
create trigger prepare_task_comment before insert or update on public.task_comments
  for each row execute function private.prepare_task_comment();

alter table public.task_comments enable row level security;
grant select, insert, update, delete on public.task_comments to authenticated;
drop policy if exists "members read comments" on public.task_comments;
create policy "members read comments" on public.task_comments
  for select to authenticated using ((select private.is_room_member(room_id)));
drop policy if exists "members comment" on public.task_comments;
create policy "members comment" on public.task_comments
  for insert to authenticated
  with check (
    (select private.is_room_member(room_id))
    and exists (select 1 from public.tasks t where t.id = task_id and t.room_id = task_comments.room_id)
  );
drop policy if exists "authors edit comments" on public.task_comments;
create policy "authors edit comments" on public.task_comments
  for update to authenticated using (author_id = (select auth.uid()));
drop policy if exists "authors delete comments" on public.task_comments;
create policy "authors delete comments" on public.task_comments
  for delete to authenticated using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Notifications (the bell)
-- ---------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id text not null references public.rooms(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  -- mention | comment | added | activity
  kind text not null,
  actor_name text not null default '',
  task_title text not null default '',
  -- mention / comment: the comment text; activity: the task_activity detail
  body text not null default '',
  detail jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
grant select, update, delete on public.notifications to authenticated;
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "mark own notifications" on public.notifications;
create policy "mark own notifications" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "clear own notifications" on public.notifications;
create policy "clear own notifications" on public.notifications
  for delete to authenticated using (user_id = (select auth.uid()));

-- Only read_at can change.
create or replace function private.lock_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  read timestamptz := new.read_at;
begin
  new := old;
  new.read_at := read;
  return new;
end;
$$;
revoke execute on function private.lock_notification() from public, anon, authenticated;

drop trigger if exists lock_notification on public.notifications;
create trigger lock_notification before update on public.notifications
  for each row execute function private.lock_notification();

-- After a comment: @mentioned people get "mention"; others watching the card get "comment".
create or replace function private.notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  title text;
begin
  select t.title into title from public.tasks t where t.id = new.task_id;
  insert into public.notifications (user_id, room_id, task_id, kind, actor_name, task_title, body)
  select m, new.room_id, new.task_id, 'mention', new.author_name, coalesce(title, ''),
         left(new.body, 280)
  from unnest(new.mentions) as m
  where m <> new.author_id;

  insert into public.notifications (user_id, room_id, task_id, kind, actor_name, task_title, body)
  select w.user_id, new.room_id, new.task_id, 'comment', new.author_name, coalesce(title, ''),
         left(new.body, 280)
  from public.task_watchers w
  where w.task_id = new.task_id
    and w.user_id <> new.author_id
    and not (w.user_id = any(new.mentions));
  return null;
end;
$$;
revoke execute on function private.notify_task_comment() from public, anon, authenticated;

drop trigger if exists notify_task_comment on public.task_comments;
create trigger notify_task_comment after insert on public.task_comments
  for each row execute function private.notify_task_comment();

-- ---------------------------------------------------------------------
-- Activity log
-- ---------------------------------------------------------------------

create table if not exists public.task_activity (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid,
  actor_name text not null default '',
  -- created | moved | archived | restored | members | due | field
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_task on public.task_activity (task_id, created_at);

alter table public.task_activity enable row level security;
grant select on public.task_activity to authenticated;
drop policy if exists "members read activity" on public.task_activity;
create policy "members read activity" on public.task_activity
  for select to authenticated using ((select private.is_room_member(room_id)));

create or replace function private.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  entries jsonb := '[]'::jsonb;
  entry jsonb;
  k text;
  added uuid[];
  removed uuid[];
begin
  select m.display_name into actor_name
  from public.room_members m where m.room_id = new.room_id and m.user_id = actor;
  actor_name := coalesce(actor_name, 'Someone');

  if tg_op = 'INSERT' then
    entries := jsonb_build_array(jsonb_build_object('kind', 'created', 'detail',
      jsonb_build_object('list', (select c.name from public.categories c where c.id = new.category_id))));
  else
    if new.category_id is distinct from old.category_id then
      entries := entries || jsonb_build_object('kind', 'moved', 'detail', jsonb_build_object(
        'from', (select c.name from public.categories c where c.id = old.category_id),
        'to', (select c.name from public.categories c where c.id = new.category_id)));
    end if;
    if new.archived_at is distinct from old.archived_at then
      entries := entries || jsonb_build_object(
        'kind', case when new.archived_at is null then 'restored' else 'archived' end,
        'detail', '{}'::jsonb);
    end if;
    if new.member_ids is distinct from old.member_ids then
      added := array(select unnest(new.member_ids) except select unnest(old.member_ids));
      removed := array(select unnest(old.member_ids) except select unnest(new.member_ids));
      if cardinality(added) + cardinality(removed) > 0 then
        entries := entries || jsonb_build_object('kind', 'members', 'detail', jsonb_build_object(
          'added', (select coalesce(jsonb_agg(p.username), '[]') from public.profiles p where p.id = any(added)),
          'removed', (select coalesce(jsonb_agg(p.username), '[]') from public.profiles p where p.id = any(removed))));
      end if;
    end if;
    if new.due_date is distinct from old.due_date then
      entries := entries || jsonb_build_object('kind', 'due', 'detail',
        jsonb_build_object('due', new.due_date));
    end if;
    if new.status is distinct from old.status then
      entries := entries || jsonb_build_object('kind', 'field', 'detail',
        jsonb_build_object('field', 'status', 'value', new.status));
    end if;
    if new.urgency is distinct from old.urgency then
      entries := entries || jsonb_build_object('kind', 'field', 'detail',
        jsonb_build_object('field', 'urgency', 'value', new.urgency));
    end if;
    if new.custom_fields is distinct from old.custom_fields then
      for k in
        select key from jsonb_each(coalesce(new.custom_fields, '{}') || coalesce(old.custom_fields, '{}'))
      loop
        if (new.custom_fields -> k) is distinct from (old.custom_fields -> k) then
          entries := entries || jsonb_build_object('kind', 'field', 'detail',
            jsonb_build_object('field', k, 'value', new.custom_fields ->> k));
        end if;
      end loop;
    end if;
  end if;

  for entry in select * from jsonb_array_elements(entries) loop
    insert into public.task_activity (room_id, task_id, actor_id, actor_name, kind, detail)
    values (new.room_id, new.id, actor, actor_name, entry ->> 'kind', entry -> 'detail');
  end loop;

  -- Watchers hear about changes (not about the card being created): one notification per save,
  -- listing everything that changed, so a save that touches three things doesn't ring three times.
  if tg_op = 'UPDATE' and jsonb_array_length(entries) > 0 then
    insert into public.notifications
      (user_id, room_id, task_id, kind, actor_name, task_title, detail)
    select w.user_id, new.room_id, new.id, 'activity', actor_name, new.title,
           jsonb_build_object('changes', entries)
    from public.task_watchers w
    where w.task_id = new.id and w.user_id is distinct from actor;
  end if;

  -- People newly added to a card are told (unless they added themselves).
  if tg_op = 'UPDATE' and new.member_ids is distinct from old.member_ids then
    insert into public.notifications (user_id, room_id, task_id, kind, actor_name, task_title)
    select m, new.room_id, new.id, 'added', actor_name, new.title
    from unnest(array(select unnest(new.member_ids) except select unnest(old.member_ids))) as m
    where m is distinct from actor
      -- a watcher already got the "members" activity note
      and not exists (select 1 from public.task_watchers w where w.task_id = new.id and w.user_id = m);
  elsif tg_op = 'INSERT' then
    insert into public.notifications (user_id, room_id, task_id, kind, actor_name, task_title)
    select m, new.room_id, new.id, 'added', actor_name, new.title
    from unnest(new.member_ids) as m
    where m is distinct from actor;
  end if;
  return null;
end;
$$;
revoke execute on function private.log_task_activity() from public, anon, authenticated;

drop trigger if exists log_task_activity on public.tasks;
create trigger log_task_activity
  after insert or update of category_id, archived_at, member_ids, due_date, status, urgency, custom_fields
  on public.tasks
  for each row execute function private.log_task_activity();

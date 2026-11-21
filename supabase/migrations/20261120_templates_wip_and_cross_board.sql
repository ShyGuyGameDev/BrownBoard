-- =====================================================================
-- Card / board templates, WIP limits per list, and copying or moving cards between rooms.
--
--   WIP limits     categories.wip_limit (null = none). A soft limit, as in Jira: the list turns
--                  red when it holds more cards than that, but cards can still be added.
--   Card templates tasks.is_template. A template card sits in its list with a Template badge;
--                  "From template" at the bottom of any list makes a new card from it.
--   Move / copy    move_task_to_room, copy_task_to_room: a card to any list in any room you're a
--                  member of (the same room too). Labels, statuses and categories are matched by
--                  name in the other room (missing labels are created there; statuses and
--                  categories it doesn't have are dropped). Members who have never been in the
--                  other room come off the card. A move keeps the card's comments and activity.
--   Board templates apply_board_template: lists (with WIP limits), labels, categories with
--                  statuses, and cards, from a built-in template or a copy of another room.
--
-- Run after 20261115_progress_category_name.sql. Safe to re-run.
-- =====================================================================

alter table public.categories add column if not exists wip_limit int;
alter table public.categories drop constraint if exists categories_wip_limit_range;
alter table public.categories
  add constraint categories_wip_limit_range check (wip_limit is null or wip_limit between 1 and 999);

alter table public.tasks add column if not exists is_template boolean not null default false;

-- ---------------------------------------------------------------------
-- Comments follow a moved card into its new room.
-- Same as 20261031_cards_labels_comments.sql, except that while move_task_to_room is moving a
-- card (it sets brownboard.moving_task to the card's id for the transaction) its comments may
-- change room and are otherwise left exactly as they were (not marked edited).
-- ---------------------------------------------------------------------

create or replace function private.prepare_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room text;
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('brownboard.moving_task', true), '') = old.task_id::text then
    target_room := new.room_id;
    new := old;
    new.room_id := target_room;
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

-- ---------------------------------------------------------------------
-- Matching a card's values to another room
-- ---------------------------------------------------------------------

-- The label in p_room_id that stands for p_label_id: the same label in its own room, else one with
-- the same name and colour, else the same name, else a new copy of it.
create or replace function private.label_in_room(p_label_id uuid, p_room_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.task_labels;
  match uuid;
begin
  select * into src from public.task_labels where id = p_label_id;
  if not found then
    return null;
  end if;
  if src.room_id = p_room_id then
    return src.id;
  end if;
  select l.id into match from public.task_labels l
  where l.room_id = p_room_id and lower(l.name) = lower(src.name) and l.color = src.color
  order by l.created_at limit 1;
  if match is null and src.name <> '' then
    select l.id into match from public.task_labels l
    where l.room_id = p_room_id and lower(l.name) = lower(src.name)
    order by l.created_at limit 1;
  end if;
  if match is null then
    insert into public.task_labels (room_id, name, color)
    values (p_room_id, src.name, src.color)
    returning id into match;
  end if;
  return match;
end;
$$;
revoke execute on function private.label_in_room(uuid, text) from public, anon, authenticated;

-- A status (or urgency) value as p_room_id knows it: kept when that room has it; otherwise that
-- room's default for the category (a card that had the category keeps having it); null stays null.
create or replace function private.option_in_room(p_type text, p_value text, p_room_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_value is null then null
    when exists (
      select 1 from public.task_options o
      where o.room_id = p_room_id and o.type = p_type and o.value = p_value
    ) then p_value
    else coalesce(
      (select n.default_value from public.task_field_category_names n
       where n.room_id = p_room_id and n.field_type = p_type
         and exists (select 1 from public.task_options o
                     where o.room_id = p_room_id and o.type = p_type and o.value = n.default_value)),
      (select o.value from public.task_options o
       where o.room_id = p_room_id and o.type = p_type
       order by o.created_at limit 1)
    )
  end;
$$;
revoke execute on function private.option_in_room(text, text, text) from public, anon, authenticated;

-- Custom category values ({category id: status value}) as p_room_id knows them: each category is
-- matched by name, and kept only when the matching category there has that status.
create or replace function private.custom_fields_in_room(p_fields jsonb, p_from_room text, p_room_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_from_room = p_room_id then coalesce(p_fields, '{}'::jsonb) else coalesce((
    select jsonb_object_agg(target.id::text, e.value)
    from jsonb_each_text(coalesce(p_fields, '{}'::jsonb)) e
    join public.task_custom_fields src on src.id::text = e.key and src.room_id = p_from_room
    join lateral (
      select f.id from public.task_custom_fields f
      where f.room_id = p_room_id and lower(f.name) = lower(src.name)
      order by f.created_at limit 1
    ) target on true
    where exists (
      select 1 from public.task_custom_field_options o where o.field_id = target.id and o.value = e.value
    )
  ), '{}'::jsonb) end;
$$;
revoke execute on function private.custom_fields_in_room(jsonb, text, text) from public, anon, authenticated;

-- Shared checks for move / copy. Returns an error code, or null when it's allowed.
create or replace function private.check_card_destination(p_task public.tasks, p_room_id text, p_category_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then 'not_signed_in'
    when p_task.id is null or not private.is_room_member(p_task.room_id) then 'not_found'
    when not private.is_room_member(p_room_id) then 'not_member'
    when not exists (
      select 1 from public.categories c
      where c.id = p_category_id and c.room_id = p_room_id and c.archived_at is null
    ) then 'bad_list'
    else null
  end;
$$;
revoke execute on function private.check_card_destination(public.tasks, text, uuid) from public, anon, authenticated;

-- Makes room at p_position in a list (null = the end) and returns the position to use.
create or replace function private.open_list_slot(p_category_id uuid, p_position int, p_except uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  pos int;
begin
  if p_position is null then
    select coalesce(max(t.position) + 1, 0) into pos
    from public.tasks t where t.category_id = p_category_id and t.id is distinct from p_except;
    return pos;
  end if;
  pos := greatest(0, p_position);
  update public.tasks set position = position + 1
  where category_id = p_category_id and position >= pos and id is distinct from p_except;
  return pos;
end;
$$;
revoke execute on function private.open_list_slot(uuid, int, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Move a card to a list in this room or another one
-- ---------------------------------------------------------------------

create or replace function public.move_task_to_room(
  p_task_id uuid,
  p_room_id text,
  p_category_id uuid,
  p_position int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  err text;
  pos int;
  cross_room boolean;
begin
  select * into t from public.tasks where id = p_task_id for update;
  err := private.check_card_destination(t, p_room_id, p_category_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  cross_room := t.room_id <> p_room_id;

  if cross_room then
    -- People who have never been in the other room stop watching it and lose its notifications
    -- (before the update, so they aren't told about the move into a room they can't open).
    delete from public.task_watchers w
    where w.task_id = t.id
      and not exists (select 1 from public.room_members m where m.room_id = p_room_id and m.user_id = w.user_id);
    delete from public.notifications n
    where n.task_id = t.id
      and not exists (select 1 from public.room_members m where m.room_id = p_room_id and m.user_id = n.user_id);
  end if;

  pos := private.open_list_slot(p_category_id, p_position, t.id);
  update public.tasks set
    room_id = p_room_id,
    category_id = p_category_id,
    position = pos,
    archived_at = null,
    label_ids = coalesce(array_remove(array(
      select distinct private.label_in_room(l, p_room_id) from unnest(t.label_ids) l
    ), null), '{}'),
    status = case when cross_room then private.option_in_room('status', t.status, p_room_id) else t.status end,
    urgency = case when cross_room then private.option_in_room('urgency', t.urgency, p_room_id) else t.urgency end,
    custom_fields = private.custom_fields_in_room(t.custom_fields, t.room_id, p_room_id)
  where id = t.id;

  if cross_room then
    perform set_config('brownboard.moving_task', t.id::text, true);
    update public.task_comments set room_id = p_room_id where task_id = t.id;
    perform set_config('brownboard.moving_task', '', true);
    update public.task_activity set room_id = p_room_id where task_id = t.id;
    update public.task_watchers set room_id = p_room_id where task_id = t.id;
    update public.notifications set room_id = p_room_id where task_id = t.id;
  end if;

  return jsonb_build_object('ok', true, 'task_id', t.id, 'position', pos);
end;
$$;
revoke execute on function public.move_task_to_room(uuid, text, uuid, int) from public, anon;
grant execute on function public.move_task_to_room(uuid, text, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Copy a card (also how a card is made from a template)
--
-- p_keep: {"checklists", "labels", "members", "attachments", "dates": boolean, default true;
--          "template": boolean, default false (whether the copy is itself a template)}
-- Comments, activity and watchers are never copied.
-- ---------------------------------------------------------------------

create or replace function public.copy_task_to_room(
  p_task_id uuid,
  p_room_id text,
  p_category_id uuid,
  p_position int default null,
  p_title text default null,
  p_keep jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  err text;
  pos int;
  new_id uuid;
  keep jsonb := coalesce(p_keep, '{}'::jsonb);
  keep_files boolean := coalesce((keep ->> 'attachments')::boolean, true);
  new_title text;
begin
  select * into t from public.tasks where id = p_task_id;
  err := private.check_card_destination(t, p_room_id, p_category_id);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;
  new_title := coalesce(nullif(private.clean_text(p_title, 200), ''), t.title);
  pos := private.open_list_slot(p_category_id, p_position, null);

  insert into public.tasks (
    room_id, category_id, position, title, description, status, urgency, custom_fields,
    due_date, label_ids, checklists, member_ids, images, attachments, cover, is_template
  ) values (
    p_room_id, p_category_id, pos, new_title, t.description,
    private.option_in_room('status', t.status, p_room_id),
    private.option_in_room('urgency', t.urgency, p_room_id),
    private.custom_fields_in_room(t.custom_fields, t.room_id, p_room_id),
    case when coalesce((keep ->> 'dates')::boolean, true) then t.due_date end,
    case when coalesce((keep ->> 'labels')::boolean, true) then coalesce(array_remove(array(
      select distinct private.label_in_room(l, p_room_id) from unnest(t.label_ids) l
    ), null), '{}') else '{}' end,
    case when coalesce((keep ->> 'checklists')::boolean, true) then t.checklists else '[]'::jsonb end,
    case when coalesce((keep ->> 'members')::boolean, true) then t.member_ids else '{}' end,
    case when keep_files then t.images else '[]'::jsonb end,
    case when keep_files then t.attachments else '[]'::jsonb end,
    -- An image cover is one of the attachments, so it goes when they do.
    case when keep_files or t.cover ? 'color' then t.cover end,
    coalesce((keep ->> 'template')::boolean, false)
  )
  returning id into new_id;

  return jsonb_build_object('ok', true, 'task_id', new_id, 'position', pos);
end;
$$;
revoke execute on function public.copy_task_to_room(uuid, text, uuid, int, text, jsonb) from public, anon;
grant execute on function public.copy_task_to_room(uuid, text, uuid, int, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Board templates
--
-- p_template (everything optional):
-- {
--   "categories": {"status" | "urgency": {"name": text, "hidden": boolean, "default": value}},
--   "statuses":   [{"value", "label", "color"}],      -- extra Progress statuses
--   "urgencies":  [{"value", "label", "color"}],      -- extra Urgency statuses
--   "fields":     [{"name", "default": value, "options": [{"value", "label", "color"}]}],
--   "labels":     [{"name", "color"}],
--   "settings":   {"crossoffs": [{"field": "status" | "urgency" | <category name>, "value"}],
--                  "color_field": "status" | "urgency" | <category name> | null},
--   "lists":      [{"name", "wip_limit", "cards": [{
--                    "title", "description", "status", "urgency", "template": boolean,
--                    "labels": [label name], "fields": {<category name>: value},
--                    "checklists": [{"title", "items": [{"text", "done"}]}],
--                    "due_date": "YYYY-MM-DD" | "due_in_days": int,
--                    "attachments": [{"url", "name", "type", "size"}], "cover": {...}}]}]
-- }
-- Lists go after the room's own. Labels, statuses and categories the room already has (by name or
-- value) are reused, not duplicated.
--
-- "categories" and "settings" (Progress / Urgency names, defaults and visibility, Crossoffs, card
-- colour), and the defaults of categories the room already has, are the room's own choices: they're
-- only applied to a fresh room, one that has never had a list. Adding a template to a board in use
-- just adds to it.
-- ---------------------------------------------------------------------

-- A "YYYY-MM-DD" date, or null for anything else (including impossible dates like Feb 30).
create or replace function private.safe_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end;
$$;
revoke execute on function private.safe_date(text) from public, anon, authenticated;

create or replace function public.apply_board_template(p_room_id text, p_template jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tpl jsonb := coalesce(p_template, '{}'::jsonb);
  item jsonb;
  opt jsonb;
  list jsonb;
  card jsonb;
  fid uuid;
  cat_id uuid;
  base_pos int;
  list_i int := 0;
  card_i int;
  fields jsonb := '{}'::jsonb;  -- lower(category name) -> id
  val text;
  card_fields jsonb;
  card_labels uuid[];
  ty text;
  n_cards int := 0;
  n_lists int := 0;
  fresh boolean;
  created boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if not private.is_room_member(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_member');
  end if;
  if jsonb_typeof(tpl) <> 'object'
     or jsonb_array_length(coalesce(tpl -> 'lists', '[]')) > 50
     or (select count(*) from jsonb_array_elements(coalesce(tpl -> 'lists', '[]')) l,
                              jsonb_array_elements(coalesce(l -> 'cards', '[]'))) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_template');
  end if;
  -- Never had a list (archived ones count): the template may set the room's own choices too.
  fresh := not exists (select 1 from public.categories c where c.room_id = p_room_id);

  -- Progress / Urgency: names, whether they're shown, defaults, extra statuses.
  foreach ty in array array['status', 'urgency'] loop
    for opt in select * from jsonb_array_elements(coalesce(tpl -> (case ty when 'status' then 'statuses' else 'urgencies' end), '[]'))
    loop
      val := left(coalesce(opt ->> 'value', ''), 60);
      if val <> '' and coalesce(opt ->> 'label', '') <> '' and not exists (
        select 1 from public.task_options o where o.room_id = p_room_id and o.type = ty and o.value = val
      ) then
        insert into public.task_options (room_id, type, value, label, color)
        values (p_room_id, ty, val, private.clean_text(opt ->> 'label', 40),
                case when opt ->> 'color' ~ '^#[0-9a-fA-F]{6}$' then lower(opt ->> 'color') else '#71717a' end);
      end if;
    end loop;
    item := tpl -> 'categories' -> ty;
    if fresh and item is not null and jsonb_typeof(item) = 'object' then
      insert into public.task_field_category_names (room_id, field_type, name, default_value, is_deleted)
      values (
        p_room_id, ty,
        coalesce(nullif(private.clean_text(item ->> 'name', 40), ''), case ty when 'status' then 'Progress' else 'Urgency' end),
        coalesce(item ->> 'default', case ty when 'status' then 'not_started' else 'medium' end),
        coalesce((item ->> 'hidden')::boolean, false)
      )
      on conflict (room_id, field_type) do update set
        name = excluded.name, default_value = excluded.default_value, is_deleted = excluded.is_deleted;
    end if;
  end loop;

  -- Custom categories and their statuses.
  for item in select * from jsonb_array_elements(coalesce(tpl -> 'fields', '[]')) loop
    continue when coalesce(private.clean_text(item ->> 'name', 40), '') = '';
    select f.id into fid from public.task_custom_fields f
    where f.room_id = p_room_id and lower(f.name) = lower(private.clean_text(item ->> 'name', 40))
    order by f.created_at limit 1;
    created := fid is null;
    if created then
      insert into public.task_custom_fields (room_id, name)
      values (p_room_id, private.clean_text(item ->> 'name', 40))
      returning id into fid;
    end if;
    for opt in select * from jsonb_array_elements(coalesce(item -> 'options', '[]')) loop
      val := left(coalesce(opt ->> 'value', ''), 60);
      if val <> '' and coalesce(opt ->> 'label', '') <> '' and not exists (
        select 1 from public.task_custom_field_options o where o.field_id = fid and o.value = val
      ) then
        insert into public.task_custom_field_options (field_id, value, label, color)
        values (fid, val, private.clean_text(opt ->> 'label', 40),
                case when opt ->> 'color' ~ '^#[0-9a-fA-F]{6}$' then lower(opt ->> 'color') else '#71717a' end);
      end if;
    end loop;
    -- A category the room already had keeps its default (unless it never had one).
    update public.task_custom_fields f set default_value = coalesce(
      (select o.value from public.task_custom_field_options o
       where o.field_id = fid and o.value = item ->> 'default'
         and (created or fresh or f.default_value is null)),
      f.default_value,
      (select o.value from public.task_custom_field_options o
       where o.field_id = fid order by o.created_at limit 1))
    where f.id = fid;
    fields := fields || jsonb_build_object(lower(private.clean_text(item ->> 'name', 40)), fid);
    fid := null;
  end loop;

  -- Labels.
  for item in select * from jsonb_array_elements(coalesce(tpl -> 'labels', '[]')) loop
    if not exists (
      select 1 from public.task_labels l
      where l.room_id = p_room_id
        and lower(l.name) = lower(coalesce(private.clean_text(item ->> 'name', 40), ''))
        and (l.name <> '' or l.color = lower(item ->> 'color'))
    ) then
      insert into public.task_labels (room_id, name, color)
      values (p_room_id, coalesce(private.clean_text(item ->> 'name', 40), ''), coalesce(item ->> 'color', '#3b82f6'));
    end if;
  end loop;

  -- Crossoffs and the card colour, by category name.
  item := tpl -> 'settings';
  if fresh and item is not null and jsonb_typeof(item) = 'object' then
    insert into public.task_board_settings (room_id, crossoffs, color_field)
    values (
      p_room_id,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'field', case when r ->> 'field' in ('status', 'urgency') then r ->> 'field'
                        else fields ->> lower(r ->> 'field') end,
          'value', r ->> 'value'))
        from jsonb_array_elements(coalesce(item -> 'crossoffs', '[]')) r
        where r ->> 'field' in ('status', 'urgency') or fields ? lower(r ->> 'field')
      ), '[]'::jsonb),
      case when item ->> 'color_field' in ('status', 'urgency') then item ->> 'color_field'
           else fields ->> lower(item ->> 'color_field') end
    )
    on conflict (room_id) do update set
      crossoffs = excluded.crossoffs, color_field = excluded.color_field;
  end if;

  -- Lists and cards, after the room's own lists.
  select coalesce(max(c.position) + 1, 0) into base_pos
  from public.categories c where c.room_id = p_room_id;
  for list in select * from jsonb_array_elements(coalesce(tpl -> 'lists', '[]')) loop
    continue when coalesce(private.clean_text(list ->> 'name', 80), '') = '';
    insert into public.categories (room_id, name, position, wip_limit)
    values (
      p_room_id, private.clean_text(list ->> 'name', 80), base_pos + list_i,
      case when (list ->> 'wip_limit') ~ '^\d{1,3}$' and (list ->> 'wip_limit')::int >= 1
           then (list ->> 'wip_limit')::int end
    )
    returning id into cat_id;
    list_i := list_i + 1;
    n_lists := n_lists + 1;
    card_i := 0;
    for card in select * from jsonb_array_elements(coalesce(list -> 'cards', '[]')) loop
      continue when coalesce(private.clean_text(card ->> 'title', 200), '') = '';
      select coalesce(jsonb_object_agg(fields ->> lower(e.key), e.value), '{}'::jsonb) into card_fields
      from jsonb_each_text(coalesce(card -> 'fields', '{}')) e
      where fields ? lower(e.key)
        and exists (select 1 from public.task_custom_field_options o
                    where o.field_id = (fields ->> lower(e.key))::uuid and o.value = e.value);
      select coalesce(array_agg(distinct l.id), '{}') into card_labels
      from jsonb_array_elements_text(coalesce(card -> 'labels', '[]')) want
      join lateral (
        select x.id from public.task_labels x
        where x.room_id = p_room_id and lower(x.name) = lower(want)
        order by x.created_at limit 1
      ) l on true;
      insert into public.tasks (
        room_id, category_id, position, title, description, status, urgency,
        custom_fields, label_ids, checklists, is_template, due_date, attachments, cover
      ) values (
        p_room_id, cat_id, card_i,
        private.clean_text(card ->> 'title', 200),
        card ->> 'description',
        case when exists (select 1 from public.task_options o where o.room_id = p_room_id and o.type = 'status' and o.value = card ->> 'status')
             then card ->> 'status' end,
        case when exists (select 1 from public.task_options o where o.room_id = p_room_id and o.type = 'urgency' and o.value = card ->> 'urgency')
             then card ->> 'urgency' end,
        card_fields,
        card_labels,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', gen_random_uuid(),
            'title', coalesce(nullif(private.clean_text(cl ->> 'title', 200), ''), 'Checklist'),
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', gen_random_uuid(),
                'text', private.clean_text(it ->> 'text', 500),
                'done', coalesce((it ->> 'done')::boolean, false)))
              from jsonb_array_elements(coalesce(cl -> 'items', '[]')) it
              where coalesce(private.clean_text(it ->> 'text', 500), '') <> ''
            ), '[]'::jsonb)))
          from jsonb_array_elements(coalesce(card -> 'checklists', '[]')) cl
        ), '[]'::jsonb),
        coalesce((card ->> 'template')::boolean, false),
        coalesce(
          private.safe_date(card ->> 'due_date'),
          case when (card ->> 'due_in_days') ~ '^-?\d{1,4}$' then current_date + (card ->> 'due_in_days')::int end
        ),
        -- Files are links into storage; the app copies them into this room afterwards.
        coalesce((
          select jsonb_agg(a.value)
          from (
            select x.value from jsonb_array_elements(
              case when jsonb_typeof(card -> 'attachments') = 'array' then card -> 'attachments' else '[]'::jsonb end
            ) x
            where jsonb_typeof(x.value) = 'object' and jsonb_typeof(x.value -> 'url') = 'string'
            limit 100
          ) a
        ), '[]'::jsonb),
        case when jsonb_typeof(card -> 'cover') = 'object'
              and (card -> 'cover' ? 'color' or card -> 'cover' ? 'url') then card -> 'cover' end
      );
      card_i := card_i + 1;
      n_cards := n_cards + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'lists', n_lists, 'cards', n_cards);
end;
$$;
revoke execute on function public.apply_board_template(text, jsonb) from public, anon;
grant execute on function public.apply_board_template(text, jsonb) to authenticated;

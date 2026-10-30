-- =====================================================================
-- Board settings: several Crossoffs, and which category colours the card stripe.
--
--   crossoffs     [{"field": "status", "value": "completed"}, {"field": "urgency", ...}]
--                 One status per category at most. A card is crossed off (greyed out, struck
--                 through, sunk to the bottom) when ANY of them matches. Replaces the single
--                 done_field / done_value, which are kept but no longer read.
--   color_field   'status', 'urgency', a task_custom_fields id, or null for no colour:
--                 the category whose colour is the stripe on the left of each card.
--
-- Run after 20261030_optional_task_categories.sql. Safe to re-run: the Crossoff is copied from
-- done_field / done_value only when the column is first added.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_board_settings' and column_name = 'crossoffs'
  ) then
    alter table public.task_board_settings
      add column crossoffs jsonb not null default '[{"field": "status", "value": "completed"}]'::jsonb;
    update public.task_board_settings
    set crossoffs = jsonb_build_array(jsonb_build_object('field', done_field, 'value', done_value));
  end if;
end;
$$;

-- Urgency was the stripe colour until now.
alter table public.task_board_settings
  add column if not exists color_field text default 'urgency';

alter table public.task_board_settings
  drop constraint if exists task_board_settings_crossoffs_array;
alter table public.task_board_settings
  add constraint task_board_settings_crossoffs_array check (jsonb_typeof(crossoffs) = 'array');

alter table public.task_board_settings
  drop constraint if exists task_board_settings_color_field_len;
alter table public.task_board_settings
  add constraint task_board_settings_color_field_len
  check (color_field is null or char_length(color_field) between 1 and 60);

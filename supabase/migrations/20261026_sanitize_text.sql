-- =====================================================================
-- Text sanitisation, enforced by the database.
--
-- The app cleans text before saving (src/lib/sanitize.ts), but anyone with the anon key can
-- write to the API directly, so the same rules run here in BEFORE INSERT/UPDATE triggers:
--   - Unicode NFC normalisation
--   - strip control characters (keeping newlines/tabs in multi-line fields)
--   - strip bidi overrides/isolates (U+202A–202E, U+2066–2069), zero-width space, word joiner, BOM
--   - one-line fields: collapse whitespace; all fields: trim and cap length
--   - task option colours must be #rrggbb
--   - canvas items: text cleaned the same way; image src must be an embedded image or https
-- Length limits are also CHECK constraints (NOT VALID, so existing rows aren't re-checked).
--
-- Run after the earlier 20261026_* files. Safe to re-run.
-- =====================================================================

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

-- Runs as the table owner so the helper call isn't subject to the caller's EXECUTE rights.
create or replace function private.clean_row_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src text;
begin
  case tg_table_name
    when 'rooms' then
      new.name := private.clean_text(new.name, 48);
    when 'categories' then
      new.name := private.clean_text(new.name, 80);
    when 'tasks' then
      new.title := private.clean_text(new.title, 200);
      new.description := nullif(private.clean_text(new.description, 5000, true), '');
    when 'task_options' then
      new.label := private.clean_text(new.label, 40);
      new.color := case when new.color ~ '^#[0-9a-fA-F]{6}$' then lower(new.color) else '#71717a' end;
    when 'strokes' then
      if jsonb_typeof(new.data -> 'text') = 'string' then
        new.data := jsonb_set(new.data, '{text}',
          to_jsonb(private.clean_text(new.data ->> 'text', 4000, true)));
      end if;
      src := coalesce(new.data ->> 'src', new.data ->> 'imageDataUrl');
      if src is not null and src !~* '^(data:image/(png|jpe?g|gif|webp|avif|bmp);base64,|https://)' then
        new.data := new.data - 'src' - 'imageDataUrl';
      end if;
  end case;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['rooms', 'categories', 'tasks', 'task_options', 'strokes'] loop
    execute format('drop trigger if exists clean_text on public.%I', t);
    execute format(
      'create trigger clean_text before insert or update on public.%I
       for each row execute function private.clean_row_text()', t);
  end loop;
end $$;

-- Length / format limits (match LIMITS in src/lib/sanitize.ts).
do $$
declare c record;
begin
  for c in
    select * from (values
      ('categories',   'categories_name_len',      'char_length(name) between 1 and 80'),
      ('tasks',        'tasks_title_len',          'char_length(title) between 1 and 200'),
      ('tasks',        'tasks_description_len',    'description is null or char_length(description) <= 5000'),
      ('task_options', 'task_options_label_len',   'char_length(label) between 1 and 40'),
      ('task_options', 'task_options_color_hex',   'color ~ ''^#[0-9a-f]{6}$'''),
      ('strokes',      'strokes_data_size',        'octet_length(data::text) <= 2000000')
    ) as v(tbl, name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end $$;

revoke execute on function private.clean_text(text, int, boolean) from public, anon, authenticated;
revoke execute on function private.clean_row_text() from public, anon, authenticated;

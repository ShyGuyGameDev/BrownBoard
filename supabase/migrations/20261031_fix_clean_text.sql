-- =====================================================================
-- private.clean_text, which 20261031_cards_labels_comments.sql uses to tidy label names and
-- comments. It's defined in 20261026_sanitize_text.sql, but that migration didn't reach every
-- database, so creating a label or posting a comment failed with
-- "function private.clean_text(text, integer) does not exist".
-- Same definition as 20261026_sanitize_text.sql. Safe to re-run.
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

revoke execute on function private.clean_text(text, int, boolean) from public, anon, authenticated;

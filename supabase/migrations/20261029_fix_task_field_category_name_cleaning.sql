create or replace function private.clean_task_field_category_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is not null then
    new.name := left(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              normalize(new.name, NFC),
              '[\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]',
              '',
              'g'
            ),
            '[\x01-\x1F\x7F-\x9F]',
            ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      ),
      40
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.clean_task_field_category_name() from public, anon, authenticated;

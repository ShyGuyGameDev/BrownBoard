-- Allow signed-in users to change their room name without granting direct profile writes.
-- Keep a legacy username-only account's synthetic sign-in email in sync with its new name.
-- Safe to re-run.

create or replace function public.update_profile_name(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_username text := lower(btrim(p_username));
  v_placeholder text;
begin
  if v_user is null then
    raise exception 'You must be signed in to update your profile.' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Names must be 3–24 characters: letters, numbers and underscores.'
      using errcode = '22023';
  end if;

  select placeholder_email into v_placeholder
  from public.profiles
  where id = v_user
  for update;
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  if v_placeholder is not null then
    update auth.users
    set email = v_username || '@' || split_part(v_placeholder, '@', 2)
    where id = v_user and email = v_placeholder;
    if found then
      v_placeholder := v_username || '@' || split_part(v_placeholder, '@', 2);
      update public.profiles set placeholder_email = v_placeholder where id = v_user;
    end if;
  end if;

  update public.profiles set username = v_username where id = v_user;
  update public.room_members
  set display_name = v_username
  where user_id = v_user and not is_guest;

  return v_username;
end;
$$;

revoke all on function public.update_profile_name(text) from public, anon, authenticated;
grant execute on function public.update_profile_name(text) to authenticated;

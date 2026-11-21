-- =====================================================================
-- Email + password accounts (replacing username + password sign-up).
--
-- New accounts sign up with a real email. Their display name in rooms is still a username,
-- derived from the email's local part ("shaayer.alam@gmail.com" → "shaayeralam", with digits
-- added if taken), exactly like Google accounts.
-- Older username-only accounts keep working unchanged.
--
-- Run after the earlier 20261026_* files. Safe to re-run.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_signup_method_check;
alter table public.profiles add constraint profiles_signup_method_check
  check (signup_method in ('username', 'oauth', 'email'));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  tries int := 0;
  method text;
begin
  if new.is_anonymous then
    return new;
  end if;

  if new.raw_user_meta_data ? 'username' then
    -- Legacy username sign-up (placeholder email).
    method := 'username';
    candidate := lower(btrim(new.raw_user_meta_data ->> 'username'));
    if candidate !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'Usernames are 3–24 characters: letters, numbers and underscores.' using errcode = '22023';
    end if;
  else
    -- Email or Google: derive a username from their profile / email and make it unique.
    method := case when coalesce(new.raw_app_meta_data ->> 'provider', 'email') = 'email' then 'email' else 'oauth' end;
    base := lower(regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'preferred_username', new.raw_user_meta_data ->> 'name',
               split_part(new.email, '@', 1), 'user'),
      '[^a-zA-Z0-9_]', '', 'g'));
    base := left(base, 19);
    if length(base) < 3 then base := base || 'user'; end if;
    candidate := base;
    while exists (select 1 from public.profiles where username = candidate) and tries < 50 loop
      tries := tries + 1;
      candidate := base || (floor(random() * 9000) + 1000)::int;
    end loop;
  end if;

  insert into public.profiles (id, username, signup_method, placeholder_email)
  values (new.id, candidate, method, case when method = 'username' then new.email end);
  return new;
end;
$$;

-- After a legacy username sign-in fails: how does that account sign in instead?
create or replace function public.username_sign_in_method(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.signup_method = 'oauth' then 'google'
    when p.signup_method = 'email' then 'email'
    when u.email is distinct from p.placeholder_email then 'email'
    else 'password'
  end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(btrim(p_username));
$$;

-- Shared room-card banners, editable only by the room owner.

alter table public.rooms
  add column if not exists banner_color text
    check (banner_color is null or banner_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists banner_pattern text not null default 'dots'
    check (banner_pattern in ('none', 'dots', 'grid', 'stripes')),
  add column if not exists banner_image_path text;

grant select (banner_color, banner_pattern, banner_image_path)
  on public.rooms to authenticated;

create or replace function public.set_room_banner(
  p_room_id text,
  p_color text,
  p_pattern text,
  p_image_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_room_owner(p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_banner');
  end if;
  if p_pattern is null or p_pattern not in ('none', 'dots', 'grid', 'stripes') then
    return jsonb_build_object('ok', false, 'error', 'bad_banner');
  end if;
  if p_image_path is not null and (
    split_part(p_image_path, '/', 1) <> p_room_id
    or split_part(p_image_path, '/', 2) !~ '^banner-[0-9a-f-]{36}\.(png|jpg|webp)$'
    or array_length(string_to_array(p_image_path, '/'), 1) <> 2
  ) then
    return jsonb_build_object('ok', false, 'error', 'bad_banner');
  end if;

  update public.rooms
  set banner_color = p_color,
      banner_pattern = p_pattern,
      banner_image_path = p_image_path
  where id = p_room_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'room_id', p_room_id);
end;
$$;

revoke execute on function public.set_room_banner(text, text, text, text) from public, anon;
grant execute on function public.set_room_banner(text, text, text, text) to authenticated;

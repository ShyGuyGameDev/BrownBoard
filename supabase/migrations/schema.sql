-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  category_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'not_started'::text,
  urgency text NOT NULL DEFAULT 'medium'::text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT tasks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  type text NOT NULL CHECK (type = ANY (ARRAY['status'::text, 'urgency'::text])),
  value text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#71717a'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_options_pkey PRIMARY KEY (id),
  CONSTRAINT task_options_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.strokes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT strokes_pkey PRIMARY KEY (id),
  CONSTRAINT strokes_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'::text),
  signup_method text NOT NULL CHECK (signup_method = ANY (ARRAY['username'::text, 'oauth'::text])),
  placeholder_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.rooms (
  id text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'::text),
  name text NOT NULL CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 64),
  name_key text DEFAULT lower(btrim(name)),
  password_hash text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_edited_at timestamp with time zone NOT NULL DEFAULT now(),
  password_secret_id uuid,
  allow_guests boolean NOT NULL DEFAULT true,
  unnamed boolean NOT NULL DEFAULT false,
  CONSTRAINT rooms_pkey PRIMARY KEY (id),
  CONSTRAINT rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.room_members (
  room_id text NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL,
  is_guest boolean NOT NULL DEFAULT false,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  last_active_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id),
  CONSTRAINT room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
  CONSTRAINT room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
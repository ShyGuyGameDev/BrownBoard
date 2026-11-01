-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone,
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  category_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text DEFAULT 'not_started'::text,
  urgency text DEFAULT 'medium'::text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'::text AND jsonb_array_length(attachments) <= 100),
  due_date date,
  assignee_id uuid,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  label_ids ARRAY NOT NULL DEFAULT '{}'::uuid[],
  checklists jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover jsonb,
  member_ids ARRAY NOT NULL DEFAULT '{}'::uuid[],
  archived_at timestamp with time zone,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
  CONSTRAINT tasks_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
  CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id)
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
  avatar_url text,
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
CREATE TABLE public.task_custom_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  name text NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 40),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  default_value text,
  CONSTRAINT task_custom_fields_pkey PRIMARY KEY (id),
  CONSTRAINT task_custom_fields_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_custom_field_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  field_id uuid NOT NULL,
  value text NOT NULL,
  label text NOT NULL CHECK (char_length(label) >= 1 AND char_length(label) <= 40),
  color text NOT NULL DEFAULT '#71717a'::text CHECK (color ~ '^#[0-9a-f]{6}$'::text),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_custom_field_options_pkey PRIMARY KEY (id),
  CONSTRAINT task_custom_field_options_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.task_custom_fields(id)
);
CREATE TABLE public.task_field_category_names (
  room_id text NOT NULL,
  field_type text NOT NULL CHECK (field_type = ANY (ARRAY['status'::text, 'urgency'::text])),
  name text NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 40),
  default_value text,
  is_deleted boolean NOT NULL DEFAULT false,
  CONSTRAINT task_field_category_names_pkey PRIMARY KEY (room_id, field_type),
  CONSTRAINT task_field_category_names_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_board_settings (
  room_id text NOT NULL,
  done_field text NOT NULL DEFAULT 'status'::text CHECK (char_length(done_field) >= 1 AND char_length(done_field) <= 60),
  done_value text NOT NULL DEFAULT 'completed'::text CHECK (char_length(done_value) >= 1 AND char_length(done_value) <= 60),
  crossoffs jsonb NOT NULL DEFAULT '[{"field": "status", "value": "completed"}]'::jsonb CHECK (jsonb_typeof(crossoffs) = 'array'::text),
  color_field text DEFAULT 'urgency'::text CHECK (color_field IS NULL OR char_length(color_field) >= 1 AND char_length(color_field) <= 60),
  CONSTRAINT task_board_settings_pkey PRIMARY KEY (room_id),
  CONSTRAINT task_board_settings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_labels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  name text NOT NULL DEFAULT ''::text CHECK (char_length(name) <= 40),
  color text NOT NULL DEFAULT '#3b82f6'::text CHECK (color ~ '^#[0-9a-f]{6}$'::text),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_labels_pkey PRIMARY KEY (id),
  CONSTRAINT task_labels_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_watchers (
  task_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  room_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_watchers_pkey PRIMARY KEY (task_id, user_id),
  CONSTRAINT task_watchers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_watchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT task_watchers_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
CREATE TABLE public.task_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  task_id uuid NOT NULL,
  author_id uuid DEFAULT auth.uid(),
  author_name text NOT NULL DEFAULT ''::text,
  body text NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 4000),
  mentions ARRAY NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  edited_at timestamp with time zone,
  CONSTRAINT task_comments_pkey PRIMARY KEY (id),
  CONSTRAINT task_comments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
  CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  room_id text NOT NULL,
  task_id uuid,
  kind text NOT NULL,
  actor_name text NOT NULL DEFAULT ''::text,
  task_title text NOT NULL DEFAULT ''::text,
  body text NOT NULL DEFAULT ''::text,
  detail jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  read_at timestamp with time zone,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notifications_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id),
  CONSTRAINT notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.task_activity (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  room_id text NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL DEFAULT ''::text,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_activity_pkey PRIMARY KEY (id),
  CONSTRAINT task_activity_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT task_activity_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id)
);
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL DEFAULT 'room_1'::text,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL DEFAULT 'room_1'::text,
  category_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'not_started'::text,
  urgency text NOT NULL DEFAULT 'medium'::text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);
CREATE TABLE public.task_options (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL DEFAULT 'room_1'::text,
  type text NOT NULL CHECK (type = ANY (ARRAY['status'::text, 'urgency'::text])),
  value text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#71717a'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_options_pkey PRIMARY KEY (id)
);
CREATE TABLE public.strokes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  room_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT strokes_pkey PRIMARY KEY (id)
);
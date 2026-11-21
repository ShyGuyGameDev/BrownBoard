# Steps:

# Project Management

    Backlog
        Task
        Team member
        Due Date
        Urgency
        Notes
    Kanban style board
    You should be able to link tasks to the whiteboard

# Between Account Projects

    Ex: Shaayer can work on the same project from my account as Everett

# Whiteboard Expansion

    Import image

# Display Tab System

---

From OG Cursor:

# BrownBoard — Unified Canvas Platform

Single-canvas product design & development workspace for planning, drafting, prototyping, and project tracking. Frontend uses React + Vite + TypeScript with PixiJS for WebGL rendering; Supabase will power realtime sync and persistence.

## Getting started

```bash
npm install
npm run dev
```

Environment variables (create `.env`):

```
VITE_SUPABASE_URL=<your_supabase_url>
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>
```

## Tech stack

- React + TypeScript + Vite
- PixiJS for GPU canvas rendering
- Zustand for local canvas state
- React Query for async data
- Supabase client (auth + realtime) — optional until keys provided
- Vitest for unit tests

## Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — type-check then build
- `npm run lint` — ESLint with Prettier compatibility
- `npm test` — Vitest unit tests

## Project goals

- Dark-mode, 8px grid-aligned UI
- Single infinite canvas with drafting + prototyping tools
- Realtime collaboration via Supabase
- GitHub-linked tasks and file tree nodes
- Inline AI suggestions (no modals) aligned to the grid

## Supabase schema (excerpt)

- `canvas_objects`: JSON payload for all canvas entities
- `veins`: Action Veins connections
- `tasks`, `repos`, `files`, `links`: task metadata + GitHub file links
  See `supabase/schema.sql` for table definitions and policies.

## GitHub integration

- Use the GitHub panel on the right to drop a repo and file list onto the canvas.
- `Mark App.tsx changed` toggles change indicators and spawns an inline AI hint.
- Link a selected file to another selected object to propagate change context.

## AI assist

- Toolbar includes `AI tidy` to detect overlaps/clutter and render ghost suggestions.
- GitHub change events surface inline suggestion banners near impacted files.

hi

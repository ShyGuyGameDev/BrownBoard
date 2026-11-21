# Contributing

- Honor the 8px spacing grid; align toolbars, handles, and panels to multiples of 8px.
- Dark mode only. Background between `#0f1115` and `#151922`; use electric blue `#4da3ff` and soft violet `#8b7cff` for accents.
- Keep all workflows on the single canvas; avoid modal dialogs. Use inline edits and the properties panel.
- Default rendering goes through PixiJS; keep new canvas objects structured (no ad-hoc drawing).
- When adding new entities, include semantic metadata (`note`, `ui`, `logic`, `task`) and ensure they serialize cleanly to JSON.
- Prototyping logic must go through Action Veins (events + actions) rather than imperative handlers.
- Realtime: prefer batched upserts to Supabase and listen on existing channels.
- Tests: add/extend Vitest coverage for utilities and schema validation (`npm test`).
- Formatting: run `npm run lint` and `npm test` before sending changes.

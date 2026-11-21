-- =====================================================================
-- The built-in Status category is now called Progress (the app's default name changed too).
--
-- Saving any Status setting stored the name, so rooms still on the old default are renamed.
-- Rooms that gave it a different name keep it. Safe to re-run.
-- =====================================================================

update public.task_field_category_names
set name = 'Progress'
where field_type = 'status' and name = 'Status';

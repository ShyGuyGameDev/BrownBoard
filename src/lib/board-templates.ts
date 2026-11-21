/**
 * Board templates: ready-made rooms (lists, labels, categories, template cards) and copies of
 * rooms you're already in. Both become the same JSON, which apply_board_template writes into a room
 * (see 20261120_templates_wip_and_cross_board.sql for the shape it accepts).
 */
import { supabase } from './supabase'
import { readChecklists, readIds } from './cards'
import { readCustomFields } from './options'

export interface TemplateOption {
  value: string
  label: string
  color?: string
}

export interface TemplateCard {
  title: string
  description?: string
  status?: string | null
  urgency?: string | null
  /** This card is itself a card template. */
  template?: boolean
  /** Label names. */
  labels?: string[]
  /** Category name → status value. */
  fields?: Record<string, string>
  checklists?: { title: string; items: { text: string; done?: boolean }[] }[]
}

export interface TemplateList {
  name: string
  wip_limit?: number | null
  cards?: TemplateCard[]
}

export interface BoardTemplate {
  categories?: Partial<
    Record<'status' | 'urgency', { name?: string; hidden?: boolean; default?: string }>
  >
  statuses?: TemplateOption[]
  urgencies?: TemplateOption[]
  fields?: { name: string; default?: string | null; options: TemplateOption[] }[]
  labels?: { name: string; color: string }[]
  settings?: {
    /** field: 'status', 'urgency' or a category name */
    crossoffs: { field: string; value: string }[]
    color_field: string | null
  }
  lists: TemplateList[]
}

export interface BuiltInTemplate {
  id: string
  name: string
  description: string
  template: BoardTemplate
}

const story = (title: string, items: string[]) => ({ title, items: items.map((text) => ({ text })) })

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'kanban',
    name: 'Simple kanban',
    description: 'To do, Doing and Done, with a limit of 3 cards in progress.',
    template: {
      lists: [
        {
          name: 'To do',
          cards: [
            {
              title: 'Task',
              template: true,
              description: 'What needs doing, and how you’ll know it’s done.',
              checklists: [story('Done when', ['Works', 'Reviewed'])],
            },
          ],
        },
        { name: 'Doing', wip_limit: 3 },
        { name: 'Done' },
      ],
    },
  },
  {
    id: 'sprint',
    name: 'Sprint board',
    description: 'Backlog to Done with review, story points and a user story template.',
    template: {
      fields: [
        {
          name: 'Points',
          default: '1',
          options: [
            { value: '1', label: '1', color: '#22c55e' },
            { value: '2', label: '2', color: '#84cc16' },
            { value: '3', label: '3', color: '#eab308' },
            { value: '5', label: '5', color: '#f97316' },
            { value: '8', label: '8', color: '#ef4444' },
          ],
        },
      ],
      labels: [
        { name: 'Feature', color: '#3b82f6' },
        { name: 'Bug', color: '#ef4444' },
        { name: 'Chore', color: '#64748b' },
      ],
      lists: [
        {
          name: 'Backlog',
          cards: [
            {
              title: 'User story',
              template: true,
              labels: ['Feature'],
              fields: { Points: '3' },
              description: 'As a …, I want …, so that …',
              checklists: [story('Acceptance criteria', ['Given …, when …, then …'])],
            },
          ],
        },
        { name: 'Sprint' },
        { name: 'In progress', wip_limit: 4 },
        { name: 'Review', wip_limit: 3 },
        { name: 'Done' },
      ],
    },
  },
  {
    id: 'bugs',
    name: 'Bug tracker',
    description: 'Reported, triaged, fixed and verified, ranked by severity.',
    template: {
      categories: { urgency: { name: 'Severity', default: 'medium' } },
      labels: [
        { name: 'Frontend', color: '#a855f7' },
        { name: 'Backend', color: '#06b6d4' },
        { name: 'Regression', color: '#ef4444' },
      ],
      settings: { crossoffs: [{ field: 'status', value: 'completed' }], color_field: 'urgency' },
      lists: [
        {
          name: 'Reported',
          cards: [
            {
              title: 'Bug report',
              template: true,
              urgency: 'medium',
              description: 'What happened:\n\nWhat should have happened:\n\nWhere (page, device, version):',
              checklists: [story('Steps to reproduce', ['1.', '2.', '3.'])],
            },
          ],
        },
        { name: 'Triaged' },
        { name: 'Fixing', wip_limit: 3 },
        { name: 'Verifying' },
        { name: 'Closed' },
      ],
    },
  },
  {
    id: 'content',
    name: 'Content calendar',
    description: 'Ideas through to published, by channel. Pairs well with the calendar view.',
    template: {
      categories: { urgency: { hidden: true } },
      labels: [
        { name: 'Blog', color: '#3b82f6' },
        { name: 'Social', color: '#ec4899' },
        { name: 'Newsletter', color: '#eab308' },
        { name: 'Video', color: '#f97316' },
      ],
      lists: [
        {
          name: 'Ideas',
          cards: [
            {
              title: 'Post',
              template: true,
              description: 'Audience:\n\nKey message:\n\nCall to action:',
              checklists: [story('Before publishing', ['Draft', 'Edit', 'Images', 'Schedule'])],
            },
          ],
        },
        { name: 'Writing', wip_limit: 2 },
        { name: 'Editing' },
        { name: 'Scheduled' },
        { name: 'Published' },
      ],
    },
  },
  {
    id: 'personal',
    name: 'Weekly planner',
    description: 'Today, this week and later, with no more than 5 things on today.',
    template: {
      categories: { urgency: { hidden: true } },
      lists: [
        { name: 'Today', wip_limit: 5 },
        { name: 'This week' },
        { name: 'Later' },
        { name: 'Done' },
      ],
    },
  },
]

export async function applyBoardTemplate(roomId: string, template: BoardTemplate) {
  const { data, error } = await supabase.rpc('apply_board_template', {
    p_room_id: roomId,
    p_template: template,
  })
  if (error)
    throw new Error(
      error.code === 'PGRST202' ? 'Board templates need the latest database update.' : error.message,
    )
  if (!data?.ok)
    throw new Error(
      data?.error === 'not_member'
        ? "You aren't in that room any more."
        : data?.error === 'bad_template'
          ? 'That board is too big to copy (up to 50 lists and 1,000 cards).'
          : 'The template couldn’t be applied.',
    )
  return data as { ok: true; lists: number; cards: number }
}

// ---------- copying a room you're in ----------

/** The rows a room's board is made of (untyped, as the client returns them). */
export interface BoardRows {
  categories: { id: string; name: string; position: number | null; wip_limit?: number | null; archived_at?: string | null }[]
  tasks: {
    category_id: string
    title: string
    description?: string | null
    status?: string | null
    urgency?: string | null
    position?: number | null
    label_ids?: unknown
    custom_fields?: unknown
    checklists?: unknown
    is_template?: boolean | null
    archived_at?: string | null
  }[]
  labels: { id: string; name: string | null; color: string }[]
  options: { type: string; value: string; label: string; color: string | null }[]
  fields: { id: string; name: string; default_value: string | null }[]
  fieldOptions: { field_id: string; value: string; label: string; color: string | null }[]
  names: { field_type: string; name: string; default_value: string | null; is_deleted: boolean | null }[]
  settings: { crossoffs?: unknown; color_field?: string | null } | null
}

/**
 * A room's board as a template. Without `cards`, only its card templates come along (they're part
 * of how the board works); archived lists and cards never do.
 */
export function snapshotBoard(rows: BoardRows, { cards }: { cards: boolean }): BoardTemplate {
  const fieldName = new Map(rows.fields.map((f) => [f.id, f.name]))
  const labelName = new Map(rows.labels.map((l) => [l.id, l.name ?? '']))
  const nameOf = (field: string) =>
    field === 'status' || field === 'urgency' ? field : (fieldName.get(field) ?? null)

  const categories: BoardTemplate['categories'] = {}
  for (const n of rows.names) {
    if (n.field_type !== 'status' && n.field_type !== 'urgency') continue
    categories[n.field_type] = {
      name: n.name,
      hidden: !!n.is_deleted,
      ...(n.default_value ? { default: n.default_value } : {}),
    }
  }

  const crossoffs = Array.isArray(rows.settings?.crossoffs)
    ? (rows.settings!.crossoffs as { field?: unknown; value?: unknown }[]).flatMap((r) => {
        const field = typeof r?.field === 'string' ? nameOf(r.field) : null
        return field && typeof r.value === 'string' ? [{ field, value: r.value }] : []
      })
    : null

  const lists = rows.categories
    .filter((c) => !c.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(
      (c): TemplateList => ({
        name: c.name,
        wip_limit: c.wip_limit ?? null,
        cards: rows.tasks
          .filter((t) => t.category_id === c.id && !t.archived_at && (cards || t.is_template))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((t) => ({
            title: t.title,
            ...(t.description ? { description: t.description } : {}),
            status: t.status ?? null,
            urgency: t.urgency ?? null,
            template: !!t.is_template,
            labels: readIds(t.label_ids).flatMap((id) => {
              const name = labelName.get(id)
              return name ? [name] : []
            }),
            fields: Object.fromEntries(
              Object.entries(readCustomFields(t.custom_fields)).flatMap(([id, value]) => {
                const name = fieldName.get(id)
                return name ? [[name, value]] : []
              }),
            ),
            checklists: readChecklists(t.checklists).map((l) => ({
              title: l.title,
              items: l.items.map((i) => ({ text: i.text, done: i.done })),
            })),
          })),
      }),
    )

  const pick = (type: string) =>
    rows.options
      .filter((o) => o.type === type)
      .map((o) => ({ value: o.value, label: o.label, ...(o.color ? { color: o.color } : {}) }))

  return {
    categories,
    statuses: pick('status'),
    urgencies: pick('urgency'),
    fields: rows.fields.map((f) => ({
      name: f.name,
      default: f.default_value,
      options: rows.fieldOptions
        .filter((o) => o.field_id === f.id)
        .map((o) => ({ value: o.value, label: o.label, ...(o.color ? { color: o.color } : {}) })),
    })),
    // Unnamed labels can't be matched up by name on cards, but they still belong on the board.
    labels: rows.labels.map((l) => ({ name: l.name ?? '', color: l.color })),
    ...(crossoffs !== null || rows.settings
      ? {
          settings: {
            crossoffs: crossoffs ?? [],
            color_field:
              rows.settings && 'color_field' in rows.settings
                ? rows.settings.color_field
                  ? nameOf(rows.settings.color_field)
                  : null
                : 'urgency',
          },
        }
      : {}),
    lists,
  }
}

/** Reads a room you're a member of and returns it as a template. */
export async function loadBoardSnapshot(roomId: string, opts: { cards: boolean }) {
  const [c, t, l, o, f, n, s] = await Promise.all([
    supabase.from('categories').select('*').eq('room_id', roomId),
    supabase.from('tasks').select('*').eq('room_id', roomId),
    supabase.from('task_labels').select('*').eq('room_id', roomId).order('created_at'),
    supabase.from('task_options').select('*').eq('room_id', roomId).order('created_at'),
    supabase.from('task_custom_fields').select('*').eq('room_id', roomId).order('created_at'),
    supabase.from('task_field_category_names').select('*').eq('room_id', roomId),
    supabase.from('task_board_settings').select('*').eq('room_id', roomId).maybeSingle(),
  ])
  const failed = [c, t, o, f].find((r) => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const fieldIds = (f.data ?? []).map((x) => x.id)
  const fo = fieldIds.length
    ? await supabase
        .from('task_custom_field_options')
        .select('*')
        .in('field_id', fieldIds)
        .order('created_at')
    : { data: [], error: null }
  if (fo.error) throw new Error(fo.error.message)
  return snapshotBoard(
    {
      categories: c.data ?? [],
      tasks: t.data ?? [],
      labels: l.error ? [] : (l.data ?? []),
      options: o.data ?? [],
      fields: f.data ?? [],
      fieldOptions: fo.data ?? [],
      names: n.error ? [] : (n.data ?? []),
      settings: s.error ? null : (s.data ?? null),
    },
    opts,
  )
}

import React, { useEffect, useState } from 'react'
import { Copy, LayoutTemplate, X } from 'lucide-react'
import {
  BUILT_IN_TEMPLATES,
  type BoardTemplate,
  type BuiltInTemplate,
  loadBoardSnapshot,
} from './lib/board-templates'
import { myRooms } from './lib/rooms'

interface Props {
  title: string
  intro: string
  /** Signed in: their rooms can be copied too. */
  userId: string | null
  /** The room being filled, so it isn't offered as its own source. */
  excludeRoomId?: string
  onPick: (template: BoardTemplate, name: string) => Promise<void>
  onClose: () => void
}

/** A preview of a template's lists, as small columns. */
const ListPreview: React.FC<{ t: BuiltInTemplate }> = ({ t }) => (
  <span className="dv-tpl-preview" aria-hidden>
    {t.template.lists.slice(0, 5).map((l) => (
      <span key={l.name} className="dv-tpl-col">
        <span className="dv-tpl-col-name">{l.name}</span>
        {Array.from({ length: Math.min(3, Math.max(1, l.cards?.length ?? 0)) }, (_, i) => (
          <span key={i} className="dv-tpl-card" />
        ))}
      </span>
    ))}
  </span>
)

/** Choose a built-in board template, or copy the lists (and optionally cards) of one of your rooms. */
export const BoardTemplatePicker: React.FC<Props> = ({ title, intro, userId, excludeRoomId, onPick, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rooms, setRooms] = useState<{ id: string; name: string }[] | null>(null)
  const [source, setSource] = useState('')
  const [withCards, setWithCards] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    myRooms(userId)
      .then((all) => {
        if (cancelled) return
        const list = all
          .filter((r) => r.roomId !== excludeRoomId && !r.unnamed)
          .map((r) => ({ id: r.roomId, name: r.roomName }))
        setRooms(list)
        setSource(list[0]?.id ?? '')
      })
      .catch(() => !cancelled && setRooms([]))
    return () => {
      cancelled = true
    }
  }, [userId, excludeRoomId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const run = async (key: string, make: () => Promise<[BoardTemplate, string]>) => {
    setBusy(key)
    setError(null)
    try {
      const [template, name] = await make()
      await onPick(template, name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.')
      setBusy(null)
    }
  }

  return (
    <div
      className="dv-modal-backdrop z-[80]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <section
        className="dv-floating dv-modal dv-tpl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-template-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="board-template-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
              <LayoutTemplate size={18} aria-hidden />
              {title}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
              {intro}
            </p>
          </div>
          <button className="dv-iconbtn !h-7 !w-7" aria-label="Close" disabled={!!busy} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="dv-tpl-grid">
          {BUILT_IN_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="dv-tpl-option"
              disabled={!!busy}
              onClick={() => run(t.id, async () => [t.template, t.name])}
            >
              <ListPreview t={t} />
              <span className="dv-tpl-name">
                {t.name}
                {busy === t.id && <span className="dv-spinner" />}
              </span>
              <span className="dv-tpl-desc">{t.description}</span>
            </button>
          ))}
        </div>

        {userId && (
          <section className="dv-tpl-copy">
            <h3 className="dv-label m-0 flex items-center gap-1.5">
              <Copy size={13} aria-hidden />
              Copy one of your rooms
            </h3>
            {rooms === null ? (
              <p className="m-0 text-xs" style={{ color: 'var(--dv-muted)' }}>
                Loading your rooms…
              </p>
            ) : rooms.length === 0 ? (
              <p className="m-0 text-xs" style={{ color: 'var(--dv-muted)' }}>
                Rooms you’ve named will show up here.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="dv-input min-w-0 flex-1"
                  aria-label="Room to copy"
                  value={source}
                  disabled={!!busy}
                  onChange={(e) => setSource(e.target.value)}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <label className="dv-tick">
                  <input
                    type="checkbox"
                    checked={withCards}
                    disabled={!!busy}
                    onChange={(e) => setWithCards(e.target.checked)}
                  />
                  Include cards
                </label>
                <button
                  className="dv-btn primary"
                  disabled={!!busy || !source}
                  onClick={() =>
                    run('copy', async () => [
                      await loadBoardSnapshot(source, { cards: withCards }),
                      rooms.find((r) => r.id === source)?.name ?? 'room',
                    ])
                  }
                >
                  {busy === 'copy' && <span className="dv-spinner" />}
                  Copy
                </button>
              </div>
            )}
            <p className="m-0 text-[11.5px]" style={{ color: 'var(--dv-muted)' }}>
              Copies its lists, card limits, labels, categories and card templates. With cards, it
              copies those too, with their due dates and attachments, but not comments or members.
              A board that already has lists keeps its own settings.
            </p>
          </section>
        )}

        {error && (
          <p className="m-0 text-xs" role="alert" style={{ color: 'var(--dv-danger)' }}>
            {error}
          </p>
        )}
      </section>
    </div>
  )
}

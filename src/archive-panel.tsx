import React, { useState } from 'react'
import { Archive, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { relative } from './lib/time'

export interface ArchivedCard {
  id: string
  title: string
  listName: string
  /** The card's list is archived too (restoring the card brings it back). */
  listArchived: boolean
  archivedAt: string
}

export interface ArchivedList {
  id: string
  name: string
  cards: number
  archivedAt: string
}

/** Archived cards and lists: restore them, or delete them for good (asked first). */
export const ArchivePanel: React.FC<{
  cards: ArchivedCard[]
  lists: ArchivedList[]
  onRestoreCard: (id: string) => void
  onDeleteCard: (id: string) => void
  onRestoreList: (id: string) => void
  onDeleteList: (id: string) => void
  onClose: () => void
}> = ({ cards, lists, onRestoreCard, onDeleteCard, onRestoreList, onDeleteList, onClose }) => {
  const [tab, setTab] = useState<'cards' | 'lists'>('cards')
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const shownCards = cards.filter((c) => !q || c.title.toLowerCase().includes(q))
  const shownLists = lists.filter((l) => !q || l.name.toLowerCase().includes(q))

  return (
    <div
      className="dv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        className="dv-floating dv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-title"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="archive-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
              <Archive size={17} />
              Archive
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--dv-muted)' }}>
              Archived cards and lists are hidden from the board. Restore them any time.
            </p>
          </div>
          <button className="dv-iconbtn" aria-label="Close archive" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="dv-seg" role="tablist" aria-label="Archived items">
            <button
              role="tab"
              aria-selected={tab === 'cards'}
              data-active={tab === 'cards'}
              onClick={() => setTab('cards')}
            >
              Cards <span className="dv-kbd">{cards.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'lists'}
              data-active={tab === 'lists'}
              onClick={() => setTab('lists')}
            >
              Lists <span className="dv-kbd">{lists.length}</span>
            </button>
          </div>
          <label className="dv-archive-search">
            <Search size={14} aria-hidden />
            <input
              autoFocus
              placeholder={tab === 'cards' ? 'Search archived cards' : 'Search archived lists'}
              aria-label="Search the archive"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <ul className="dv-archive-list">
          {tab === 'cards' &&
            shownCards.map((c) => (
              <li key={c.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <div className="truncate text-xs" style={{ color: 'var(--dv-muted)' }}>
                    in {c.listName}
                    {c.listArchived && ' (archived list)'} · archived {relative(c.archivedAt)}
                  </div>
                </div>
                {confirm === c.id ? (
                  <ConfirmDelete
                    what="this card"
                    onYes={() => {
                      setConfirm(null)
                      onDeleteCard(c.id)
                    }}
                    onNo={() => setConfirm(null)}
                  />
                ) : (
                  <>
                    <button
                      className="dv-btn !h-8"
                      title={c.listArchived ? 'Restores its list too' : undefined}
                      onClick={() => onRestoreCard(c.id)}
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                    <button
                      className="dv-iconbtn danger !h-8 !w-8"
                      title="Delete forever"
                      aria-label={`Delete “${c.title}” forever`}
                      onClick={() => setConfirm(c.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </li>
            ))}
          {tab === 'lists' &&
            shownLists.map((l) => (
              <li key={l.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name}</div>
                  <div className="truncate text-xs" style={{ color: 'var(--dv-muted)' }}>
                    {l.cards} {l.cards === 1 ? 'card' : 'cards'} · archived {relative(l.archivedAt)}
                  </div>
                </div>
                {confirm === l.id ? (
                  <ConfirmDelete
                    what={
                      l.cards
                        ? `this list and its ${l.cards} ${l.cards === 1 ? 'card' : 'cards'}`
                        : 'this list'
                    }
                    onYes={() => {
                      setConfirm(null)
                      onDeleteList(l.id)
                    }}
                    onNo={() => setConfirm(null)}
                  />
                ) : (
                  <>
                    <button className="dv-btn !h-8" onClick={() => onRestoreList(l.id)}>
                      <RotateCcw size={13} />
                      Restore
                    </button>
                    <button
                      className="dv-iconbtn danger !h-8 !w-8"
                      title="Delete forever"
                      aria-label={`Delete the list “${l.name}” forever`}
                      onClick={() => setConfirm(l.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </li>
            ))}
          {((tab === 'cards' && shownCards.length === 0) ||
            (tab === 'lists' && shownLists.length === 0)) && (
            <li className="dv-archive-empty">
              {q
                ? 'Nothing matches.'
                : tab === 'cards'
                  ? 'No archived cards.'
                  : 'No archived lists.'}
            </li>
          )}
        </ul>
      </section>
    </div>
  )
}

const ConfirmDelete: React.FC<{ what: string; onYes: () => void; onNo: () => void }> = ({
  what,
  onYes,
  onNo,
}) => (
  <div className="flex shrink-0 items-center gap-1.5" role="alert">
    <span className="text-xs" style={{ color: 'var(--dv-muted)' }}>
      Delete {what} forever?
    </span>
    <button className="dv-btn danger !h-8" autoFocus onClick={onYes}>
      Delete
    </button>
    <button className="dv-btn !h-8" onClick={onNo}>
      Cancel
    </button>
  </div>
)

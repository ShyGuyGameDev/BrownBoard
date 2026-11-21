import React, { useEffect, useRef } from 'react'
import { Keyboard, X } from 'lucide-react'
import { SHORTCUT_GROUPS } from './lib/shortcuts'

const Keys: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="dv-keys">
    {keys.map((k, i) => (
      <React.Fragment key={k}>
        {i > 0 && <span aria-hidden>+</span>}
        <kbd className="dv-kbd">{k}</kbd>
      </React.Fragment>
    ))}
  </span>
)

/** The "?" dialog: every board shortcut, grouped. */
export const ShortcutsHelp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="dv-modal-backdrop z-[85]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className="dv-floating dv-modal dv-shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="shortcuts-title" className="m-0 flex items-center gap-2 text-lg font-semibold">
              <Keyboard size={18} aria-hidden />
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--dv-muted)' }}>
              Card shortcuts act on the card you’ve selected with the arrow keys, or the one under
              the pointer. They’re off while you type in a field.
            </p>
          </div>
          <button className="dv-iconbtn !h-7 !w-7" aria-label="Close shortcuts" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="dv-shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="dv-label m-0 mb-1.5">{group.title}</h3>
              <dl className="m-0">
                {group.items.map((s) => (
                  <div key={s.label} className="dv-shortcut-row">
                    <dt>
                      <Keys keys={s.keys} />
                      {s.alt && (
                        <>
                          <span className="dv-shortcut-or">or</span>
                          <Keys keys={s.alt} />
                        </>
                      )}
                    </dt>
                    <dd>{s.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}

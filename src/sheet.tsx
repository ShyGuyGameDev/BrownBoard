import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBackToClose } from './lib/back-to-close'

/** How far down a sheet is dragged before letting go closes it. */
const DISMISS_PX = 96

/**
 * A bottom sheet for short, focused tasks on phones (sharing, settings, menus). Closes with the
 * X, a tap on the scrim, Esc, Back, or a drag down on its top edge.
 */
export const Sheet: React.FC<{
  title: string
  onClose: () => void
  children: React.ReactNode
}> = ({ title, onClose, children }) => {
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; id: number } | null>(null)
  const [dy, setDy] = useState(0)
  useBackToClose(onClose)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="dv-sheet-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dv-sheet"
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      >
        <header
          className="dv-sheet-head"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { y: e.clientY, id: e.pointerId }
          }}
          onPointerMove={(e) => {
            if (drag.current?.id === e.pointerId) setDy(Math.max(0, e.clientY - drag.current.y))
          }}
          onPointerUp={() => {
            drag.current = null
            if (dy > DISMISS_PX) onClose()
            else setDy(0)
          }}
          onPointerCancel={() => {
            drag.current = null
            setDy(0)
          }}
        >
          <span className="dv-sheet-grip" aria-hidden="true" />
          <h2>{title}</h2>
          <button type="button" className="dv-iconbtn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="dv-sheet-body dv-scroll">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

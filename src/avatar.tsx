import React, { useState } from 'react'
import { initials } from './lib/room'

/**
 * A person's round avatar: their profile picture, or their initials on their colour (also the
 * fallback if the picture fails to load). Extra props (title, data-tip, classes) go on the circle.
 */
export const Avatar: React.FC<
  {
    name: string
    color: string
    src?: string | null
    /** Diameter in px. */
    size?: number
  } & React.HTMLAttributes<HTMLSpanElement>
> = ({ name, color, src, size = 28, className = '', style, ...rest }) => {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = !!src && failed !== src
  return (
    <span
      className={`dv-avatar-circle ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.36)),
        background: showImage ? 'var(--dv-panel-2)' : color,
        ...style,
      }}
      {...rest}
    >
      {showImage ? (
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
      ) : (
        initials(name)
      )}
    </span>
  )
}

import { Ticket } from 'lucide-react'
import { useState } from 'react'
import type { Drop } from '@/api'
import { formatDay } from '@/lib/format'
import { cn } from '@/lib/utils'

// Three tones from the palette, picked from the id so a given drop always looks the same.
const tones = [
  'bg-primary text-white',
  'bg-ink text-bg',
  'bg-primary-soft text-primary-text',
]

function toneFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return tones[h % tones.length]
}

// The tinted tile is drawn straight away and costs nothing. If the drop has artwork it
// loads on top and fades in, so a slow or broken image never leaves a hole or moves the layout.
export default function Poster({ drop, className }: { drop: Drop; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const day = formatDay(drop.drawAt)

  return (
    <div className={cn('relative grid place-items-center overflow-hidden rounded-tile', toneFor(drop.id), className)}>
      <Ticket aria-hidden className="size-1/3 opacity-90" strokeWidth={1.75} />
      {drop.posterUrl && state !== 'failed' && (
        <img
          key={drop.posterUrl}
          src={drop.posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          // Already cached images can finish before the load handler is attached.
          ref={(el) => { if (el?.complete && el.naturalWidth > 0) setState('loaded') }}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-300',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded-lg bg-surface px-2 py-1 text-[0.75rem] leading-none font-bold text-ink tabular-nums">
        {day.day} {day.month}
      </span>
    </div>
  )
}

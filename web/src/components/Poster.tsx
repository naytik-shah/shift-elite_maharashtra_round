import { useState } from 'react'
import type { Drop } from '@/api'
import { cn } from '@/lib/utils'
import EventArt from './EventArt'

// Key art for a drop. A posterUrl from the backend loads over the drawn art and fades in,
// so a slow or broken image never leaves a hole or moves the layout.
export default function Poster({ drop, className }: { drop: Drop; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  return (
    <div className={cn('relative overflow-hidden bg-fill', className)}>
      <EventArt drop={drop} className="absolute inset-0 size-full" />
      {drop.posterUrl && state !== 'failed' && (
        <img
          key={drop.posterUrl}
          src={drop.posterUrl}
          alt=""
          width={640}
          height={400}
          loading="lazy"
          decoding="async"
          ref={(el) => { if (el?.complete && el.naturalWidth > 0) setState('loaded') }}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', state === 'loaded' ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </div>
  )
}

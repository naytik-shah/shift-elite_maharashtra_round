import { Cpu, Laugh, Music2, Trophy } from 'lucide-react'
import type { Drop, EventCategory } from '@/api'
import { formatDay } from '@/lib/format'
import { cn } from '@/lib/utils'

const icons: Record<EventCategory, typeof Music2> = { Music: Music2, Comedy: Laugh, Sports: Trophy, Tech: Cpu }

// Three tones from the existing palette, picked from the id so a given event always looks the same.
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

// No photos to download, so a card costs nothing to render even when the list is long.
export default function Poster({ drop, className }: { drop: Drop; className?: string }) {
  const Icon = drop.category ? icons[drop.category] : Music2
  const day = formatDay(drop.eventAt ?? drop.windowClosesAt)
  return (
    <div aria-hidden className={cn('relative grid place-items-center overflow-hidden rounded-tile', toneFor(drop.id), className)}>
      <Icon className="size-1/3 opacity-90" strokeWidth={1.75} />
      <span className="absolute bottom-1.5 left-1.5 rounded-lg bg-surface px-2 py-1 text-xs leading-none font-bold text-ink tabular-nums">
        {day.day} {day.month}
      </span>
    </div>
  )
}

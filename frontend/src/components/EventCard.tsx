import { ChevronRight } from 'lucide-react'
import type { Drop, Entry } from '@/api'
import { statusBadge, timeLine, venueLine } from '@/lib/eventStatus'
import { href } from '@/lib/router'
import { Badge } from './ui/badge'
import Poster from './Poster'

export default function EventCard({ drop, entry }: { drop: Drop; entry?: Entry | null }) {
  const badge = statusBadge(drop, entry)
  return (
    <a
      href={href('event', drop.id)}
      className="flex items-center gap-3.5 rounded-card bg-surface p-3 transition-opacity active:opacity-80"
    >
      <Poster drop={drop} className="size-24 shrink-0" />
      <div className="min-w-0 flex-1 py-1">
        <Badge tone={badge.tone} dot={badge.dot}>{badge.label}</Badge>
        <h3 className="mt-1.5 line-clamp-2 text-base leading-snug font-semibold">{drop.name}</h3>
        <p className="truncate text-sm text-muted">{venueLine(drop)}</p>
        <p className="truncate text-xs text-muted">{timeLine(drop)}</p>
      </div>
      <ChevronRight className="mr-1 size-5 shrink-0 text-muted" aria-hidden />
    </a>
  )
}

import { ChevronRight } from 'lucide-react'
import type { Drop, Entry } from '@/api'
import { statusBadge } from '@/lib/eventStatus'
import { formatNumber } from '@/lib/format'
import { href } from '@/lib/router'
import { Badge } from './ui/badge'
import Poster from './Poster'

export default function EventCard({ drop, entry }: { drop: Drop; entry?: Entry | null }) {
  const badge = statusBadge(drop, entry)
  return (
    <a
      href={href('drop', drop.id)}
      className="surface flex items-center gap-3.5 rounded-card p-2.5 transition-opacity active:opacity-80"
    >
      <Poster drop={drop} className="size-[5.5rem] shrink-0" />
      <div className="min-w-0 flex-1">
        <Badge tone={badge.tone} dot={badge.dot}>{badge.label}</Badge>
        <h3 className="type-headline mt-1.5 truncate">{drop.name}</h3>
        <p className="type-caption truncate">{formatNumber(drop.seats)} seats</p>
      </div>
      <ChevronRight className="mr-1.5 size-5 shrink-0 text-muted" aria-hidden />
    </a>
  )
}

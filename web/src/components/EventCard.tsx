import type { Drop, Entry } from '@/api'
import { statusBadge } from '@/lib/eventStatus'
import { formatDay, formatNumber, formatPrice } from '@/lib/format'
import { href } from '@/lib/router'
import Poster from './Poster'
import { Badge } from './ui/badge'

export default function EventCard({ drop, entry }: { drop: Drop; entry?: Entry | null }) {
  const badge = statusBadge(drop, entry)
  const day = formatDay(drop.eventAt ?? drop.drawAt)
  const place = [drop.venue, drop.city].filter(Boolean).join(', ')
  return (
    <a
      href={href('drop', drop.id)}
      className="group block overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-muted/60 focus-visible:outline-2"
    >
      <div className="relative">
        <Poster drop={drop} className="aspect-[16/10] transition-transform duration-500 group-hover:scale-[1.02]" />
        <Badge tone={badge.tone} dot={badge.dot} className="absolute top-3 left-3 border border-line bg-surface text-ink">
          {badge.label}
        </Badge>
      </div>
      <div className="p-4">
        <h3 className="type-headline truncate">{drop.name}</h3>
        <p className="type-caption mt-0.5 truncate">
          {day.day} {day.month}{place ? `, ${place}` : ''}
        </p>
        <p className="type-caption mt-3 flex justify-between tabular-nums">
          <span>{formatNumber(drop.seats)} seats</span>
          <span>{drop.ticketPrice != null ? formatPrice(drop.ticketPrice) : 'Free to enter'}</span>
        </p>
      </div>
    </a>
  )
}

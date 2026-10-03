import type { Drop, Ticket } from '@/api'
import { formatDay } from '@/lib/format'
import { Badge } from './ui/badge'

export default function TicketCard({ ticket, drop, holder }: { ticket: Ticket; drop: Drop; holder: string }) {
  const day = formatDay(drop.eventAt ?? drop.windowClosesAt)
  return (
    <article className="w-full animate-rise overflow-hidden rounded-card bg-surface">
      <div className="bg-primary p-5 text-white sm:p-6">
        <p className="text-xs font-semibold">Fair Drop</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-balance">{drop.name}</h2>
        <p className="mt-1 text-sm">{day.full}</p>
        {drop.venue && <p className="text-sm">{[drop.venue, drop.city].filter(Boolean).join(', ')}</p>}
      </div>

      {/* the notches are just circles in the page colour sitting on the tear line */}
      <div className="relative">
        <span aria-hidden className="absolute top-0 -left-3 size-6 -translate-y-1/2 rounded-full bg-bg" />
        <span aria-hidden className="absolute top-0 -right-3 size-6 -translate-y-1/2 rounded-full bg-bg" />
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Seat</p>
            <p className="text-[3.5rem] leading-none font-bold tracking-tight tabular-nums">{ticket.seatNo}</p>
          </div>
          <Badge tone="ok">Confirmed</Badge>
        </div>
        <dl className="mt-5 divide-y divide-line border-t border-line text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Holder</dt>
            <dd className="min-w-0 truncate font-semibold">{holder}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted">Ticket</dt>
            <dd className="font-mono font-semibold">{ticket.id}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">Named to the holder. It cannot be transferred or resold.</p>
      </div>
    </article>
  )
}

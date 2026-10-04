import type { Drop, Ticket } from '@/api'
import { formatDateTime } from '@/lib/format'
import { Badge } from './ui/badge'

// Two halves that each have a corner bitten out, so the notches are real holes and the
// page shows through them. The drop shadow follows the cut shape.
export default function TicketCard({ ticket, drop }: { ticket: Ticket; drop?: Drop }) {
  return (
    <article className="w-full animate-rise [filter:drop-shadow(0_12px_18px_rgb(96_44_16/0.14))]">
      <div className="notch-bottom rounded-t-card bg-primary p-5 pb-6 text-white sm:px-6">
        <h2 className="type-title text-balance">{drop?.name ?? ticket.dropId}</h2>
        {drop && <p className="mt-1 text-[0.8125rem]">Drawn {formatDateTime(drop.drawAt)}</p>}
      </div>

      <div className="notch-top rounded-b-card bg-surface px-5 pb-5 sm:px-6">
        <div className="border-t border-dashed border-line pt-5" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="type-caption">Seat</p>
            <p className="type-figure">{ticket.slotNo}</p>
          </div>
          <Badge tone="ok">Confirmed</Badge>
        </div>
        <dl className="mt-4 divide-y divide-line border-t border-line">
          <div className="flex justify-between gap-4 py-3">
            <dt className="type-body">Name</dt>
            <dd className="type-strong min-w-0 truncate">{ticket.holderName}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="type-body shrink-0">Ticket</dt>
            <dd className="type-strong min-w-0 truncate font-mono" title={ticket.id}>{ticket.id}</dd>
          </div>
        </dl>
        <p className="type-caption">Named ticket. It cannot be transferred.</p>
      </div>
    </article>
  )
}

import type { Drop, Ticket } from '@/api'
import { formatDateTime } from '@/lib/format'
import { groupRef, readPayInfo } from '@/lib/payInfo'
import Qr from './Qr'
import { Badge } from './ui/badge'

// Two halves that each have a corner bitten out, so the notches are real holes and the
// page shows through them. The drop shadow follows the cut shape.
export default function TicketCard({ ticket, drop }: { ticket: Ticket; drop?: Drop }) {
  const paid = readPayInfo(ticket.id)
  const qrText = `FAIRDROP|${ticket.dropId}|${ticket.id}|${ticket.cardRef ?? ''}|${ticket.holderEmail ?? ''}`
  return (
    <article className="w-full animate-rise [filter:drop-shadow(0_10px_16px_rgb(0_0_0/0.14))]">
      <div className="notch-bottom rounded-t-card bg-primary p-5 pb-6 text-primary-fg sm:px-6">
        <h2 className="type-title text-balance">{drop?.name ?? ticket.dropId}</h2>
        {drop && <p className="mt-1 text-[0.8125rem]">Drawn {formatDateTime(drop.drawAt)}</p>}
      </div>

      <div className="notch-top rounded-b-card bg-surface px-5 pb-5 sm:px-6">
        <div className="border-t border-dashed border-line pt-5" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="type-caption">Seat</p>
            <p className="type-figure">{ticket.slotNo}</p>
            <Badge tone="ok" className="mt-2">Confirmed</Badge>
          </div>
          <Qr text={qrText} size={96} label={`QR code for ticket ${ticket.id}`} />
        </div>
        <dl className="mt-4 divide-y divide-line border-t border-line">
          <div className="flex justify-between gap-4 py-3">
            <dt className="type-body shrink-0">Name</dt>
            <dd className="type-strong min-w-0 truncate">{ticket.holderName}</dd>
          </div>
          {ticket.holderEmail && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="type-body shrink-0">Account</dt>
              <dd className="type-strong min-w-0 break-all text-right">{ticket.holderEmail}</dd>
            </div>
          )}
          {(paid || ticket.cardRef) && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="type-body shrink-0">Paid with</dt>
              <dd className="type-strong min-w-0 text-right">
                {paid ? (paid.method === 'upi' ? `UPI ${paid.masked}` : paid.masked) : 'One payment method'}
                {ticket.cardRef && <span className="type-caption block font-mono tabular-nums">Ref {groupRef(ticket.cardRef)}</span>}
              </dd>
            </div>
          )}
          {paid?.utr && (
            <div className="flex justify-between gap-4 py-3">
              <dt className="type-body shrink-0">UPI transaction</dt>
              <dd className="type-strong font-mono tabular-nums">{paid.utr}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 py-3">
            <dt className="type-body shrink-0">Ticket</dt>
            <dd className="type-strong min-w-0 truncate font-mono" title={ticket.id}>{ticket.id}</dd>
          </div>
        </dl>
        <p className="type-caption">Issued to this account and tied to one payment method, so one payment gives one ticket. Named, and it cannot be transferred.</p>
      </div>
    </article>
  )
}

import type { Drop, DropState } from '@/api'
import { useCountdown } from '@/hooks/useCountdown'
import { formatAmount, formatDay, formatNumber, formatTime } from '@/lib/format'
import { venueLine } from '@/lib/eventStatus'

const stateLabel: Record<DropState, string> = {
  ANNOUNCED: 'Opening soon',
  OPEN: 'Entries open',
  CLOSED: 'Entries closed',
  SCORING: 'Checking entries',
  DRAWN: 'Draw complete',
  CONFIRMING: 'Winners confirming',
  COMPLETE: 'Drop complete',
}

// Quarter circle of page colour that rounds the inside corner where the date tab meets the card.
const inner = { background: 'radial-gradient(circle at 100% 100%, transparent 1.125rem, var(--bg) calc(1.125rem + 0.5px))' }

export default function DropHero({ drop, level = 1 }: { drop: Drop; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const open = drop.state === 'OPEN'
  const soon = drop.state === 'ANNOUNCED'
  const cd = useCountdown(open ? drop.windowClosesAt : soon ? drop.windowOpensAt : null)
  const day = formatDay(drop.eventAt ?? drop.windowClosesAt)
  const live = open || drop.state === 'CONFIRMING'

  return (
    <section className="relative animate-rise rounded-card bg-primary text-white">
      {/* date tab cut out of the top left corner */}
      <div className="absolute top-0 left-0 rounded-br-[1.625rem] bg-bg pr-2 pb-2">
        <div className="w-[4.75rem] rounded-[1.125rem] bg-surface py-2.5 text-center text-ink">
          <p className="text-lg leading-none font-bold tabular-nums">{day.day} {day.month}</p>
          <p className="mt-1 text-xs text-muted">{day.year}</p>
        </div>
        <span aria-hidden className="absolute top-0 left-full size-[1.125rem]" style={inner} />
        <span aria-hidden className="absolute top-full left-0 size-[1.125rem]" style={inner} />
      </div>

      <div className="min-h-[5.25rem] pb-1 pt-4 pr-5 pl-[6.25rem] sm:pr-6">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          {live && <span className="size-1.5 animate-pulse-dot rounded-full bg-white" aria-hidden />}
          {stateLabel[drop.state]}
        </p>
        <Heading className="mt-1 text-xl font-bold tracking-tight text-balance sm:text-2xl">{drop.name}</Heading>
        {venueLine(drop) && <p className="mt-0.5 text-sm">{venueLine(drop)}</p>}
      </div>

      <div className="p-2.5 pt-4">
        <div className="flex items-center justify-between gap-4 rounded-[1.25rem] bg-surface px-4 py-3 text-ink sm:px-5">
          <div>
            <p className="text-xs text-muted">
              {open ? 'Entries close in' : soon ? 'Entries open in' : 'Entries closed at'}
            </p>
            <p className="text-2xl font-bold tracking-tight tabular-nums">
              {open || soon ? cd.label : formatTime(drop.windowClosesAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-base font-semibold tabular-nums">{formatNumber(drop.seats)} seats</p>
            <p className="text-xs text-muted">{formatAmount(drop.holdAmount, drop.currency)} refundable hold</p>
          </div>
        </div>
      </div>
    </section>
  )
}

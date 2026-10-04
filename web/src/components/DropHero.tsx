import type { Drop } from '@/api'
import { useCountdown } from '@/hooks/useCountdown'
import { phaseLabel, phaseOf } from '@/lib/eventStatus'
import { formatDateTime, formatNumber, formatPrice, formatTime } from '@/lib/format'
import Poster from './Poster'

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <dt className="type-caption">{label}</dt>
      <dd className="type-headline mt-0.5 whitespace-nowrap tabular-nums">{value}</dd>
      {hint && <p className="type-caption">{hint}</p>}
    </div>
  )
}

export default function DropHero({ drop, level = 1 }: { drop: Drop; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const first = phaseOf(drop)
  const cd = useCountdown(first === 'open' ? drop.windowClosesAt : first === 'upcoming' ? drop.windowOpensAt : null)
  // Read again after the countdown hook, which rerenders this at zero.
  const phase = cd.done ? phaseOf(drop) : first
  const counting = phase === 'open' || phase === 'upcoming'
  const live = phase === 'open' || phase === 'drawn'
  const place = [drop.venue, drop.city].filter(Boolean).join(', ')

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="relative">
        <Poster drop={drop} className="aspect-[16/10] sm:aspect-[5/2]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" aria-hidden />
        <span className="absolute top-3 left-3 inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[0.75rem] leading-none font-semibold text-ink">
          {live && <span className="size-1.5 animate-pulse-dot rounded-full bg-primary" aria-hidden />}
          {phaseLabel[phase]}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
          <Heading className="type-title text-balance text-white drop-shadow-sm">{drop.name}</Heading>
          <p className="mt-1 text-[0.8125rem] text-white/85">
            {place ? `${place}, ` : ''}{formatDateTime(drop.eventAt ?? drop.drawAt)}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-line border-t border-line">
        <Fact label={phase === 'open' ? 'Closes in' : phase === 'upcoming' ? 'Opens in' : 'Closed at'} value={counting ? cd.label : formatTime(drop.windowClosesAt)} />
        <Fact label="Seats" value={formatNumber(drop.seats)} />
        <Fact label="If you win" value={drop.ticketPrice != null ? formatPrice(drop.ticketPrice) : 'Free'} />
      </dl>
    </section>
  )
}

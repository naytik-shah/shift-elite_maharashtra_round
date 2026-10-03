import type { Drop } from '@/api'
import { useCountdown } from '@/hooks/useCountdown'
import { phaseLabel, phaseOf } from '@/lib/eventStatus'
import { formatDateTime, formatDay, formatNumber, formatPrice, formatTime } from '@/lib/format'

export default function DropHero({ drop, level = 1 }: { drop: Drop; level?: 1 | 2 }) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const first = phaseOf(drop)
  const cd = useCountdown(first === 'open' ? drop.windowClosesAt : first === 'upcoming' ? drop.windowOpensAt : null)
  // Read again after the countdown hook, which rerenders this at zero.
  const phase = cd.done ? phaseOf(drop) : first
  const counting = phase === 'open' || phase === 'upcoming'
  const day = formatDay(drop.drawAt)
  const live = phase === 'open' || phase === 'drawn'

  return (
    <section className="relative animate-rise">
      {/* draw date tab, sitting in the corner the mask cuts out of the card below */}
      <div className="absolute top-0 left-0 grid h-16 w-[4.75rem] place-content-center rounded-tile border border-line bg-surface text-center">
        <p className="type-headline leading-none tabular-nums">{day.day} {day.month}</p>
        <p className="type-caption mt-1 leading-none">{day.year}</p>
      </div>

      <div className="hero-cut rounded-card bg-primary text-white">
        <div className="min-h-[5rem] pt-3.5 pr-5 pb-1 pl-[6.25rem] sm:pr-6">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
            {live && <span className="size-1.5 animate-pulse-dot rounded-full bg-white" aria-hidden />}
            {phaseLabel[phase]}
          </p>
          <Heading className="type-title mt-0.5 text-balance">{drop.name}</Heading>
          <p className="mt-0.5 text-[0.8125rem]">Draw {formatDateTime(drop.drawAt)}</p>
        </div>

        <div className="p-2.5 pt-3">
          <div className="flex items-end justify-between gap-4 rounded-[1.25rem] bg-surface px-4 py-3 text-ink sm:px-5">
            <div>
              <p className="type-caption">{phase === 'open' ? 'Closes in' : phase === 'upcoming' ? 'Opens in' : 'Closed at'}</p>
              <p className="type-title tabular-nums">{counting ? cd.label : formatTime(drop.windowClosesAt)}</p>
            </div>
            <div className="text-right">
              <p className="type-strong tabular-nums">{formatNumber(drop.seats)} seats</p>
              <p className="type-caption">
                {drop.ticketPrice != null ? `${formatPrice(drop.ticketPrice)} if you win` : 'Free to enter'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

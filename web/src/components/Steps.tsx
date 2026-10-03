import { Check } from 'lucide-react'
import type { Drop } from '@/api'
import { phaseOf } from '@/lib/eventStatus'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Card, SectionTitle } from './ui/card'

export default function Steps({ drop }: { drop: Drop }) {
  const phase = phaseOf(drop)
  const steps = [
    { title: 'Entries open', detail: `Until ${formatDateTime(drop.windowClosesAt)}` },
    { title: 'Entries close', detail: 'The list is frozen' },
    { title: 'Draw', detail: formatDateTime(drop.drawAt) },
    { title: 'Winners confirm', detail: drop.confirmWindowMinutes ? `${drop.confirmWindowMinutes} minutes each` : '' },
  ]
  const current = { upcoming: -1, open: 0, closed: 1, drawn: 3, complete: 4 }[phase]

  return (
    <section>
      <SectionTitle>How it runs</SectionTitle>
      <Card>
        <ol>
          {steps.map((step, i) => {
            const done = i < current
            const active = i === current
            return (
              <li key={step.title} className="relative flex gap-3.5 pb-4 last:pb-0" aria-current={active ? 'step' : undefined}>
                {i < steps.length - 1 && (
                  <span aria-hidden className={cn('absolute top-6 left-[0.6875rem] h-[calc(100%-1.5rem)] w-px', done ? 'bg-ink' : 'bg-line')} />
                )}
                <span
                  aria-hidden
                  className={cn(
                    'grid size-[1.4375rem] shrink-0 place-items-center rounded-full border-[1.5px]',
                    done && 'border-ink bg-ink text-surface',
                    active && 'border-primary',
                    !done && !active && 'border-line',
                  )}
                >
                  {done && <Check className="size-3" strokeWidth={3.5} />}
                  {active && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                  <p className={cn('type-strong', !done && !active && 'text-muted')}>{step.title}</p>
                  <p className={active ? 'text-[0.8125rem] font-semibold text-primary-text' : 'type-caption text-right'}>
                    {active ? 'Now' : step.detail}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </section>
  )
}

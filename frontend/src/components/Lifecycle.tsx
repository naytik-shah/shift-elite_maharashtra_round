import { Check } from 'lucide-react'
import type { Drop, DropState } from '@/api'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Card, SectionTitle } from './ui/card'

const order: DropState[][] = [['ANNOUNCED', 'OPEN'], ['CLOSED', 'SCORING'], ['DRAWN'], ['CONFIRMING']]

export default function Lifecycle({ drop }: { drop: Drop }) {
  const steps = [
    { title: 'Entries open', body: `Until ${formatTime(drop.windowClosesAt)}. Any moment in the window counts the same.` },
    { title: 'Entries checked', body: 'The list is frozen. Clusters that look like bot farms are weighted down, not banned.' },
    { title: 'Draw', body: 'A seed sealed before entries opened ranks everyone.' },
    { title: 'Winners confirm', body: `${drop.confirmWindowMinutes} minutes each. Missed seats pass down the waitlist.` },
  ]
  const current = drop.state === 'COMPLETE' ? steps.length : order.findIndex((s) => s.includes(drop.state))

  return (
    <section>
      <SectionTitle>How this drop runs</SectionTitle>
      <Card>
        <ol>
          {steps.map((step, i) => {
            const done = i < current
            const active = i === current
            return (
              <li key={step.title} className="relative flex gap-3.5 pb-5 last:pb-0" aria-current={active ? 'step' : undefined}>
                {i < steps.length - 1 && (
                  <span aria-hidden className={cn('absolute top-6 left-[0.6875rem] h-[calc(100%-1.5rem)] w-px', done ? 'bg-ink' : 'bg-line')} />
                )}
                <span
                  aria-hidden
                  className={cn(
                    'mt-px grid size-[1.4375rem] shrink-0 place-items-center rounded-full border-[1.5px]',
                    done && 'border-ink bg-ink text-surface',
                    active && 'border-primary',
                    !done && !active && 'border-line',
                  )}
                >
                  {done && <Check className="size-3" strokeWidth={3.5} />}
                  {active && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                <div>
                  <p className={cn('text-base font-semibold', !done && !active && 'text-muted')}>
                    {step.title}
                    {active && <span className="ml-2 text-xs font-semibold text-primary-text">Now</span>}
                  </p>
                  <p className="text-sm text-muted">{step.body}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </section>
  )
}

import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Step { label: string; state: 'todo' | 'doing' | 'done' }

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ul className="space-y-2.5" aria-live="polite">
      {steps.map((s) => (
        <li key={s.label} className={cn('flex items-center gap-3', s.state === 'todo' ? 'type-body' : 'type-strong')}>
          <span className="grid size-5 place-items-center" aria-hidden>
            {s.state === 'done' ? <Check className="size-4 text-ok" strokeWidth={3} />
              : s.state === 'doing' ? <Loader2 className="size-4 animate-spin text-primary-text" />
              : <span className="size-1.5 rounded-full bg-line" />}
          </span>
          {s.label}
        </li>
      ))}
    </ul>
  )
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.max(4, value * 100)}%` }} />
    </div>
  )
}

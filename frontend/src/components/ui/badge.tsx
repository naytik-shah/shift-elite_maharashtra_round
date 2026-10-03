import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'ok' | 'primary' | 'warn'

const tones: Record<Tone, string> = {
  neutral: 'bg-fill text-muted',
  ok: 'bg-ok-soft text-ok',
  primary: 'bg-primary-soft text-primary-text',
  warn: 'bg-warn-soft text-warn',
}

// The label always says what the state is, the colour is only a second cue.
export function Badge({ tone = 'neutral', dot, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold', tones[tone], className)} {...props}>
      {dot && <span className="size-1.5 animate-pulse-dot rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

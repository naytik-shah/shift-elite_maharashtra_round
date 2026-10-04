import type { Drop, Entry } from '@/api'
import { relativeIn } from './format'

type Tone = 'neutral' | 'ok' | 'primary' | 'warn'

// The backend keeps a drop OPEN until the organiser closes it, so the entry window
// has to be checked against the clock as well.
export type Phase = 'upcoming' | 'open' | 'closed' | 'drawn' | 'complete'

export function phaseOf(drop: Drop, now = Date.now()): Phase {
  if (drop.state === 'COMPLETE') return 'complete'
  if (drop.state === 'DRAWN') return 'drawn'
  if (drop.state === 'CLOSED') return 'closed'
  if (now < Date.parse(drop.windowOpensAt)) return 'upcoming'
  if (now >= Date.parse(drop.windowClosesAt)) return 'closed'
  return 'open'
}

export const phaseLabel: Record<Phase, string> = {
  upcoming: 'Opening soon',
  open: 'Entries open',
  closed: 'Entries closed',
  drawn: 'Winners confirming',
  complete: 'Ended',
}

// What to show on a card: the user's own entry wins over the drop's phase.
export function statusBadge(drop: Drop, entry?: Entry | null): { label: string; tone: Tone; dot?: boolean } {
  if (entry) {
    switch (entry.state) {
      case 'ENTERED': return { label: 'You are in', tone: 'ok' }
      case 'WON': return { label: 'Confirm your seat', tone: 'primary', dot: true }
      case 'WAITLISTED': return { label: entry.waitlistPosition ? `Waitlist #${entry.waitlistPosition}` : 'Waitlist', tone: 'primary' }
      case 'CONFIRMED': return { label: 'Confirmed', tone: 'ok' }
      case 'EXPIRED': return { label: 'Expired', tone: 'warn' }
      case 'NOT_SELECTED': return { label: 'Not selected', tone: 'neutral' }
    }
  }
  switch (phaseOf(drop)) {
    case 'upcoming': return { label: `Opens in ${relativeIn(drop.windowOpensAt)}`, tone: 'neutral' }
    case 'open': return { label: `Closes in ${relativeIn(drop.windowClosesAt)}`, tone: 'primary', dot: true }
    case 'closed': return { label: 'Entries closed', tone: 'neutral' }
    case 'drawn': return { label: 'Draw done', tone: 'neutral' }
    case 'complete': return { label: 'Ended', tone: 'neutral' }
  }
}

export const isDrawn = (drop: Drop) => drop.state === 'DRAWN' || drop.state === 'COMPLETE'

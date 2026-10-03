import type { Drop, Entry } from '@/api'
import { formatNumber, relativeIn } from './format'

type Tone = 'neutral' | 'ok' | 'primary' | 'warn'

// What to show on a card: the user's own entry wins over the drop's phase.
export function statusBadge(drop: Drop, entry?: Entry | null): { label: string; tone: Tone; dot?: boolean } {
  if (entry) {
    switch (entry.state) {
      case 'ENTERED': return { label: 'You are in', tone: 'ok' }
      case 'WON': return { label: 'Selected, confirm now', tone: 'primary', dot: true }
      case 'WAITLISTED': return { label: `Waitlist #${entry.waitlistPosition ?? ''}`.trim(), tone: 'primary' }
      case 'CONFIRMED': return { label: 'Confirmed', tone: 'ok' }
      case 'EXPIRED': return { label: 'Expired', tone: 'warn' }
      case 'NOT_SELECTED': return { label: 'Not selected', tone: 'neutral' }
    }
  }
  switch (drop.state) {
    case 'ANNOUNCED': return { label: 'Opens soon', tone: 'neutral' }
    case 'OPEN': return { label: 'Entries open', tone: 'primary', dot: true }
    case 'COMPLETE': return { label: 'Ended', tone: 'neutral' }
    default: return { label: 'Entries closed', tone: 'neutral' }
  }
}

export function timeLine(drop: Drop) {
  const seats = `${formatNumber(drop.seats)} seats`
  if (drop.state === 'ANNOUNCED') return `Opens in ${relativeIn(drop.windowOpensAt)}, ${seats}`
  if (drop.state === 'OPEN') return `Closes in ${relativeIn(drop.windowClosesAt)}, ${seats}`
  return seats
}

export function venueLine(drop: Drop) {
  return [drop.venue, drop.city].filter(Boolean).join(', ')
}

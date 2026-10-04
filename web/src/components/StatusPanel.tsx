import { useRef, useState, type ReactNode } from 'react'
import { api, errorCode, errorMessage, type Drop, type Entry } from '@/api'
import { useCountdown } from '@/hooks/useCountdown'
import { isDrawn, phaseOf } from '@/lib/eventStatus'
import { deviceFingerprint } from '@/lib/fingerprint'
import { formatDateTime, formatPrice } from '@/lib/format'
import { withPow } from '@/lib/pow'
import { go } from '@/lib/router'
import { cn, uuid } from '@/lib/utils'
import { useApp } from '@/state'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'

// Every state has the same parts at most: a status label, one title or one number,
// one short line, one button. Nothing else goes in this card.
function Shell({ children }: { children: ReactNode }) {
  return <Card aria-live="polite" className="animate-rise">{children}</Card>
}

const Title = ({ children }: { children: ReactNode }) => <h2 className="type-title text-balance">{children}</h2>
const Line = ({ children }: { children: ReactNode }) => <p className="type-body mt-1">{children}</p>
const Label = ({ children }: { children: ReactNode }) => <p className="type-caption mt-3">{children}</p>
const Figure = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn('type-figure mt-1', className)}>{children}</p>
)

function Skeleton() {
  return (
    <Card aria-busy className="animate-pulse">
      <div className="h-4 w-24 rounded-full bg-fill" />
      <div className="mt-3 h-12 w-40 rounded-xl bg-fill" />
      <div className="mt-5 h-[3.125rem] rounded-full bg-fill" />
    </Card>
  )
}

function NoEntry({ drop }: { drop: Drop }) {
  const { user, openFlow, setEntry } = useApp()
  const first = phaseOf(drop)
  const cd = useCountdown(first === 'open' ? drop.windowClosesAt : first === 'upcoming' ? drop.windowOpensAt : null)
  const phase = cd.done ? phaseOf(drop) : first
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A ref as well as state, so a second tap in the same frame cannot start a second request.
  const running = useRef(false)

  const enter = async () => {
    if (!user) { openFlow('login', drop.id); return }
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    // One key for this click, shared by the retry after an expired puzzle.
    const key = uuid()
    try {
      const res = await withPow('entry', (pow) => api.enter(drop.id, { pow, deviceFingerprint: deviceFingerprint() }, key))
      setEntry(drop.id, { entryId: res.entryId, state: res.state, rank: null, waitlistPosition: null, confirmBy: null })
    } catch (err) {
      if (errorCode(err) === 'ALREADY_ENTERED') {
        const existing = await api.getMyEntry(drop.id).catch(() => null)
        if (existing) { setEntry(drop.id, existing); return }
      }
      setError(errorMessage(err))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const open = phase === 'open'
  return (
    <Shell>
      <Title>{open ? 'Enter the draw' : phase === 'upcoming' ? 'Entries are not open yet' : 'Entries are closed'}</Title>
      <Line>
        {open
          ? `Free to enter, one entry each.${drop.ticketPrice != null ? ` Winners pay ${formatPrice(drop.ticketPrice)}.` : ''}`
          : phase === 'upcoming' ? `Opens in ${cd.label}.` : isDrawn(drop) ? 'The draw is done. Anyone can check it was fair.' : `Draw at ${formatDateTime(drop.drawAt)}.`}
      </Line>
      {error && <p role="alert" className="type-strong mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-danger">{error}</p>}
      {open ? (
        <Button size="lg" className="mt-5 w-full" busy={busy} onClick={enter}>
          {busy ? 'Getting ready...' : user ? 'Enter' : 'Log in to enter'}
        </Button>
      ) : phase === 'upcoming' ? (
        <Button size="lg" className="mt-5 w-full" disabled>Opens in {cd.label}</Button>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          {isDrawn(drop) && <Button size="lg" className="w-full" onClick={() => go('verify', drop.id)}>Verify the draw</Button>}
          {!user && <Button size="lg" variant="gray" className="w-full" onClick={() => openFlow('login', drop.id)}>Log in to see your result</Button>}
        </div>
      )}
    </Shell>
  )
}

function Won({ drop, entry }: { drop: Drop; entry: Entry }) {
  const { openFlow } = useApp()
  const cd = useCountdown(entry.confirmBy)
  const total = (drop.confirmWindowMinutes ?? 10) * 60
  const pct = Math.min(100, (cd.seconds / total) * 100)
  const urgent = cd.seconds <= 60

  return (
    <Shell>
      <Badge tone="ok">You got a seat</Badge>
      <Label>Confirm within</Label>
      <Figure className={cn(urgent && 'text-danger')}>{cd.label}</Figure>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
        <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', urgent ? 'bg-danger' : 'bg-ink')} style={{ width: `${pct}%` }} />
      </div>
      <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('confirm', drop.id)}>
        Confirm seat
      </Button>
      <p className="type-caption mt-2.5 text-center">If the timer runs out, the seat goes to the waitlist.</p>
    </Shell>
  )
}

export default function StatusPanel({ drop }: { drop: Drop }) {
  const { entries, user, loading, tickets } = useApp()
  const entry = entries[drop.id]

  if (loading || (user && entry === undefined)) return <Skeleton />
  if (!user || !entry) return <NoEntry drop={drop} />

  switch (entry.state) {
    case 'ENTERED':
      return (
        <Shell>
          <Badge tone="ok" dot>Entered</Badge>
          <div className="mt-3"><Title>You're in</Title></div>
          <Line>Draw at {formatDateTime(drop.drawAt)}.</Line>
        </Shell>
      )
    case 'WON':
      return <Won drop={drop} entry={entry} />
    case 'WAITLISTED':
      return (
        <Shell>
          <Badge tone="primary" dot>Waitlist</Badge>
          <Label>Your place in line</Label>
          {/* keyed so the number animates each time the line moves */}
          <Figure key={entry.waitlistPosition} className="animate-rise">#{entry.waitlistPosition ?? ''}</Figure>
          <Line>If a seat frees up, we'll email you.</Line>
        </Shell>
      )
    case 'CONFIRMED': {
      const ticket = tickets.find((t) => t.dropId === drop.id)
      return (
        <Shell>
          <Badge tone="ok">Confirmed</Badge>
          <div className="mt-3"><Title>Your seat is confirmed</Title></div>
          {ticket && <Line>Seat {ticket.slotNo}, in the name of {ticket.holderName}.</Line>}
          <Button size="lg" className="mt-5 w-full" onClick={() => go('tickets')}>View ticket</Button>
        </Shell>
      )
    }
    case 'EXPIRED':
      return (
        <Shell>
          <Badge tone="warn">Expired</Badge>
          <div className="mt-3"><Title>Your confirm window ended</Title></div>
          <Line>The seat moved to the next person in line.</Line>
        </Shell>
      )
    case 'NOT_SELECTED':
      return (
        <Shell>
          <Badge>Not selected</Badge>
          <div className="mt-3"><Title>Not selected this time</Title></div>
        </Shell>
      )
  }
}

import { useRef, useState, type ReactNode } from 'react'
import { api, errorCode, errorMessage, type Drop, type Entry } from '@/api'
import { useCountdown } from '@/hooks/useCountdown'
import { formatAmount, formatTime } from '@/lib/format'
import { go } from '@/lib/router'
import { cn, uuid } from '@/lib/utils'
import { getPaymentToken, rememberPaymentToken, useApp } from '@/state'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Field, Input } from './ui/input'

// Every state uses the same skeleton: a status label, one headline, the one number
// that matters, a line of plain explanation, then at most one action.
function Shell({ children }: { children: ReactNode }) {
  return <Card aria-live="polite" className="animate-rise">{children}</Card>
}

const Title = ({ children }: { children: ReactNode }) => (
  <h2 className="text-xl font-bold tracking-tight text-balance">{children}</h2>
)

const Body = ({ children }: { children: ReactNode }) => <p className="mt-1 text-sm text-muted">{children}</p>

function Figure({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mt-3 text-[3.5rem] leading-none font-bold tracking-tight tabular-nums', className)}>{children}</p>
}

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
  const { user, openFlow } = useApp()
  const opens = useCountdown(drop.state === 'ANNOUNCED' ? drop.windowOpensAt : null)

  if (drop.state === 'ANNOUNCED') {
    return (
      <Shell>
        <Title>Entries open in</Title>
        <Figure>{opens.label}</Figure>
        <Body>No need to wait here. Any moment in the window counts the same.</Body>
      </Shell>
    )
  }
  if (drop.state !== 'OPEN') {
    return (
      <Shell>
        <Title>Entries are closed</Title>
        <Body>This drop stopped taking entries at {formatTime(drop.windowClosesAt)}.</Body>
      </Shell>
    )
  }
  return (
    <Shell>
      <Title>Enter once. That is all it takes.</Title>
      <Body>
        A refundable {formatAmount(drop.holdAmount, drop.currency)} hold keeps it to one entry per person. It is released if you are not selected.
      </Body>
      <Button size="lg" className="mt-5 w-full" onClick={() => openFlow(user ? 'enter' : 'signin', drop.id)}>
        {user ? 'Enter the draw' : 'Sign in to enter'}
      </Button>
    </Shell>
  )
}

function Entered({ drop, entry }: { drop: Drop; entry: Entry }) {
  const cd = useCountdown(drop.state === 'OPEN' ? drop.windowClosesAt : null)
  const waiting = drop.state !== 'OPEN'
  return (
    <Shell>
      <Badge tone="ok" dot>You are in</Badge>
      {waiting ? (
        <>
          <div className="mt-3"><Title>{drop.state === 'CLOSED' ? 'Entries are frozen' : 'The draw is running'}</Title></div>
          <Body>Your result lands here on its own. No need to refresh.</Body>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">Draw runs after entries close in</p>
          <Figure className="mt-1">{cd.label}</Figure>
          <Body>You can close this tab. Your entry is saved.</Body>
        </>
      )}
      {entry.entryId && <p className="mt-4 border-t border-line pt-3 font-mono text-xs text-muted">Entry {entry.entryId}</p>}
    </Shell>
  )
}

function Won({ drop, entry }: { drop: Drop; entry: Entry }) {
  const { setEntry: setEntryFor, setTicket } = useApp()
  const paymentToken = getPaymentToken(drop.id)
  const setEntry = (e: Entry) => setEntryFor(drop.id, e)
  const cd = useCountdown(entry.confirmBy)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [upi, setUpi] = useState('')
  // Same key for every retry of this confirm, so a double tap or a flaky network cannot charge twice.
  const key = useRef(uuid())
  const total = drop.confirmWindowMinutes * 60
  const pct = Math.min(100, (cd.seconds / total) * 100)
  const urgent = cd.seconds <= 60

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let token = paymentToken
      if (!token) {
        token = (await api.createPaymentMethod(upi.trim())).token
      }
      const ticket = await api.confirm(drop.id, token, key.current)
      rememberPaymentToken(drop.id, token)
      setTicket(ticket)
      setEntry({ ...entry, state: 'CONFIRMED', confirmBy: null })
      go('tickets')
    } catch (err) {
      setError(errorMessage(err))
      if (errorCode(err) === 'CONFIRM_WINDOW_EXPIRED') setEntry({ ...entry, state: 'EXPIRED', confirmBy: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <Badge tone="ok">Selected</Badge>
      <div className="mt-3"><Title>You got a seat</Title></div>
      <p className="mt-3 text-sm text-muted">{urgent ? 'Less than a minute left to confirm' : 'Held for you for'}</p>
      <Figure className={cn('mt-1', urgent && 'text-danger')}>{cd.label}</Figure>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
        <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', urgent ? 'bg-danger' : 'bg-ink')} style={{ width: `${pct}%` }} />
      </div>
      <form onSubmit={confirm} className="mt-5">
        {!paymentToken && (
          <div className="mb-4">
            <Field label="UPI ID you entered with" hint="It has to match your entry.">
              <Input required value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@upi" autoCapitalize="none" autoCorrect="off" />
            </Field>
          </div>
        )}
        {error && <p role="alert" className="mb-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" busy={busy} className="w-full">
          {busy ? 'Confirming' : 'Confirm seat'}
        </Button>
        <p className="mt-3 text-xs text-muted">
          Your {formatAmount(drop.holdAmount, drop.currency)} hold becomes the payment. If the timer runs out, the seat passes to the waitlist.
        </p>
      </form>
    </Shell>
  )
}

export default function StatusPanel({ drop }: { drop: Drop }) {
  const { entries, user, loading } = useApp()
  const entry = entries[drop.id]

  if (loading || (user && entry === undefined)) return <Skeleton />
  if (!user || !entry) return <NoEntry drop={drop} />

  switch (entry.state) {
    case 'ENTERED':
      return <Entered drop={drop} entry={entry} />
    case 'WON':
      return <Won drop={drop} entry={entry} />
    case 'WAITLISTED':
      return (
        <Shell>
          <Badge tone="primary" dot>On the waitlist</Badge>
          <p className="mt-3 text-sm text-muted">Your place in line</p>
          {/* keyed so the number animates each time the line moves */}
          <Figure key={entry.waitlistPosition} className="mt-1 animate-rise">{entry.waitlistPosition}</Figure>
          <Body>
            Winners get {drop.confirmWindowMinutes} minutes to confirm. Seats they miss come down the line. This updates live.
          </Body>
        </Shell>
      )
    case 'CONFIRMED':
      return (
        <Shell>
          <Badge tone="ok">Confirmed</Badge>
          <div className="mt-3"><Title>Your seat is confirmed</Title></div>
          <Body>Your named ticket is ready. See you there.</Body>
          <Button size="lg" className="mt-5 w-full" onClick={() => go('tickets')}>View ticket</Button>
        </Shell>
      )
    case 'EXPIRED':
      return (
        <Shell>
          <Badge tone="warn">Expired</Badge>
          <div className="mt-3"><Title>The confirm window passed</Title></div>
          <Body>Your seat moved to the next person on the waitlist and your hold was released.</Body>
        </Shell>
      )
    case 'NOT_SELECTED':
      return (
        <Shell>
          <Badge>Not selected</Badge>
          <div className="mt-3"><Title>No seat this time</Title></div>
          <Body>Everyone had the same odds, and you can check the draw yourself below. Your hold has been released.</Body>
        </Shell>
      )
  }
}

import { useRef, useState } from 'react'
import { api, errorCode, errorMessage, usingMock, type Drop } from '@/api'
import { MOCK_USED_CARD } from '@/api/mock'
import { useCountdown } from '@/hooks/useCountdown'
import { formatPrice } from '@/lib/format'
import { go } from '@/lib/router'
import { cn, uuid } from '@/lib/utils'
import { useApp } from '@/state'
import { Button } from './ui/button'
import { Field, Input } from './ui/input'

// Winner pays with a test card. No real payment is taken anywhere in this app.
export default function ConfirmSheet({ drop, onDone }: { drop: Drop; onDone: () => void }) {
  const { entries, setEntry, setTicket } = useApp()
  const entry = entries[drop.id]
  const cd = useCountdown(entry?.confirmBy)
  const [card, setCard] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  // The key follows the form values, so a retry of the same details is deduped by the
  // server and a corrected card is treated as a new request.
  const attempt = useRef({ sig: '', key: uuid() })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    const body = { testCard: card.trim(), payerName: name.trim() }
    const sig = JSON.stringify(body)
    if (attempt.current.sig !== sig) attempt.current = { sig, key: uuid() }
    try {
      const ticket = await api.confirm(drop.id, body, attempt.current.key)
      setTicket(ticket)
      setEntry(drop.id, (cur) => (cur ? { ...cur, state: 'CONFIRMED', confirmBy: null } : cur))
      onDone()
      go('tickets')
    } catch (err) {
      const code = errorCode(err)
      setError(errorMessage(err))
      // The server's answer is the truth, so line the screen up with it.
      if (code === 'CONFIRM_WINDOW_EXPIRED' || code === 'ALREADY_CONFIRMED' || code === 'NOT_A_WINNER') {
        api.getMyEntry(drop.id).then((x) => setEntry(drop.id, x)).catch(() => {})
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const expired = !!entry?.confirmBy && cd.done
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-fill px-4 py-3">
        <span className="type-body">Time left</span>
        <span className={cn('type-strong tabular-nums', cd.seconds <= 60 && 'text-danger')}>{cd.label}</span>
      </div>

      <Field label="Test card number" hint={usingMock ? `Any number works. ${MOCK_USED_CARD} shows the card already used error.` : 'Test mode. No real payment is taken.'}>
        <Input
          required
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          placeholder="4242 4242 4242 4242"
          value={card}
          onChange={(e) => setCard(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label="Name on the ticket" hint="The ticket is issued in this name and cannot be transferred.">
        <Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={80} />
      </Field>

      {error && <p role="alert" className="type-strong rounded-2xl bg-danger-soft px-4 py-3 text-danger">{error}</p>}

      <Button size="lg" busy={busy} disabled={expired} className="w-full">
        {busy ? 'Confirming' : drop.ticketPrice != null ? `Pay ${formatPrice(drop.ticketPrice)} and confirm` : 'Confirm seat'}
      </Button>
    </form>
  )
}

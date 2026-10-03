import { useRef, useState } from 'react'
import { api, errorCode, errorMessage, usingMock, type Drop } from '@/api'
import { deviceFingerprint } from '@/lib/fingerprint'
import { formatAmount } from '@/lib/format'
import { solvePow } from '@/lib/pow'
import { uuid } from '@/lib/utils'
import { rememberPaymentToken, useApp } from '@/state'
import { Bar, StepList, type Step } from './Progress'
import { Button } from './ui/button'
import { Field, Input } from './ui/input'

type Phase = 'idle' | 'pow' | 'hold'

const testIds = ['demo@upi', 'asha@okbank', 'fail@upi']

export default function EnterSheet({ drop, onDone }: { drop: Drop; onDone: () => void }) {
  const { setEntry } = useApp()
  const [upi, setUpi] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  // The key is tied to the payment method, so a retry of the same attempt can never create a second entry.
  const attempt = useRef({ upi: '', key: uuid() })
  const busy = phase !== 'idle'
  const amount = formatAmount(drop.holdAmount, drop.currency)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const value = upi.trim().toLowerCase()
    if (attempt.current.upi !== value) attempt.current = { upi: value, key: uuid() }
    setError('')
    setProgress(0)
    try {
      setPhase('pow')
      const [challenge, method] = await Promise.all([api.getPowChallenge('entry'), api.createPaymentMethod(value)])
      const pow = await solvePow(challenge, setProgress)
      setPhase('hold')
      const entry = await api.enter(
        drop.id,
        { pow, paymentMethodToken: method.token, deviceFingerprint: deviceFingerprint() },
        attempt.current.key,
      )
      rememberPaymentToken(drop.id, method.token)
      // The create response only carries the id and state, the rest arrives over the stream.
      setEntry(drop.id, { entryId: entry.entryId, state: entry.state, rank: entry.rank ?? null, waitlistPosition: entry.waitlistPosition ?? null, confirmBy: entry.confirmBy ?? null })
      onDone()
    } catch (err) {
      // Already entered means the server has our entry, so just show it.
      if (errorCode(err) === 'ALREADY_ENTERED') {
        const existing = await api.getMyEntry(drop.id).catch(() => null)
        if (existing) { setEntry(drop.id, existing); onDone(); return }
      }
      // A spent challenge cannot be replayed, so the next try needs a fresh key too.
      attempt.current = { upi: '', key: uuid() }
      setError(errorMessage(err))
    } finally {
      setPhase('idle')
    }
  }

  const steps: Step[] = [
    { label: 'Security check on this device', state: phase === 'pow' ? 'doing' : phase === 'hold' ? 'done' : 'todo' },
    { label: `Placing the refundable ${amount} hold`, state: phase === 'hold' ? 'doing' : 'todo' },
  ]

  return (
    <form onSubmit={submit} className="space-y-4">
      <dl className="divide-y divide-line rounded-2xl bg-surface px-4 text-sm">
        <div className="flex justify-between py-3"><dt className="text-muted">Refundable hold</dt><dd className="font-semibold">{amount}</dd></div>
        <div className="flex justify-between py-3"><dt className="text-muted">If not selected</dt><dd className="font-semibold">Released in full</dd></div>
        <div className="flex justify-between py-3"><dt className="text-muted">If you win</dt><dd className="font-semibold">Becomes your payment</dd></div>
      </dl>

      <Field
        label="UPI ID"
        error={error || undefined}
        hint={usingMock ? 'Demo mode. No real money moves, use any test ID.' : 'One entry per payment method.'}
      >
        <Input
          required
          autoFocus
          value={upi}
          onChange={(e) => setUpi(e.target.value)}
          placeholder="name@upi"
          pattern="[A-Za-z0-9._]+@[A-Za-z0-9]+"
          title="Looks like name@bank"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          aria-invalid={!!error}
        />
      </Field>

      {usingMock && !busy && (
        <div className="flex flex-wrap gap-2">
          {testIds.map((id) => (
            <button key={id} type="button" onClick={() => setUpi(id)} className="h-11 rounded-full bg-fill px-4 text-sm font-semibold text-ink">
              {id}
            </button>
          ))}
        </div>
      )}

      {busy && (
        <div className="space-y-3 rounded-2xl bg-surface p-4">
          <StepList steps={steps} />
          {phase === 'pow' && <Bar value={progress} />}
        </div>
      )}

      <Button size="lg" busy={busy} className="w-full">{busy ? 'Entering' : 'Enter the draw'}</Button>
      <p className="text-center text-xs text-muted">Tapping twice or retrying never creates a second entry.</p>
    </form>
  )
}

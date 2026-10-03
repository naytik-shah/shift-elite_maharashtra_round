import { useState } from 'react'
import { api, type Session } from '../api'
import { useCountdown } from '../hooks/useCountdown'
import { useEntryStatus } from '../hooks/useEntryStatus'

export default function Drop({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const { status, event, offline, setStatus } = useEntryStatus(session)
  const [busy, setBusy] = useState(false)
  const drawCd = useCountdown(event?.drawAt)
  const holdCd = useCountdown(status?.holdExpiresAt)

  const run = async (fn: () => Promise<typeof status>) => {
    if (busy) return
    setBusy(true)
    try { setStatus(await fn()) } finally { setBusy(false) }
  }

  if (!status || !event) return <p className="text-indigo-200">Loading...</p>

  return (
    <div className="space-y-4">
      {offline && (
        <p role="status" className="rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-200">
          Connection lost. Your place is safe, reconnecting...
        </p>
      )}

      <div className="rounded-xl bg-white/5 p-4">
        <h2 className="text-lg font-semibold">{event.name}</h2>
        <p className="text-sm text-indigo-200">
          {event.seats} seats, {event.entrants.toLocaleString()} entrants so far
        </p>
      </div>

      {status.state === 'not_entered' && event.status === 'drawn' && (
        <p className="rounded-xl bg-white/5 p-4 text-center text-indigo-200">
          Entry closed. The draw has already happened.
        </p>
      )}

      {status.state === 'not_entered' && event.status === 'open' && (
        <>
          <p className="text-sm text-indigo-200">Draw in {drawCd.label}. Enter once, that is all it takes.</p>
          <button
            disabled={busy}
            onClick={() => run(() => api.enter(session))}
            className="w-full rounded-lg bg-indigo-500 py-3 font-medium disabled:opacity-60"
          >
            Enter the draw
          </button>
        </>
      )}

      {status.state === 'entered' && (
        <div className="rounded-xl bg-white/5 p-4 text-center">
          <p className="text-sm text-indigo-200">You are in. Draw starts in</p>
          <p className="my-2 text-5xl font-bold tabular-nums">{drawCd.label}</p>
          <p className="text-xs text-indigo-300">No need to refresh. Your entry is saved.</p>
        </div>
      )}

      {status.state === 'queued' && (
        <div className="rounded-xl bg-white/5 p-4 text-center">
          <p className="text-sm text-indigo-200">You were drawn. Your place in line</p>
          <p className="my-2 text-5xl font-bold tabular-nums">{status.position}</p>
          <p className="text-xs text-indigo-300">Updates live. Safe to refresh or close this tab.</p>
        </div>
      )}

      {status.state === 'holding' && (
        <div className="rounded-xl bg-emerald-500/15 p-4 text-center">
          <p className="text-sm text-emerald-200">Your seat is held for</p>
          <p className="my-2 text-5xl font-bold tabular-nums">{holdCd.label}</p>
          <button
            disabled={busy}
            onClick={() => run(() => api.confirm(session))}
            className="mt-2 w-full rounded-lg bg-emerald-500 py-3 font-medium text-emerald-950 disabled:opacity-60"
          >
            {busy ? 'Confirming...' : 'Confirm seat'}
          </button>
        </div>
      )}

      {status.state === 'confirmed' && (
        <p className="rounded-xl bg-emerald-500/15 p-4 text-center text-emerald-100">
          Seat confirmed. See you there.
        </p>
      )}

      {status.state === 'expired' && (
        <p className="rounded-xl bg-white/5 p-4 text-center text-indigo-200">
          Your hold timed out and the seat went to the waitlist.
        </p>
      )}

      {status.state === 'lost' && (
        <p className="rounded-xl bg-white/5 p-4 text-center text-indigo-200">
          Not drawn this time. Everyone had the same odds.
        </p>
      )}

      <button onClick={onLeave} className="w-full py-2 text-xs text-indigo-300 underline">
        Sign out
      </button>
    </div>
  )
}

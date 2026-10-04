import { useRef, useState } from 'react'
import { api, errorMessage, type LiveStats } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatNumber } from '@/lib/format'
import { uuid } from '@/lib/utils'
import { Stat } from './shared'

type Action = 'close' | 'score' | 'draw'

const copy: Record<Action, { button: string; title: string; body: string; confirm: string }> = {
  close: { button: 'Close entries', title: 'Close entries?', body: 'No one can enter after this. It cannot be undone.', confirm: 'Close entries' },
  score: { button: 'Run scoring', title: 'Run scoring?', body: 'Every entry gets a risk score and a weight. It runs once.', confirm: 'Run scoring' },
  draw: { button: 'Run draw', title: 'Run the draw?', body: 'Ranks every entry, creates the seat slots and reveals the seed. It runs once.', confirm: 'Run draw' },
}

// The contract does not say whether scored is a flag or a word, so read both.
function scoringState(scored: LiveStats['scored'], running: boolean): 'not run' | 'running' | 'done' {
  if (running || (typeof scored === 'string' && /run|progress/i.test(scored) && !/not/i.test(scored))) return 'running'
  if (scored === true || (typeof scored === 'string' && /done|complete|scored|true/i.test(scored))) return 'done'
  return 'not run'
}

export default function Controls({ dropId, live, onChange }: { dropId: string; live: LiveStats | null; onChange: () => void }) {
  const [asking, setAsking] = useState<Action | null>(null)
  const [running, setRunning] = useState<Action | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const busy = useRef(false)

  const run = async (action: Action) => {
    // One request per click, however fast the button is pressed.
    if (busy.current) return
    busy.current = true
    setAsking(null)
    setRunning(action)
    setMessage(null)
    const key = uuid()
    try {
      if (action === 'close') {
        await api.admin.close(dropId, key)
        setMessage({ ok: true, text: 'Entries are closed.' })
      } else if (action === 'score') {
        const res = await api.admin.score(dropId, key)
        setMessage({ ok: true, text: `Scored ${formatNumber(res.scored)} entries, ${formatNumber(res.flagged)} given a lower weight.` })
      } else {
        await api.admin.draw(dropId, key)
        setMessage({ ok: true, text: 'The draw has run and the seed is revealed.' })
      }
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) })
    } finally {
      busy.current = false
      setRunning(null)
      onChange()
    }
  }

  const state = live?.state
  const scoring = scoringState(live?.scored, running === 'score')
  const any = running !== null
  const can: Record<Action, boolean> = {
    close: state === 'OPEN',
    score: state === 'CLOSED' && scoring === 'not run',
    // The draw is blocked while scoring is in progress.
    draw: state === 'CLOSED' && scoring !== 'running',
  }

  return (
    <section>
      <SectionTitle>Live</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="State" value={state ?? '...'} />
        <Stat label="Entries" value={live ? formatNumber(live.entries) : '...'} hint={live?.entriesPerMin != null ? `${formatNumber(live.entriesPerMin)} per min` : undefined} />
        <Stat label="Seats" value={live ? formatNumber(live.seats) : '...'} />
        <Stat label="Waitlist left" value={live ? formatNumber(live.waitlistLeft) : '...'} />
        <Stat label="Slots pending" value={live ? formatNumber(live.slotsPending) : '...'} />
        <Stat label="Slots confirmed" value={live ? formatNumber(live.slotsConfirmed) : '...'} />
        <Stat label="Slots unfilled" value={live ? formatNumber(live.slotsUnfilled) : '...'} />
        <Stat label="Rate limited" value={live?.rateLimitedPerMin != null ? formatNumber(live.rateLimitedPerMin) : '...'} hint="per min" />
      </div>

      <Card className="mt-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {(['close', 'score', 'draw'] as Action[]).map((a) => (
            <Button key={a} variant={a === 'draw' ? 'primary' : 'gray'} busy={running === a} disabled={any || !can[a]} onClick={() => setAsking(a)}>
              {copy[a].button}
            </Button>
          ))}
        </div>
        <p className="type-caption mt-3">Scoring: {scoring}</p>
        {message && (
          <p role="status" className={`type-strong mt-3 rounded-2xl px-4 py-3 ${message.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
            {message.text}
          </p>
        )}
      </Card>

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        {asking && (
          <DialogContent title={copy[asking].title} description={copy[asking].body}>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="gray" size="lg" onClick={() => setAsking(null)}>Cancel</Button>
              <Button size="lg" onClick={() => run(asking)}>{copy[asking].confirm}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}

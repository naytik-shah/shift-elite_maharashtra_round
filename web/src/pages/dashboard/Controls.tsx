import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, errorMessage, type LiveStats } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatNumber } from '@/lib/format'
import { cn, uuid } from '@/lib/utils'

type Action = 'close' | 'score' | 'draw'

const copy: Record<Action, { button: string; title: string; body: string }> = {
  close: { button: 'Close entries', title: 'Close entries?', body: 'No one can enter after this. It cannot be undone.' },
  score: { button: 'Run scoring', title: 'Run scoring?', body: 'Every entry gets a risk score and a weight. It runs once.' },
  draw: { button: 'Run draw', title: 'Run the draw?', body: 'Ranks every entry, creates the seat slots and reveals the seed. It runs once.' },
}

export function isScored(scored: LiveStats['scored']) {
  return scored === true || (typeof scored === 'string' && /done|complete|scored|true/i.test(scored) && !/not/i.test(scored))
}

const steps = ['Open', 'Closed', 'Scored', 'Drawn', 'Complete']

export function stepOf(live: LiveStats | null) {
  if (!live) return -1
  if (live.state === 'COMPLETE') return 4
  if (live.state === 'DRAWN') return 3
  if (live.state === 'CLOSED') return isScored(live.scored) ? 2 : 1
  return 0
}

function Stepper({ at }: { at: number }) {
  return (
    <ol className="flex items-center" aria-label="Drop progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center" aria-current={i === at ? 'step' : undefined}>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'grid size-5 place-items-center rounded-full border text-[0.6875rem] font-semibold',
                i < at ? 'border-ink bg-ink text-bg' : i === at ? 'border-primary bg-primary text-primary-fg' : 'border-line text-muted',
              )}
            >
              {i < at ? <Check className="size-3" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            <span className={cn('type-caption', i === at ? 'font-semibold text-ink' : 'hidden sm:inline')}>{s}</span>
          </span>
          {i < steps.length - 1 && <span className={cn('mx-2 h-px w-4 sm:w-6', i < at ? 'bg-ink' : 'bg-line')} aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

// The one thing the organiser can do next, shown as one button. Nothing else competes with it.
export default function Controls({ dropId, live, onChange }: { dropId: string; live: LiveStats | null; onChange: () => void }) {
  const [asking, setAsking] = useState<Action | null>(null)
  const [running, setRunning] = useState<Action | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const busy = useRef(false)
  const at = stepOf(live)

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
        setMessage({ ok: true, text: `Scored ${formatNumber(res.scored)} entries. ${formatNumber(res.flagged)} got a lower weight.` })
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

  const next: Action | null = at === 0 ? 'close' : at === 1 ? 'score' : at === 2 ? 'draw' : null

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <Stepper at={at} />
      <div className="flex items-center gap-2">
        {at === 1 && (
          <Button variant="plain" size="sm" disabled={running !== null} onClick={() => setAsking('draw')}>Draw without scoring</Button>
        )}
        {next ? (
          <Button busy={running === next} disabled={running !== null} onClick={() => setAsking(next)}>{copy[next].button}</Button>
        ) : (
          at >= 3 && <p className="type-body">Nothing left to run.</p>
        )}
      </div>
      {message && (
        <p role="status" className={cn('type-strong basis-full rounded-lg px-4 py-2.5', message.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
          {message.text}
        </p>
      )}

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        {asking && (
          <DialogContent title={copy[asking].title} description={copy[asking].body}>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="gray" size="lg" onClick={() => setAsking(null)}>Cancel</Button>
              <Button size="lg" onClick={() => run(asking)}>{copy[asking].button}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

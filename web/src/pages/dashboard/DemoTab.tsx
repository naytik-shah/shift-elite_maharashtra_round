import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, type CrowdGroup, type CrowdReport, type DemoStatus, type Drop } from '@/api'
import EventArt from '@/components/EventArt'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatNumber, formatPercent, formatPrice } from '@/lib/format'
import { useApp } from '@/state'
import { usePoll } from './shared'

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="type-headline">{title}</h3>
      {note && <p className="type-caption mt-0.5">{note}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function AddEvents({ templates, onAdded }: { templates: DemoStatus['templates']; onAdded: () => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const add = async (index: number) => {
    setBusy(index)
    setMessage(null)
    try {
      const d = await api.admin.demo.addEvent(index)
      setMessage({ ok: true, text: `${d.name} is live. It is on the Drops page now.` })
      onAdded()
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <Panel title="Add an event" note="Pushes a new event into the live system. People can enter it straight away.">
      <div className="grid gap-3 sm:grid-cols-3">
        {templates.map((t) => (
          <div key={t.index} className="overflow-hidden rounded-lg border border-line">
            <div className="relative aspect-[16/10] overflow-hidden bg-fill"><EventArt drop={{ id: t.name, name: t.name, category: t.category }} className="absolute inset-0 size-full" /></div>
            <div className="p-3">
              <p className="type-strong truncate">{t.name}</p>
              <p className="type-caption truncate">{t.city}, {formatNumber(t.seats)} seats, {formatPrice(t.price)}</p>
              <Button variant="gray" size="sm" className="mt-3 w-full" busy={busy === t.index} disabled={busy !== null} onClick={() => add(t.index)}>
                Add to live system
              </Button>
            </div>
          </div>
        ))}
      </div>
      {message && (
        <p role="status" className={`type-strong mt-3 rounded-lg px-4 py-2.5 ${message.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{message.text}</p>
      )}
    </Panel>
  )
}

const groupNames: Record<'honest' | 'naive' | 'stealth', string> = { honest: 'Honest people', naive: 'Naive bots', stealth: 'Stealth bots' }

function GroupRow({ name, g, honest }: { name: string; g: CrowdGroup; honest?: boolean }) {
  const rate = g.total ? g.lowered / g.total : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-strong">{name} <span className="type-caption font-normal tabular-nums">{formatNumber(g.total)}</span></p>
        <p className="type-strong tabular-nums">
          {formatNumber(g.lowered)} lowered <span className="type-caption font-normal">{formatPercent(rate, rate < 0.01 && g.lowered > 0 ? 2 : 1)}</span>
        </p>
      </div>
      <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-sm bg-fill" role="img" aria-label={`${formatNumber(g.lowered)} of ${formatNumber(g.total)} got a lower weight`}>
        <div style={{ width: `${rate * 100}%`, background: honest ? 'var(--warn)' : 'var(--primary)' }} />
      </div>
    </div>
  )
}

function Crowd({ drop, attempts, onChanged }: { drop: Drop | undefined; attempts: number; onChanged: () => void }) {
  const report = usePoll<CrowdReport>(() => (drop ? api.admin.demo.crowd(drop.id) : Promise.reject()), 2000, [drop?.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const r = report.data
  const running = r?.state === 'running'
  const open = drop?.state === 'OPEN'

  const start = async () => {
    if (!drop) return
    setBusy(true)
    setError('')
    try {
      await api.admin.demo.startCrowd(drop.id)
      report.refresh()
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const g = r?.groups
  const flaggedBots = g ? g.naive.lowered + g.stealth.lowered : 0
  const bots = g ? g.naive.total + g.stealth.total : 0

  return (
    <Panel title="Crowd simulation" note={`${formatNumber(attempts)} people click Enter on ${drop?.name ?? 'this event'}, bots among them.`}>
      <div className="flex flex-wrap items-center gap-3">
        <Button busy={busy || running} disabled={!open || busy || running} onClick={start}>
          {running ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Crowd arriving</> : `Send ${formatNumber(attempts)} people`}
        </Button>
        {!open && !running && <p className="type-caption">The event must be open for entries. Use Reset all events if it is not.</p>}
      </div>
      {error && <p role="alert" className="type-strong mt-3 rounded-lg bg-danger-soft px-4 py-2.5 text-danger">{error}</p>}

      {r && r.state !== 'none' && (
        <div className="mt-5 space-y-5">
          {running && (
            <div>
              <div className="h-2 rounded-sm bg-fill"><div className="h-full rounded-sm bg-primary transition-[width] duration-700" style={{ width: `${((r.wave ?? 0) / (r.waves ?? 14)) * 100}%` }} /></div>
              <p className="type-caption mt-1">Arriving in {r.waves} waves</p>
            </div>
          )}
          <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line">
            <div className="px-3 py-3"><dt className="type-caption">Clicked Enter</dt><dd className="type-title tabular-nums">{formatNumber(r.attempts ?? 0)}</dd></div>
            <div className="px-3 py-3"><dt className="type-caption">Stopped at the door</dt><dd className="type-title tabular-nums">{formatNumber(r.refused ?? 0)}</dd></div>
            <div className="px-3 py-3"><dt className="type-caption">Got in</dt><dd className="type-title tabular-nums">{formatNumber(r.entered ?? 0)}</dd></div>
          </dl>

          {!g && r.state === 'done' && <p className="type-body">Everyone is in. Close entries, then run scoring with the button at the top.</p>}
          {r.state === 'interrupted' && <p className="type-body">Entries closed while the crowd was arriving, so the rest stayed out.</p>}

          {g && (
            <div className="space-y-4">
              <p className="type-strong">
                {formatNumber(flaggedBots)} of {formatNumber(bots)} bots that got in were given a lower weight, and {formatNumber(g.honest.lowered)} of {formatNumber(g.honest.total)} honest people were.
              </p>
              <GroupRow name={groupNames.stealth} g={g.stealth} />
              <GroupRow name={groupNames.naive} g={g.naive} />
              <GroupRow name={groupNames.honest} g={g.honest} honest />
              {g.real.total > 0 && <p className="type-caption">{formatNumber(g.real.total)} real entries ({formatNumber(g.real.lowered)} lowered) are not counted above.</p>}
            </div>
          )}
        </div>
      )}

      <details className="mt-5 border-t border-line pt-4">
        <summary className="type-strong cursor-pointer">How this crowd is built</summary>
        <div className="type-body mt-3 space-y-2 [&_strong]:font-semibold [&_strong]:text-ink">
          <p><strong>The accounts are simulated. The scoring is real.</strong> They are written straight into the database in 14 waves, then the real scoring service and the trained model rate them.</p>
          <p><strong>34,000 honest, 6,000 naive bots, 2,000 spammers, 8,000 stealth bots.</strong> About 6,990 of the naive bots and spammers are stopped by the rate limits at the door, so 43,010 get in.</p>
          <p><strong>Naive bots</strong> share one device and numbered emails. <strong>Stealth bots</strong> rotate fingerprints and spread over 600 proxy addresses.</p>
          <p><strong>These stealth bots still leave marks that sloppy farms leave:</strong> they reuse the proxies, draw emails from one short name list with a year on the end, arrive in bursts, and solve the puzzle with native code, so the server measures much shorter puzzle times than a browser takes.</p>
          <p><strong>A stealth farm that left none of those marks would not be caught.</strong> Rate limits and one card per seat still limit what it can win.</p>
          <p><strong>Honest people on shared college networks are protected:</strong> one odd signal alone, such as a shared network, never lowers a weight.</p>
        </div>
      </details>
    </Panel>
  )
}

function Reset({ onDone }: { onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async () => {
    setBusy(true)
    try {
      const res = await api.admin.demo.reset()
      setAsking(false)
      setMessage({ ok: true, text: `${res.reset} events are open again, with no entries.` })
      onDone()
    } catch (err) {
      setAsking(false)
      setMessage({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="Reset all events" note="Puts every event back to the Enter stage, with no entries, seats or tickets. The audit log is kept.">
      <Button variant="danger" onClick={() => setAsking(true)}>Reset all events</Button>
      {message && <p role="status" className={`type-strong mt-3 rounded-lg px-4 py-2.5 ${message.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>{message.text}</p>}
      <Dialog open={asking} onOpenChange={(o) => !busy && setAsking(o)}>
        <DialogContent title="Reset every event?" description="All entries, seats and tickets are deleted and every event opens again. This cannot be undone.">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="gray" size="lg" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="danger" size="lg" busy={busy} onClick={run}>Reset all</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}

export default function DemoTab({ drop, status, onChanged }: { drop: Drop | undefined; status: DemoStatus; onChanged: () => void }) {
  const { refreshDrops } = useApp()
  const changed = () => { refreshDrops(); onChanged() }
  return (
    <div className="space-y-4">
      <p className="type-caption">Demo tools. They only exist when the server is started with DEMO_TOOLS on.</p>
      <Crowd drop={drop} attempts={status.crowd.attempts} onChanged={changed} />
      <AddEvents templates={status.templates} onAdded={changed} />
      <Reset onDone={changed} />
    </div>
  )
}

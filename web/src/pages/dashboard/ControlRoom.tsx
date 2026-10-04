import { Flame, Gauge, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type LiveStats, type RunResult } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { loadRuns } from '@/lib/runs'
import { cn } from '@/lib/utils'

// PRD 11.2 targets for the bot advantage ratio.
const target: Record<string, number> = { S1: 0.2, S2: 0.5 }
const names: Record<string, string> = {
  S1: 'Naive farm', S2: 'Stealth farm', S3: 'Retry spammer', S4: 'Flooder', S5: 'Payment reuse', S6: 'Mixed attack',
}

function Step({ label, value, of, tone, note }: { label: string; value: number | null; of: number; tone: string; note: string }) {
  const pct = value === null || of <= 0 ? 0 : Math.max(value > 0 ? 1.5 : 0, Math.min(100, (value / of) * 100))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-strong">{label}</p>
        <p className="type-title tabular-nums">{value === null ? 'n/a' : formatNumber(value)}</p>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-fill">
        <div className={cn('h-full rounded-full transition-all duration-700', tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="type-caption mt-1">{note}</p>
    </div>
  )
}

function Funnel({ live }: { live: LiveStats | null }) {
  const entries = live?.entries ?? 0
  const winners = live ? live.slotsPending + live.slotsConfirmed : 0
  const drawn = live?.state === 'DRAWN' || live?.state === 'COMPLETE'
  const scored = live?.scored === true || (typeof live?.scored === 'string' && /done|scored|true/i.test(live.scored))
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Users className="size-5" aria-hidden />
        <h3 className="type-headline">The crowd, narrowed down</h3>
      </div>
      <p className="type-body mt-1">
        {live ? `${formatNumber(entries)} people entered for ${formatNumber(live.seats)} seats.` : 'Waiting for the first numbers.'}
        {live && entries > live.seats ? ` About 1 in ${Math.max(1, Math.round(entries / live.seats))} gets a seat.` : ''}
      </p>
      <div className="mt-5 space-y-5">
        <Step label="Entered" value={live ? entries : null} of={entries} tone="bg-ink" note="Each person once. Speed makes no difference." />
        <Step
          label="Seats won in the draw"
          value={live && drawn ? winners : null}
          of={entries}
          tone="bg-primary"
          note={drawn ? 'Drawn from the published seed. Anyone can check it.' : scored ? 'Scoring has run. The draw is next.' : 'Waiting for the organiser to close entries, score and draw.'}
        />
        <Step
          label="Seats paid for"
          value={live && drawn ? live.slotsConfirmed : null}
          of={Math.max(winners, 1)}
          tone="bg-ok"
          note="Winners pay with their own card. Unpaid seats move down the waitlist."
        />
      </div>
    </Card>
  )
}

interface Flood { ok: number; limited: number; other: number; ms: number }

// A flood from one address, fired from this browser, so the rate limit can be seen working.
function Door({ live }: { live: LiveStats | null }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Flood | null>(null)

  const fire = async () => {
    setBusy(true)
    setResult(null)
    const t0 = performance.now()
    const codes = await Promise.all(
      Array.from({ length: 90 }, () => fetch('/api/v1/pow/challenge?purpose=entry').then((r) => r.status).catch(() => 0)),
    )
    setResult({
      ok: codes.filter((c) => c === 200).length,
      limited: codes.filter((c) => c === 429).length,
      other: codes.filter((c) => c !== 200 && c !== 429).length,
      ms: Math.round(performance.now() - t0),
    })
    setBusy(false)
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Gauge className="size-5" aria-hidden />
        <h3 className="type-headline">At the door</h3>
      </div>
      <p className="type-body mt-1">Every login and entry needs a solved puzzle, and each address has a request limit.</p>
      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-fill px-4 py-3">
          <dt className="type-caption">Entries per minute</dt>
          <dd className="type-title tabular-nums">{live?.entriesPerMin != null ? formatNumber(live.entriesPerMin) : '...'}</dd>
        </div>
        <div className="rounded-2xl bg-fill px-4 py-3">
          <dt className="type-caption">Requests refused per minute</dt>
          <dd className="type-title tabular-nums">{live?.rateLimitedPerMin != null ? formatNumber(live.rateLimitedPerMin) : '...'}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-2xl border border-line p-4">
        <p className="type-strong">Try it as a bot</p>
        <p className="type-caption">Fires 90 requests at once from this address. Your own address is slowed for about a minute afterwards.</p>
        <Button variant="gray" size="sm" className="mt-3 w-full" busy={busy} onClick={fire}>
          <Flame className="size-4" aria-hidden /> Fire 90 requests
        </Button>
        {result && (
          <div className="mt-3 space-y-1.5" role="status">
            <div className="flex h-3 overflow-hidden rounded-full bg-fill">
              <div className="bg-ok" style={{ width: `${(result.ok / 90) * 100}%` }} />
              <div className="bg-danger" style={{ width: `${(result.limited / 90) * 100}%` }} />
            </div>
            <p className="type-body">
              <span className="type-strong text-ok">{result.ok} let through</span>, <span className="type-strong text-danger">{result.limited} refused</span>
              {result.other ? `, ${result.other} failed` : ''} in {(result.ms / 1000).toFixed(1)} s.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

interface Pair { scenario: string; before?: RunResult; after?: RunResult }

function Compare() {
  const [pairs, setPairs] = useState<Pair[] | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt: number) => {
      try {
        const files = await loadRuns()
        const by = new Map<string, Pair>()
        for (const f of files) {
          if (!f.botSharePercent) continue
          const p = by.get(f.scenario) ?? { scenario: f.scenario }
          if (f.defences?.scoring === false) p.before ??= f
          else p.after ??= f
          by.set(f.scenario, p)
        }
        if (alive) setPairs([...by.values()].sort((a, b) => a.scenario.localeCompare(b.scenario)))
      } catch {
        // A busy server can refuse this read, so try again a few times before showing an empty list.
        if (!alive) return
        if (attempt < 4) timer = setTimeout(() => load(attempt + 1), 6000)
        else setPairs([])
      }
    }
    load(0)
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  const bar = (v: number | undefined, t: number | undefined, label: string, cls: string) => {
    const scale = Math.max(1.2, v ?? 0)
    return (
      <div className="flex items-center gap-3">
        <span className="type-caption w-20 shrink-0">{label}</span>
        <div className="relative h-3 flex-1 rounded-full bg-fill">
          <div className={cn('h-full rounded-full', cls)} style={{ width: `${Math.min(100, ((v ?? 0) / scale) * 100)}%` }} />
          {t != null && <span aria-hidden className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${(t / scale) * 100}%` }} />}
        </div>
        <span className="type-strong w-12 text-right tabular-nums">{v == null ? 'n/a' : v.toFixed(2)}</span>
      </div>
    )
  }

  return (
    <section>
      <SectionTitle>Before and after the defences</SectionTitle>
      <Card>
        <p className="type-body">
          Bot advantage is the bots' share of winners divided by their share of entries. 1.0 means bots win in proportion to how many
          accounts they hold. Lower is better, and the line marks the target.
        </p>
        {!pairs ? <div aria-busy className="mt-4 h-24 animate-pulse rounded-2xl bg-fill" />
          : pairs.length === 0 ? <p className="type-body py-6 text-center">No simulator runs uploaded yet.</p>
          : (
            <div className="mt-4 space-y-5">
              {pairs.map((p) => {
                const t = target[p.scenario]
                const run = p.after ?? p.before!
                return (
                  <div key={p.scenario}>
                    <p className="type-strong">
                      {names[p.scenario] ?? p.scenario}
                      <span className="type-caption font-normal">, {run.botSharePercent}% bots</span>
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {bar(p.before?.botAdvantageRatio ?? (p.after ? 1 : undefined), t, 'No defences', 'bg-danger')}
                      {bar(p.after?.botAdvantageRatio, t, 'With defences', p.after && t != null && (p.after.botAdvantageRatio ?? 0) > t ? 'bg-warn' : 'bg-ok')}
                    </div>
                    {!p.before && <p className="type-caption mt-1">The no defences bar is 1.0 by definition. Run with scoring off to measure it.</p>}
                  </div>
                )
              })}
            </div>
          )}
      </Card>
    </section>
  )
}

export default function ControlRoom({ live }: { live: LiveStats | null }) {
  return (
    <section className="space-y-3">
      <SectionTitle>Control room</SectionTitle>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Funnel live={live} />
        <Door live={live} />
      </div>
      <Compare />
    </section>
  )
}

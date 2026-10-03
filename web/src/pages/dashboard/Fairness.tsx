import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type RunResult } from '@/api'
import { Card, SectionTitle } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Empty } from './shared'

// PRD 11.2 targets. Scenarios without a stated target only report the number.
const ratioTarget: Record<string, number> = { S1: 0.2, S2: 0.5 }
const MAX_RUNS = 12

const share = (x?: { honest: number; bot: number }) => (x && x.honest + x.bot > 0 ? x.bot / (x.honest + x.bot) : null)

function Bar({ label, value, className }: { label: string; value: number | null; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="type-caption w-28 shrink-0">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-fill">
        <div className={cn('h-full rounded-full', className)} style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }} />
      </div>
      <span className="type-strong w-14 text-right tabular-nums">{value === null ? 'n/a' : formatPercent(value)}</span>
    </div>
  )
}

function Guarantee({ ok, label }: { ok: boolean | undefined; label: string }) {
  if (ok === undefined) return null
  return (
    <span className={cn('inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[0.75rem] font-semibold', ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
      {ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
      {label}
    </span>
  )
}

function RunCard({ run }: { run: RunResult }) {
  const target = ratioTarget[run.scenario]
  const ratio = run.botAdvantageRatio
  const scale = Math.max(1, target ?? 0, ratio ?? 0)
  const g = run.hardGuarantees
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-headline">{run.scenario}{run.botSharePercent != null ? `, ${run.botSharePercent}% bots` : ''}</h3>
        <p className="type-caption truncate">{run.runId}</p>
      </div>

      <div className="mt-4 space-y-2">
        <Bar label="Bot entries" value={share(run.entries)} className="bg-line" />
        <Bar label="Bot winners" value={share(run.winners)} className="bg-ink" />
        <Bar label="Bot confirmed" value={share(run.confirmed)} className="bg-primary" />
      </div>

      {ratio != null && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <p className="type-strong">Bot advantage ratio</p>
            <p className={cn('type-strong tabular-nums', target != null && (ratio <= target ? 'text-ok' : 'text-danger'))}>
              {ratio.toFixed(2)}{target != null ? ` (target ${target} or less)` : ''}
            </p>
          </div>
          <div className="relative mt-2 h-2.5 rounded-full bg-fill">
            <div className={cn('h-full rounded-full', target != null && ratio > target ? 'bg-danger' : 'bg-ok')} style={{ width: `${Math.min(100, (ratio / scale) * 100)}%` }} />
            {target != null && <span aria-hidden className="absolute -top-1 h-4.5 w-0.5 bg-ink" style={{ left: `${(target / scale) * 100}%` }} />}
          </div>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-fill px-2 py-2.5">
          <dd className="type-strong tabular-nums">{run.falsePositiveRate != null ? formatPercent(run.falsePositiveRate) : 'n/a'}</dd>
          <dt className="type-caption">False positives</dt>
        </div>
        <div className="rounded-2xl bg-fill px-2 py-2.5">
          <dd className="type-strong tabular-nums">{run.latencyMs?.entryP95 != null ? `${formatNumber(run.latencyMs.entryP95)} ms` : 'n/a'}</dd>
          <dt className="type-caption">Entry p95</dt>
        </div>
        <div className="rounded-2xl bg-fill px-2 py-2.5">
          <dd className="type-strong tabular-nums">{run.latencyMs?.statusP95 != null ? `${formatNumber(run.latencyMs.statusP95)} ms` : 'n/a'}</dd>
          <dt className="type-caption">Status p95</dt>
        </div>
      </dl>

      {g && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Guarantee ok={g.oversoldSeats === undefined ? undefined : g.oversoldSeats === 0} label="No oversold seats" />
          <Guarantee ok={g.cardsWithTwoSeats === undefined ? undefined : g.cardsWithTwoSeats === 0} label="One seat per card" />
          <Guarantee ok={g.drawReproducible} label="Draw reproducible" />
        </div>
      )}
    </Card>
  )
}

// Results of the simulator runs. Renders whatever has been uploaded so far.
export default function Fairness() {
  const [runs, setRuns] = useState<RunResult[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const list = (await api.admin.runs()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_RUNS)
        const files = await Promise.all(list.map((r) => api.admin.run(r.runId).catch(() => null)))
        if (alive) setRuns(files.filter((f): f is RunResult => !!f).sort((a, b) => a.scenario.localeCompare(b.scenario)))
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <section>
      <SectionTitle>Fairness results</SectionTitle>
      {failed ? <Card><Empty>Results are not available yet.</Empty></Card>
        : !runs ? <div aria-busy className="surface h-40 animate-pulse rounded-card" />
        : runs.length === 0 ? <Card><Empty>No test runs uploaded yet.</Empty></Card>
        : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{runs.map((r) => <RunCard key={r.runId} run={r} />)}</div>}
    </section>
  )
}

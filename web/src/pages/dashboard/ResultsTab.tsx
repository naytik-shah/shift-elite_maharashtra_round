import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RunResult } from '@/api'
import { Bars } from '@/components/charts'
import { Card } from '@/components/ui/card'
import { formatNumber, formatPercent } from '@/lib/format'
import { loadRuns } from '@/lib/runs'
import { Empty } from './shared'

// PRD 11.2 targets for the bot advantage ratio.
const target: Record<string, number> = { S1: 0.2, S2: 0.5 }
const names: Record<string, string> = {
  S0: 'Honest only', S1: 'Naive farm', S2: 'Stealth farm', S3: 'Retry spammer', S4: 'Flooder', S5: 'Payment reuse', S6: 'Mixed attack',
}

interface Pair { scenario: string; before?: RunResult; after?: RunResult }

function Guarantee({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="type-body flex items-center gap-2">
      {ok ? <Check className="size-4 text-ok" strokeWidth={3} aria-hidden /> : <X className="size-4 text-danger" strokeWidth={3} aria-hidden />}
      <span className={ok ? undefined : 'text-danger'}>{label}</span>
    </li>
  )
}

export default function ResultsTab() {
  const [runs, setRuns] = useState<RunResult[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = (attempt: number) => loadRuns()
      .then((r) => alive && setRuns(r))
      .catch(() => {
        // A busy server can refuse this read, so try again a few times before giving up.
        if (!alive) return
        if (attempt < 4) timer = setTimeout(() => load(attempt + 1), 6000)
        else setFailed(true)
      })
    load(0)
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  if (failed) return <Card><Empty>Results are not available right now.</Empty></Card>
  if (!runs) return <div aria-busy className="surface h-64 animate-pulse rounded-card" />

  const real = runs.filter((r) => (r.botSharePercent ?? 0) > 0)
  if (real.length === 0) return <Card><Empty>No simulator runs uploaded yet. Run a scenario and it appears here.</Empty></Card>

  const by = new Map<string, Pair>()
  for (const f of real) {
    const p = by.get(f.scenario) ?? { scenario: f.scenario }
    if (f.defences?.scoring === false) p.before ??= f
    else p.after ??= f
    by.set(f.scenario, p)
  }
  // Newest run first, so the first one seen for a scenario is its latest.
  const latestByScenario = [...new Map(real.map((r) => [r.scenario, r] as const)).values()].sort((a, b) => a.scenario.localeCompare(b.scenario))
  const pairs = [...by.values()].filter((p) => (p.after ?? p.before)!.entries && ((p.after ?? p.before)!.entries!.bot >= 30)).sort((a, b) => a.scenario.localeCompare(b.scenario))
  const g = runs.map((r) => r.hardGuarantees).filter(Boolean)
  const all = (f: (x: NonNullable<RunResult['hardGuarantees']>) => boolean | undefined) => g.length > 0 && g.every((x) => f(x!) !== false)

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h3 className="type-headline">Bot advantage with and without the defences</h3>
        <p className="type-caption mt-0.5">Bots' share of winners divided by their share of entries. 1.0 means no defence. The line is the target.</p>
        <div className="mt-5 space-y-6">
          {pairs.map((p) => {
            const run = (p.after ?? p.before)!
            const t = target[p.scenario]
            return (
              <div key={p.scenario}>
                <p className="type-strong">{names[p.scenario] ?? p.scenario} <span className="type-caption font-normal">{run.botSharePercent}% bots</span></p>
                {(run.winners?.bot ?? 0) > 0 && (
                  <p className="type-caption">{formatNumber(run.winners!.bot)} bot wins, {formatNumber(run.confirmed?.bot ?? 0)} could pay</p>
                )}
                <div className="mt-2">
                  <Bars
                    max={1.2}
                    rows={[
                      { label: 'No defences', value: p.before?.botAdvantageRatio ?? 1, color: 'var(--muted)' },
                      { label: 'With defences', value: p.after?.botAdvantageRatio ?? null, color: 'var(--primary)', mark: t },
                    ]}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <p className="type-caption mt-5">No defences is 1.0 by definition until a run with scoring off is uploaded. The stealth farm figure comes from a model that saw one stealth style during training, so read it as a best case.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-x-auto p-0 sm:p-0 lg:col-span-2">
          <table className="w-full min-w-[34rem] text-left">
            <caption className="sr-only">Latest run for each scenario</caption>
            <thead>
              <tr className="type-caption border-b border-line">
                <th className="px-4 py-3 font-semibold">Scenario</th>
                <th className="px-2 py-3 text-right font-semibold">Bots in</th>
                <th className="px-2 py-3 text-right font-semibold">Bot wins</th>
                <th className="px-2 py-3 text-right font-semibold">Bots paid</th>
                <th className="px-2 py-3 text-right font-semibold">Honest wrongly lowered</th>
                <th className="px-4 py-3 text-right font-semibold">Entry p95</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {latestByScenario.map((r) => (
                <tr key={r.runId}>
                  <td className="type-strong px-4 py-2.5">{names[r.scenario] ?? r.scenario}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(r.entries?.bot ?? 0)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(r.winners?.bot ?? 0)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatNumber(r.confirmed?.bot ?? 0)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.falsePositiveRate != null ? formatPercent(r.falsePositiveRate) : 'n/a'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.latencyMs?.entryP95 != null ? `${formatNumber(r.latencyMs.entryP95)} ms` : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-4 sm:p-5">
          <h3 className="type-headline">Guarantees held in every run</h3>
          <ul className="mt-3 space-y-2">
            <Guarantee ok={all((x) => x.oversoldSeats === undefined ? undefined : x.oversoldSeats === 0)} label="No oversold seats" />
            <Guarantee ok={all((x) => x.cardsWithTwoSeats === undefined ? undefined : x.cardsWithTwoSeats === 0)} label="One seat per card" />
            <Guarantee ok={all((x) => x.usersWithTwoEntries === undefined ? undefined : x.usersWithTwoEntries === 0)} label="One entry per person" />
            <Guarantee ok={all((x) => x.drawReproducible)} label="Draw reproducible" />
          </ul>
        </Card>
      </div>
    </div>
  )
}

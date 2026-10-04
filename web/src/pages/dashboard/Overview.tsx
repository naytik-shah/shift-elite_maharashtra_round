import type { LiveStats } from '@/api'
import { AreaChart, Donut, Legend } from '@/components/charts'
import { Card } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'

export interface History { entries: number[]; refused: number[]; seconds: number }

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <dt className="type-caption">{label}</dt>
      <dd className="type-title mt-0.5 tabular-nums">{value}</dd>
      {note && <p className="type-caption truncate">{note}</p>}
    </div>
  )
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="type-headline">{title}</h3>
        {note && <p className="type-caption">{note}</p>}
      </div>
      {children}
    </Card>
  )
}

function Step({ label, value, of, color, note }: { label: string; value: number | null; of: number; color: string; note: string }) {
  const pct = value === null || of <= 0 ? 0 : Math.max(value > 0 ? 1 : 0, Math.min(100, (value / of) * 100))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="type-strong">{label}</p>
        <p className="type-strong tabular-nums">{value === null ? 'Not yet' : formatNumber(value)}</p>
      </div>
      <div className="mt-1.5 h-2 rounded-sm bg-fill"><div className="h-full rounded-sm transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} /></div>
      <p className="type-caption mt-1">{note}</p>
    </div>
  )
}

export default function Overview({ live, history }: { live: LiveStats | null; history: History }) {
  const entered = live?.entries ?? 0
  const drawn = live?.state === 'DRAWN' || live?.state === 'COMPLETE'
  const won = live ? live.slotsPending + live.slotsConfirmed + live.slotsUnfilled : 0
  const paid = live?.slotsConfirmed ?? 0
  const ratio = live && live.seats > 0 && entered > live.seats ? `1 in ${Math.round(entered / live.seats)} gets a seat` : undefined
  const secs = history.entries.length * history.seconds
  const span = history.entries.length > 1 ? (secs < 90 ? `Last ${Math.round(secs)} seconds` : `Last ${Math.round(secs / 60)} minutes`) : 'Waiting for data'

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-card border border-line bg-surface sm:grid-cols-4 sm:divide-y-0">
        <Kpi label="Entered" value={live ? formatNumber(entered) : '…'} note={ratio} />
        <Kpi label="Seats" value={live ? formatNumber(live.seats) : '…'} note={live?.state === 'OPEN' ? 'Entries open' : undefined} />
        <Kpi label="Refused per minute" value={live?.rateLimitedPerMin != null ? formatNumber(live.rateLimitedPerMin) : '…'} note="Rate limits at work" />
        <Kpi label="Seats paid for" value={drawn ? `${formatNumber(paid)} of ${formatNumber(won)}` : 'Not yet'} />
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Traffic" note={span}>
            <AreaChart
              series={[
                { name: 'Entries per minute', color: 'var(--ink)', values: history.entries },
                { name: 'Refused per minute', color: 'var(--primary)', values: history.refused },
              ]}
            />
            <Legend
              className="mt-3 flex flex-wrap gap-x-6"
              items={[
                { label: 'Entries per minute', value: String(history.entries.at(-1) ?? 0), color: 'var(--ink)' },
                { label: 'Refused per minute', value: String(history.refused.at(-1) ?? 0), color: 'var(--primary)' },
              ]}
            />
          </Panel>
        </div>
        <Panel title="Seat slots" note={drawn ? undefined : 'After the draw'}>
          <Donut
            slices={[
              { label: 'Paid', value: live?.slotsConfirmed ?? 0, color: 'var(--ok)' },
              { label: 'Waiting to pay', value: live?.slotsPending ?? 0, color: 'var(--primary)' },
              { label: 'Unfilled', value: live?.slotsUnfilled ?? 0, color: 'var(--muted)' },
            ]}
            centre={
              <div>
                <p className="type-title tabular-nums">{drawn ? formatNumber(won) : formatNumber(live?.seats ?? 0)}</p>
                <p className="type-caption">{drawn ? 'seats' : 'seats to give'}</p>
              </div>
            }
          />
          <Legend
            className="mt-4"
            items={[
              { label: 'Paid', value: formatNumber(live?.slotsConfirmed ?? 0), color: 'var(--ok)' },
              { label: 'Waiting to pay', value: formatNumber(live?.slotsPending ?? 0), color: 'var(--primary)' },
              { label: 'Unfilled', value: formatNumber(live?.slotsUnfilled ?? 0), color: 'var(--muted)' },
              { label: 'Waitlist left', value: formatNumber(live?.waitlistLeft ?? 0), color: 'var(--line)' },
            ]}
          />
        </Panel>
      </div>

      <Panel title="The crowd, narrowed down" note={live ? `${formatNumber(entered)} people for ${formatNumber(live.seats)} seats` : undefined}>
        <div className="grid gap-5 md:grid-cols-3">
          <Step label="Entered" value={live ? entered : null} of={entered} color="var(--ink)" note="One entry each. Speed makes no difference." />
          <Step label="Won a seat" value={drawn ? won : null} of={entered} color="var(--primary)" note={drawn ? 'Drawn from the published seed.' : 'Waiting for close, scoring and the draw.'} />
          <Step label="Paid" value={drawn ? paid : null} of={Math.max(won, 1)} color="var(--ok)" note="Unpaid seats move down the waitlist." />
        </div>
      </Panel>
    </div>
  )
}

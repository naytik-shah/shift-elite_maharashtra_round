import { useState } from 'react'
import type { AuditEvent, Slot, SlotState } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Card, SectionTitle } from '@/components/ui/card'
import { formatNumber, formatTime, shortHash } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Empty } from './shared'

const tone: Record<SlotState, 'primary' | 'ok' | 'neutral'> = { PENDING: 'primary', CONFIRMED: 'ok', UNFILLED: 'neutral' }
const SHOWN = 100

export function SlotTable({ slots }: { slots: Slot[] | null }) {
  const [filter, setFilter] = useState<SlotState | 'ALL'>('ALL')
  const list = (slots ?? []).filter((s) => filter === 'ALL' || s.state === filter)
  return (
    <section>
      <SectionTitle>Seat slots</SectionTitle>
      <Card className="p-0 sm:p-0">
        <div className="flex gap-1.5 overflow-x-auto p-3">
          {(['ALL', 'PENDING', 'CONFIRMED', 'UNFILLED'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn('h-9 shrink-0 rounded-lg px-3.5 text-[0.8125rem] font-semibold', filter === f ? 'bg-ink text-bg' : 'bg-fill text-ink')}
            >
              {f === 'ALL' ? 'All' : f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {!slots ? <Empty>Loading</Empty> : list.length === 0 ? <Empty>{slots.length ? 'No slots in this state.' : 'Slots are created by the draw.'}</Empty> : (
          <div className="max-h-80 overflow-auto border-t border-line">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-surface">
                <tr className="type-caption">
                  <th className="px-4 py-2 font-semibold">Slot</th>
                  <th className="px-2 py-2 font-semibold">State</th>
                  <th className="px-2 py-2 font-semibold">Entry</th>
                  <th className="px-4 py-2 text-right font-semibold">Confirm by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.slice(0, SHOWN).map((s) => (
                  <tr key={s.slotNo}>
                    <td className="type-strong px-4 py-2 tabular-nums">{s.slotNo}</td>
                    <td className="px-2 py-2"><Badge tone={tone[s.state]}>{s.state[0] + s.state.slice(1).toLowerCase()}</Badge></td>
                    <td className="type-caption px-2 py-2 font-mono">{s.entryId ? shortHash(s.entryId, 8, 4) : ''}</td>
                    <td className="type-caption px-4 py-2 text-right tabular-nums">{s.confirmBy ? formatTime(s.confirmBy) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length > SHOWN && <p className="type-caption border-t border-line px-4 py-2.5">Showing the first {SHOWN} of {formatNumber(list.length)}.</p>}
      </Card>
    </section>
  )
}

function pretty(payload: string) {
  try {
    return Object.entries(JSON.parse(payload) as Record<string, unknown>)
      .map(([k, v]) => `${k} ${typeof v === 'string' && v.length > 16 ? shortHash(v, 8, 4) : String(v)}`)
      .join(', ')
  } catch {
    return payload
  }
}

export function AuditList({ events }: { events: AuditEvent[] | null }) {
  const list = events ? [...events].sort((a, b) => b.seq - a.seq) : []
  return (
    <section>
      <SectionTitle>Audit log</SectionTitle>
      <Card className="p-0 sm:p-0">
        {!events ? <Empty>Loading</Empty> : list.length === 0 ? <Empty>Nothing logged yet.</Empty> : (
          <ol className="max-h-80 divide-y divide-line overflow-auto">
            {list.slice(0, SHOWN).map((e) => (
              <li key={e.seq} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="type-strong">{e.type}</p>
                  <p className="type-caption shrink-0 tabular-nums">#{e.seq}, {formatTime(e.at)}</p>
                </div>
                <p className="type-caption truncate">{pretty(e.payload)}</p>
                <p className="type-caption truncate font-mono" title={e.hash}>hash {shortHash(e.hash, 10, 6)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  )
}

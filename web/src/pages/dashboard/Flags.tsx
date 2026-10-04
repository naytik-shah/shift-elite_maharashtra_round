import { useEffect, useState } from 'react'
import { api, errorMessage, type Flag, type FlagDetail, type FlagPage } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatNumber, shortHash } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Empty } from './shared'

const tiers = [
  { name: 'High', min: 85, max: 100 },
  { name: 'Medium', min: 60, max: 84 },
  { name: 'Low', min: 30, max: 59 },
  { name: 'Clean', min: 0, max: 29 },
] as const

const tierOf = (risk: number) => tiers.find((t) => risk >= t.min)!.name
const tone = { High: 'warn', Medium: 'primary', Low: 'neutral', Clean: 'ok' } as const

function Detail({ dropId, entryId, onPick }: { dropId: string; entryId: string; onPick: (id: string) => void }) {
  const [detail, setDetail] = useState<FlagDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError('')
    api.admin.flag(dropId, entryId)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => { alive = false }
  }, [dropId, entryId])

  if (error) return <p role="alert" className="type-body">{error}</p>
  if (!detail) return <div aria-busy className="h-40 animate-pulse rounded-lg bg-fill" />

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg bg-fill px-4 py-3"><p className="type-caption">Risk</p><p className="type-title tabular-nums">{detail.risk}</p></div>
        <div className="rounded-lg bg-fill px-4 py-3"><p className="type-caption">Draw weight</p><p className="type-title tabular-nums">{detail.weight}</p></div>
      </div>

      <div>
        <p className="type-strong mb-2">Signals</p>
        <div className="space-y-2">
          {(Object.entries(detail.signals ?? {}) as [string, number][]).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="type-body w-14">{k === 'ip' ? 'IP' : k[0].toUpperCase() + k.slice(1)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%` }} /></div>
              <span className="type-caption w-9 text-right tabular-nums">{Math.round(v * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="type-strong mb-1">Why the weight is lower</p>
        {detail.reasons?.length ? (
          <ul className="type-body list-disc space-y-1 pl-5">{detail.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : <p className="type-body">No reasons recorded.</p>}
      </div>

      <div>
        <p className="type-strong mb-1">Linked entries</p>
        {detail.linkedEntries?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {detail.linkedEntries.map((id) => (
              <button key={id} onClick={() => onPick(id)} className="h-9 rounded-lg bg-fill px-3 font-mono text-[0.8125rem]">{shortHash(id, 8, 4)}</button>
            ))}
          </div>
        ) : <p className="type-body">None.</p>}
      </div>
    </div>
  )
}

const MAX_HOPS = 10

// The endpoint only takes a lower bound and its sort order is not pinned, so pages are
// read until some rows inside the tier turn up, and the upper bound is applied here.
async function loadTier(dropId: string, tier: (typeof tiers)[number], from: number) {
  const rows: Flag[] = []
  let page = from
  let more = false
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res: FlagPage = await api.admin.flags(dropId, tier.min, page)
    const got = res.flags ?? []
    rows.push(...got.filter((f) => f.risk >= tier.min && f.risk <= tier.max))
    more = got.length > 0 && (page - 1) * got.length + got.length < (res.total ?? 0)
    page++
    if (rows.length > 0 || !more) break
  }
  return { rows, next: more ? page : null }
}

// Entries the scoring step gave a lower weight, with the evidence. Wording stays neutral:
// a lower weight is not a verdict on the person.
export default function Flags({ dropId, version }: { dropId: string; version: number }) {
  const [tier, setTier] = useState<(typeof tiers)[number]>(tiers[0])
  const [rows, setRows] = useState<Flag[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<false | 'missing' | 'error'>(false)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    setNext(null)
    setFailed(false)
    loadTier(dropId, tier, 1)
      .then((r) => { if (alive) { setRows(r.rows); setNext(r.next) } })
      .catch((err) => alive && setFailed(err?.status === 404 ? 'missing' : 'error'))
    return () => { alive = false }
  }, [dropId, tier, version])

  const loadMore = async () => {
    if (busy || next === null) return
    setBusy(true)
    try {
      const r = await loadTier(dropId, tier, next)
      setRows((cur) => [...(cur ?? []), ...r.rows])
      setNext(r.next)
    } catch {
      setFailed('error')
    } finally {
      setBusy(false)
    }
  }

  const sorted = rows ? [...rows].sort((a, b) => b.risk - a.risk) : null

  return (
    <section>
      <SectionTitle>Flagged entries</SectionTitle>
      <Card className="p-0 sm:p-0">
        <div className="flex gap-1.5 overflow-x-auto p-3">
          {tiers.map((t) => (
            <button
              key={t.name}
              onClick={() => setTier(t)}
              aria-pressed={tier.name === t.name}
              className={cn('h-9 shrink-0 rounded-lg px-3.5 text-[0.8125rem] font-semibold', tier.name === t.name ? 'bg-ink text-bg' : 'bg-fill text-ink')}
            >
              {t.name} {t.min} to {t.max}
            </button>
          ))}
        </div>

        {failed === 'missing' ? <Empty>Flags are not available yet. They appear once scoring is switched on.</Empty> : failed ? <Empty>Could not load flags.</Empty> : !sorted ? <Empty>Loading</Empty> : sorted.length === 0 ? (
          <Empty>No entries in this tier. Scores appear after scoring runs.</Empty>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="type-caption">
                  <th className="px-4 py-2 font-semibold">Entry</th>
                  <th className="px-2 py-2 font-semibold">Risk</th>
                  <th className="px-2 py-2 font-semibold">Weight</th>
                  <th className="px-4 py-2 text-right font-semibold">Cluster</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((f) => (
                  <tr key={f.entryId} onClick={() => setOpen(f.entryId)} className="cursor-pointer hover:bg-fill">
                    <td className="px-4 py-2.5">
                      <button className="type-strong font-mono" onClick={(e) => { e.stopPropagation(); setOpen(f.entryId) }}>{shortHash(f.entryId, 8, 4)}</button>
                    </td>
                    <td className="px-2 py-2.5"><Badge tone={tone[tierOf(f.risk)]}>{f.risk}</Badge></td>
                    <td className="type-strong px-2 py-2.5 tabular-nums">{f.weight}</td>
                    <td className="type-caption px-4 py-2.5 text-right">{f.clusterId ? `${f.clusterId}, ${formatNumber(f.clusterSize ?? 0)} linked` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {next !== null && !failed && (
          <div className="border-t border-line p-3">
            <Button variant="gray" size="sm" busy={busy} onClick={loadMore} className="w-full">Load more</Button>
          </div>
        )}
      </Card>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent title="Entry evidence" description={shortHash(open, 12, 6)}>
            <Detail dropId={dropId} entryId={open} onPick={setOpen} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}

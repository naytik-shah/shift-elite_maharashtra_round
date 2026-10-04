import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { phaseOf } from '@/lib/eventStatus'
import { go } from '@/lib/router'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'
import Controls from './dashboard/Controls'
import DemoTab from './dashboard/DemoTab'
import Flags from './dashboard/Flags'
import Overview, { type History } from './dashboard/Overview'
import ProofOfProtection from './dashboard/ProofOfProtection'
import ResultsTab from './dashboard/ResultsTab'
import { usePoll } from './dashboard/shared'
import { AuditList, SlotTable } from './dashboard/Tables'

const baseTabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'security', label: 'Security' },
  { id: 'results', label: 'Results' },
  { id: 'activity', label: 'Activity' },
] as const
type Tab = (typeof baseTabs)[number]['id'] | 'demo'

const POLL_MS = 3000
const KEEP = 60

function savedTab(): Tab {
  try {
    const t = sessionStorage.getItem('fd.dtab')
    if (t === 'demo' || baseTabs.some((x) => x.id === t)) return t as Tab
  } catch { /* storage can be blocked */ }
  return 'overview'
}

export default function Dashboard({ id }: { id?: string }) {
  const { user, loading, drops, openFlow, refreshDrops } = useApp()
  // Drops taking entries come first, so the live ones are what the organiser sees.
  const rank = (d: (typeof drops)[number]) => (phaseOf(d) === 'open' ? 0 : phaseOf(d) === 'drawn' ? 1 : 2)
  const ordered = [...drops].sort((a, b) => rank(a) - rank(b))
  const dropId = id ?? ordered[0]?.id
  const drop = drops.find((d) => d.id === dropId)
  // Bumped after every organiser action, so the flag list reloads once scoring has run.
  const [version, setVersion] = useState(0)
  const [tab, setTab] = useState<Tab>(savedTab)
  const [history, setHistory] = useState<History>({ entries: [], refused: [], seconds: POLL_MS / 1000 })

  const isOrganiser = user?.role === 'organiser'
  const enabled = isOrganiser && !!dropId
  const live = usePoll(() => (enabled ? api.admin.live(dropId!) : Promise.reject()), POLL_MS, [dropId, enabled])
  // The demo tab only appears when the server has the demo tools switched on.
  const demo = usePoll(() => (enabled ? api.admin.demo.status() : Promise.reject()), 60_000, [enabled])
  const tabs = demo.data ? [...baseTabs, { id: 'demo' as const, label: 'Demo' }] : baseTabs
  const slots = usePoll(() => (enabled && tab === 'activity' ? api.admin.slots(dropId!) : Promise.reject()), 8000, [dropId, enabled, tab])
  const audit = usePoll(() => (enabled && tab === 'activity' ? api.admin.audit(dropId!) : Promise.reject()), 12000, [dropId, enabled, tab])

  // A rolling window of the live numbers, so the traffic chart has a real time series behind it.
  const seen = useRef<unknown>(null)
  useEffect(() => { setHistory({ entries: [], refused: [], seconds: POLL_MS / 1000 }); seen.current = null }, [dropId])
  useEffect(() => {
    const d = live.data
    if (!d || seen.current === d) return
    seen.current = d
    setHistory((h) => ({
      ...h,
      entries: [...h.entries, d.entriesPerMin ?? 0].slice(-KEEP),
      refused: [...h.refused, d.rateLimitedPerMin ?? 0].slice(-KEEP),
    }))
  }, [live.data])

  const pick = (t: Tab) => {
    setTab(t)
    try { sessionStorage.setItem('fd.dtab', t) } catch { /* ignore */ }
  }

  if (loading) return <div aria-busy className="surface h-40 animate-pulse rounded-card" />
  if (!isOrganiser) {
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="type-title">Organisers only</h1>
        <p className="type-body mt-1">{user ? 'This account cannot open the dashboard.' : 'Log in with an organiser account.'}</p>
        {!user && <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('login')}>Log in</Button>}
      </Card>
    )
  }

  const changed = () => { live.refresh(); slots.refresh(); audit.refresh(); refreshDrops(); setVersion((v) => v + 1) }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="type-display truncate">{drop?.name ?? 'Organiser'}</h1>
          <p className="type-body mt-1">Organiser view{live.data ? `, ${live.data.state.toLowerCase()}` : ''}</p>
        </div>
        <label className="block">
          <span className="sr-only">Drop</span>
          <select
            value={dropId ?? ''}
            onChange={(e) => go('dashboard', e.target.value)}
            className="type-strong h-10 max-w-[16rem] rounded-lg border border-line bg-surface px-3 text-ink outline-none focus:border-primary"
          >
            {ordered.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </header>

      {!dropId ? <Card><p className="type-body">No drops yet.</p></Card> : (
        <>
          {live.failed && !live.data && (
            live.error instanceof ApiError && (live.error.status === 401 || live.error.status === 403) ? (
              <p role="alert" className="type-strong rounded-lg bg-warn-soft px-4 py-3 text-warn">
                This browser is signed in as a different account, so the organiser numbers are locked. Open the organiser view on its own address, 127.0.0.1:5180, or sign in as the organiser again.
              </p>
            ) : live.error instanceof ApiError && live.error.status === 429 ? (
              <p role="alert" className="type-strong rounded-lg bg-warn-soft px-4 py-3 text-warn">Too many requests from this address. The counts resume in a moment.</p>
            ) : (
              <p role="alert" className="type-strong rounded-lg bg-warn-soft px-4 py-3 text-warn">Live counts are not loading. Retrying…</p>
            )
          )}
          <Controls dropId={dropId} live={live.data} onChange={changed} />

          <div role="tablist" aria-label="Dashboard sections" className="flex gap-6 border-b border-line">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => pick(t.id)}
                className={cn(
                  'type-strong -mb-px h-11 border-b-2 border-transparent text-muted transition-colors hover:text-ink',
                  tab === t.id && 'border-primary text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'overview' && <Overview live={live.data} history={history} />}
            {tab === 'security' && <ProofOfProtection dropId={dropId} live={live.data} />}
            {tab === 'results' && <ResultsTab />}
            {tab === 'demo' && demo.data && <DemoTab drop={drop} status={demo.data} onChanged={() => { changed(); setHistory({ entries: [], refused: [], seconds: POLL_MS / 1000 }) }} />}
            {tab === 'activity' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SlotTable slots={slots.data ?? (slots.failed ? [] : null)} />
                  <AuditList events={audit.data ?? (audit.failed ? [] : null)} />
                </div>
                <Flags dropId={dropId} version={version} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

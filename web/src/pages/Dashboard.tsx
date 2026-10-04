import { useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { go } from '@/lib/router'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'
import Controls from './dashboard/Controls'
import ControlRoom from './dashboard/ControlRoom'
import Fairness from './dashboard/Fairness'
import Flags from './dashboard/Flags'
import { usePoll } from './dashboard/shared'
import { AuditList, SlotTable } from './dashboard/Tables'

export default function Dashboard({ id }: { id?: string }) {
  const { user, loading, drops, openFlow, refreshDrops } = useApp()
  // Drops that are taking entries come first, so the live ones are what the organiser sees.
  const ordered = [...drops].sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN'))
  const dropId = id ?? ordered[0]?.id
  // Bumped after every organiser action, so the flag list reloads once scoring has run.
  const [version, setVersion] = useState(0)

  const isOrganiser = user?.role === 'organiser'
  const enabled = isOrganiser && !!dropId
  const live = usePoll(() => (enabled ? api.admin.live(dropId!) : Promise.reject()), 3000, [dropId, enabled])
  const slots = usePoll(() => (enabled ? api.admin.slots(dropId!) : Promise.reject()), 8000, [dropId, enabled])
  const audit = usePoll(() => (enabled ? api.admin.audit(dropId!) : Promise.reject()), 12000, [dropId, enabled])

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
    <div className="space-y-7">
      <div>
        <h1 className="type-display px-1">Dashboard</h1>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ordered.map((d) => (
            <button
              key={d.id}
              onClick={() => go('dashboard', d.id)}
              aria-pressed={d.id === dropId}
              className={cn('type-strong h-11 shrink-0 rounded-full px-4', d.id === dropId ? 'border border-ink bg-ink text-bg' : 'surface text-ink')}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      {!dropId ? <Card><p className="type-body">No drops yet.</p></Card> : (
        <>
          {live.failed && !live.data && <p role="alert" className="type-strong rounded-2xl bg-warn-soft px-4 py-3 text-warn">Live counts are not loading. Retrying.</p>}
          <Controls dropId={dropId} live={live.data} onChange={changed} />
          <ControlRoom live={live.data} />
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-2 lg:gap-6">
            <SlotTable slots={slots.data ?? (slots.failed ? [] : null)} />
            <AuditList events={audit.data ?? (audit.failed ? [] : null)} />
          </div>
          <Flags dropId={dropId} version={version} />
          <Fairness />
        </>
      )}
    </div>
  )
}

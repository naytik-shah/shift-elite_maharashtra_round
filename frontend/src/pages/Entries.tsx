import { useEffect } from 'react'
import EventCard from '@/components/EventCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { go } from '@/lib/router'
import { useApp } from '@/state'

export default function Entries() {
  const { user, drops, entries, refreshEntries, openFlow } = useApp()

  // Results arrive while the user is elsewhere, so look again every few seconds on this page.
  useEffect(() => {
    refreshEntries()
    const id = setInterval(refreshEntries, 10_000)
    return () => clearInterval(id)
  }, [refreshEntries])

  const mine = drops.flatMap((d) => (entries[d.id] ? [{ drop: d, entry: entries[d.id]! }] : []))
  const action = mine.filter((m) => m.entry.state === 'WON')
  const rest = mine.filter((m) => m.entry.state !== 'WON')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="px-1 text-2xl font-bold tracking-tight">My entries</h1>

      {!user ? (
        <Card>
          <h2 className="text-xl font-bold tracking-tight">Sign in to see your entries</h2>
          <p className="mt-1 text-sm text-muted">Every drop you enter shows up here with its result.</p>
          <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('signin')}>Sign in</Button>
        </Card>
      ) : mine.length === 0 ? (
        <Card>
          <h2 className="text-xl font-bold tracking-tight">No entries yet</h2>
          <p className="mt-1 text-sm text-muted">Pick a drop and enter once. Your status and result will be here.</p>
          <Button size="lg" className="mt-5 w-full" onClick={() => go('explore')}>Explore events</Button>
        </Card>
      ) : (
        <>
          {action.length > 0 && (
            <section>
              <SectionTitle>Needs your action</SectionTitle>
              <div className="space-y-3">
                {action.map((m) => <EventCard key={m.drop.id} drop={m.drop} entry={m.entry} />)}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <SectionTitle>{action.length > 0 ? 'Everything else' : 'Your drops'}</SectionTitle>
              <div className="space-y-3">
                {rest.map((m) => <EventCard key={m.drop.id} drop={m.drop} entry={m.entry} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

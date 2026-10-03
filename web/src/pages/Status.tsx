import { useEffect } from 'react'
import EventCard from '@/components/EventCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { go } from '@/lib/router'
import { useApp } from '@/state'

export default function Status() {
  const { user, drops, entries, refreshEntries, openFlow } = useApp()

  // Results arrive while the user is elsewhere, so look again every 5 seconds on this page.
  useEffect(() => {
    refreshEntries()
    const id = setInterval(refreshEntries, 5000)
    return () => clearInterval(id)
  }, [refreshEntries])

  const mine = drops.flatMap((d) => (entries[d.id] ? [{ drop: d, entry: entries[d.id]! }] : []))
  const action = mine.filter((m) => m.entry.state === 'WON')
  const rest = mine.filter((m) => m.entry.state !== 'WON')
  const loading = !!user && drops.some((d) => entries[d.id] === undefined)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="type-display px-1">My status</h1>

      {!user ? (
        <Card>
          <h2 className="type-title">Log in to see your status</h2>
          <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('login')}>Log in</Button>
        </Card>
      ) : loading && mine.length === 0 ? (
        <div aria-busy className="surface h-[6.75rem] animate-pulse rounded-card" />
      ) : mine.length === 0 ? (
        <Card>
          <h2 className="type-title">No entries yet</h2>
          <p className="type-body mt-1">Drops you enter show up here.</p>
          <Button size="lg" className="mt-5 w-full" onClick={() => go('drops')}>Browse drops</Button>
        </Card>
      ) : (
        <>
          {action.length > 0 && (
            <section>
              <SectionTitle>Confirm now</SectionTitle>
              <div className="space-y-3">
                {action.map((m) => <EventCard key={m.drop.id} drop={m.drop} entry={m.entry} />)}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <SectionTitle>{action.length > 0 ? 'Other drops' : 'Your drops'}</SectionTitle>
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

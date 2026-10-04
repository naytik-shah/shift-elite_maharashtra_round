import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import DropHero from '@/components/DropHero'
import EventCard from '@/components/EventCard'
import InstallCard from '@/components/InstallCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { phaseOf } from '@/lib/eventStatus'
import { href } from '@/lib/router'
import { useApp } from '@/state'

export default function Explore() {
  const { drops, dropsLoading, dropsFailed, retryDrops, refreshDrops, entries } = useApp()
  const [query, setQuery] = useState('')

  // Phases change while the page is open (a window opens, a draw runs), so keep the list fresh.
  useEffect(() => {
    const id = setInterval(refreshDrops, 15_000)
    return () => clearInterval(id)
  }, [refreshDrops])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? drops.filter((d) => d.name.toLowerCase().includes(q)) : drops
  }, [drops, query])

  const open = filtered.filter((d) => phaseOf(d) === 'open')
  const soon = filtered.filter((d) => phaseOf(d) === 'upcoming')
  const past = filtered.filter((d) => !['open', 'upcoming'].includes(phaseOf(d)))
  const featured = !query
    ? [...open].sort((a, b) => Date.parse(a.windowClosesAt) - Date.parse(b.windowClosesAt))[0]
    : undefined
  const openRest = featured ? open.filter((d) => d.id !== featured.id) : open

  const section = (title: string, list: typeof drops) =>
    list.length > 0 && (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => <EventCard key={d.id} drop={d} entry={entries[d.id]} />)}
        </div>
      </section>
    )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="type-display">Drops</h1>
        <p className="type-body mt-1">Limited seats, a fair draw, no queue to win.</p>
      </div>

      {drops.length > 3 && (
        <label className="relative block">
          <span className="sr-only">Search drops</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Search drops"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-surface pr-12 pl-11 text-base text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-3 focus:ring-primary-soft [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center text-muted">
              <X className="size-4" />
            </button>
          )}
        </label>
      )}

      {dropsFailed ? (
        <Card>
          <h2 className="type-title">Could not load drops</h2>
          <p className="type-body mt-1">Any entry you made is safe.</p>
          <Button size="lg" className="mt-5 w-full" onClick={retryDrops}>Try again</Button>
        </Card>
      ) : dropsLoading ? (
        <div aria-busy className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="surface h-64 rounded-card" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center">
          <h2 className="type-title">{query ? 'No drops found' : 'No drops yet'}</h2>
          <p className="type-body mt-1">{query ? 'Try another word.' : 'Check back soon.'}</p>
          {query && <Button variant="tinted" className="mt-4" onClick={() => setQuery('')}>Clear search</Button>}
        </Card>
      ) : (
        <>
          {featured && (
            <section aria-label="Closing soonest">
              <SectionTitle>Closing soonest</SectionTitle>
              <a href={href('drop', featured.id)} className="block rounded-card transition-opacity active:opacity-90">
                <DropHero drop={featured} level={2} />
              </a>
            </section>
          )}
          {section('Open now', openRest)}
          {section('Opening soon', soon)}
          {section('Closed', past)}
        </>
      )}

      <InstallCard compact />
    </div>
  )
}

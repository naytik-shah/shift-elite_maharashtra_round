import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import CategoryChips, { type CategoryFilter } from '@/components/CategoryChips'
import DropHero from '@/components/DropHero'
import EventCard from '@/components/EventCard'
import InstallCard from '@/components/InstallCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { href } from '@/lib/router'
import { useApp } from '@/state'

export default function Explore() {
  const { drops, dropsLoading, dropsFailed, retryDrops, refreshDrops, entries } = useApp()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('All')

  // Phases change while the page is open (a window opens, a window closes), so keep the list fresh.
  useEffect(() => {
    const id = setInterval(refreshDrops, 20_000)
    return () => clearInterval(id)
  }, [refreshDrops])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return drops.filter((d) =>
      (category === 'All' || d.category === category) &&
      (!q || [d.name, d.venue, d.city, d.category].some((f) => f?.toLowerCase().includes(q))))
  }, [drops, query, category])

  const open = filtered.filter((d) => d.state === 'OPEN')
  const soon = filtered.filter((d) => d.state === 'ANNOUNCED')
  const past = filtered.filter((d) => d.state !== 'OPEN' && d.state !== 'ANNOUNCED')
  const featured = !query && category === 'All'
    ? [...open].sort((a, b) => Date.parse(a.windowClosesAt) - Date.parse(b.windowClosesAt))[0]
    : undefined
  const openRest = featured ? open.filter((d) => d.id !== featured.id) : open

  const section = (title: string, list: typeof drops) =>
    list.length > 0 && (
      <section>
        <SectionTitle>{title}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((d) => <EventCard key={d.id} drop={d} entry={entries[d.id]} />)}
        </div>
      </section>
    )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="px-1 text-2xl font-bold tracking-tight">Find a drop</h1>
        <p className="mt-1 px-1 text-sm text-muted">Every event here is a fair draw. Enter once while it is open. Being fast gives no edge.</p>
      </div>

      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Search events</span>
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            placeholder="Search events, venues, cities"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[3.125rem] w-full rounded-full border border-line bg-surface pr-12 pl-12 text-base text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-3 focus:ring-primary-soft [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center text-muted">
              <X className="size-4" />
            </button>
          )}
        </label>
        <CategoryChips value={category} onChange={setCategory} />
      </div>

      {dropsFailed ? (
        <Card>
          <h2 className="text-xl font-bold tracking-tight">Could not load events</h2>
          <p className="mt-1 text-sm text-muted">The servers may be busy. Any entry you made is safe.</p>
          <Button size="lg" className="mt-5 w-full" onClick={retryDrops}>Try again</Button>
        </Card>
      ) : dropsLoading ? (
        <div aria-busy className="grid grid-cols-1 animate-pulse gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-30 rounded-card bg-surface" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center">
          <h2 className="text-xl font-bold tracking-tight">No events found</h2>
          <p className="mt-1 text-sm text-muted">Nothing matches that search. Try another word or category.</p>
          <Button variant="tinted" className="mt-4" onClick={() => { setQuery(''); setCategory('All') }}>Clear filters</Button>
        </Card>
      ) : (
        <>
          {featured && (
            <section aria-label="Closing soonest">
              <SectionTitle>Closing soonest</SectionTitle>
              <a href={href('event', featured.id)} className="block rounded-card transition-opacity active:opacity-90">
                <DropHero drop={featured} level={2} />
              </a>
            </section>
          )}
          {section('Open for entries', openRest)}
          {section('Opening soon', soon)}
          {section('Ended', past)}
        </>
      )}

      <InstallCard compact />
    </div>
  )
}

import { ChevronLeft } from 'lucide-react'
import DropHero from '@/components/DropHero'
import FairnessCard from '@/components/FairnessCard'
import Lifecycle from '@/components/Lifecycle'
import StatusPanel from '@/components/StatusPanel'
import { Button } from '@/components/ui/button'
import { Card, Rows, SectionTitle } from '@/components/ui/card'
import { useLive } from '@/hooks/useLive'
import { formatAmount, formatDateTime, formatNumber } from '@/lib/format'
import { venueLine } from '@/lib/eventStatus'
import { go, href } from '@/lib/router'
import { useApp } from '@/state'

const Back = () => (
  <a href={href('explore')} className="-ml-1 inline-flex h-11 items-center gap-0.5 text-sm font-semibold text-primary-text">
    <ChevronLeft className="size-5" aria-hidden /> Explore
  </a>
)

export default function Event({ id }: { id: string }) {
  const { drops, dropsLoading, draws } = useApp()
  const drop = drops.find((d) => d.id === id)
  useLive(drop?.id)

  if (!drop) {
    return (
      <div className="space-y-2">
        <Back />
        {dropsLoading ? (
          <div className="grid grid-cols-1 animate-pulse gap-4 lg:grid-cols-2 lg:gap-6">
            <div className="h-44 rounded-card bg-surface" />
            <div className="h-44 rounded-card bg-surface" />
          </div>
        ) : (
          <Card>
            <h1 className="text-xl font-bold tracking-tight">We could not find that event</h1>
            <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
            <Button size="lg" className="mt-5 w-full" onClick={() => go('explore')}>Browse events</Button>
          </Card>
        )}
      </div>
    )
  }

  const details: [string, string][] = [
    ['Event', formatDateTime(drop.eventAt ?? drop.windowClosesAt)],
    ...(venueLine(drop) ? [['Venue', venueLine(drop)] as [string, string]] : []),
    ['Seats', formatNumber(drop.seats)],
    ['Refundable hold', formatAmount(drop.holdAmount, drop.currency)],
  ]

  return (
    <div className="space-y-2">
      <Back />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="space-y-4 lg:sticky lg:top-6 lg:space-y-6">
          <DropHero drop={drop} />
          <StatusPanel drop={drop} />
        </div>
        <div className="mt-3 space-y-7 lg:mt-0">
          <section>
            <SectionTitle>About this event</SectionTitle>
            {drop.description && <Card><p className="text-base">{drop.description}</p></Card>}
            <Rows className="mt-3">
              {details.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-3.5 text-sm">
                  <dt className="shrink-0 text-muted">{k}</dt>
                  <dd className="text-right font-semibold">{v}</dd>
                </div>
              ))}
            </Rows>
          </section>
          <Lifecycle drop={drop} />
          <FairnessCard drop={drop} draw={draws[drop.id]} />
        </div>
      </div>
    </div>
  )
}

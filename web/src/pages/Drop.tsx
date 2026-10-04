import { ChevronLeft } from 'lucide-react'
import DropHero from '@/components/DropHero'
import FairnessCard from '@/components/FairnessCard'
import ProtectionsCard from '@/components/ProtectionsCard'
import StatusPanel from '@/components/StatusPanel'
import Steps from '@/components/Steps'
import { Button } from '@/components/ui/button'
import { Card, Rows, SectionTitle } from '@/components/ui/card'
import { useLive } from '@/hooks/useLive'
import { formatDateTime, formatNumber, formatPrice } from '@/lib/format'
import { go, href } from '@/lib/router'
import { useApp } from '@/state'

const Back = () => (
  <a href={href('drops')} className="type-strong -ml-1 inline-flex h-11 items-center gap-0.5 text-primary-text">
    <ChevronLeft className="size-5" aria-hidden /> Drops
  </a>
)

export default function Drop({ id }: { id: string }) {
  const { drops, dropsLoading, draws } = useApp()
  const drop = drops.find((d) => d.id === id)
  useLive(id)

  if (!drop) {
    return (
      <div className="space-y-2">
        <Back />
        {dropsLoading ? (
          <div className="grid animate-pulse grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
            <div className="surface h-44 rounded-card" />
            <div className="surface h-44 rounded-card" />
          </div>
        ) : (
          <Card>
            <h1 className="type-title">Drop not found</h1>
            <p className="type-body mt-1">The link may be wrong.</p>
            <Button size="lg" className="mt-5 w-full" onClick={() => go('drops')}>Browse drops</Button>
          </Card>
        )}
      </div>
    )
  }

  const details: [string, string][] = [
    ['Seats', formatNumber(drop.seats)],
    ['Ticket price', drop.ticketPrice != null ? formatPrice(drop.ticketPrice) : ''],
    ['Entries open', formatDateTime(drop.windowOpensAt)],
    ['Entries close', formatDateTime(drop.windowClosesAt)],
    ['Draw', formatDateTime(drop.drawAt)],
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
            <SectionTitle>Details</SectionTitle>
            <Rows>
              {details.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-3.5">
                  <dt className="type-body shrink-0">{k}</dt>
                  <dd className="type-strong text-right">{v}</dd>
                </div>
              ))}
            </Rows>
          </section>
          <Steps drop={drop} />
          <FairnessCard drop={drop} draw={draws[drop.id]} />
          <ProtectionsCard />
        </div>
      </div>
    </div>
  )
}

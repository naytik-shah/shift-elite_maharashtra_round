import TicketCard from '@/components/TicketCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { go } from '@/lib/router'
import { useApp } from '@/state'

export default function Tickets() {
  const { tickets, drops, user, entries, openFlow } = useApp()
  const waiting = Object.values(entries).some((e) => e?.state === 'WON')

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="type-display px-1">Tickets</h1>
      {tickets.length > 0 && user ? (
        tickets.map((t) => <TicketCard key={t.id} ticket={t} drop={drops.find((d) => d.id === t.dropId)} />)
      ) : (
        <Card>
          <h2 className="type-title">No tickets yet</h2>
          <p className="type-body mt-1">
            {!user ? 'Log in to see your tickets.' : waiting ? 'You have a seat waiting.' : 'Confirmed seats show up here.'}
          </p>
          <Button size="lg" variant={waiting || !user ? 'primary' : 'tinted'} className="mt-5 w-full" onClick={() => (user ? go(waiting ? 'status' : 'drops') : openFlow('login'))}>
            {!user ? 'Log in' : waiting ? 'Confirm my seat' : 'Browse drops'}
          </Button>
        </Card>
      )}
    </div>
  )
}

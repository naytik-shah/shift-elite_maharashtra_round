import TicketCard from '@/components/TicketCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { go } from '@/lib/router'
import { useApp } from '@/state'

export default function Tickets() {
  const { tickets, drops, user, entries, openFlow } = useApp()
  const waiting = Object.values(entries).some((e) => e?.state === 'WON')
  const list = tickets.flatMap((t) => {
    const drop = drops.find((d) => d.id === t.dropId)
    return drop ? [{ t, drop }] : []
  })

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="px-1 text-2xl font-bold tracking-tight">Your tickets</h1>
      {list.length > 0 && user ? (
        list.map(({ t, drop }) => <TicketCard key={t.id} ticket={t} drop={drop} holder={user.email} />)
      ) : (
        <Card>
          <h2 className="text-xl font-bold tracking-tight">No tickets yet</h2>
          <p className="mt-1 text-sm text-muted">
            {!user
              ? 'Sign in to see tickets you have confirmed.'
              : waiting
                ? 'You have a seat waiting. Confirm it to get your ticket.'
                : 'When you are selected and confirm your seat, your named ticket shows up here.'}
          </p>
          <Button size="lg" variant={waiting ? 'primary' : 'tinted'} className="mt-5 w-full" onClick={() => (user ? go(waiting ? 'entries' : 'explore') : openFlow('signin'))}>
            {!user ? 'Sign in' : waiting ? 'Confirm my seat' : 'Explore events'}
          </Button>
        </Card>
      )}
    </div>
  )
}

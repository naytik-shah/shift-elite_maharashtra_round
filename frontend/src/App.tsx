import { lazy, Suspense } from 'react'
import AppShell from '@/components/AppShell'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { go, useRoute } from '@/lib/router'
import { useApp } from '@/state'
import Explore from './pages/Explore'

// Explore is in the first chunk. Everything else loads when it is needed,
// so the first paint under load is as small as it can be.
const Event = lazy(() => import('./pages/Event'))
const Entries = lazy(() => import('./pages/Entries'))
const Tickets = lazy(() => import('./pages/Tickets'))
const Account = lazy(() => import('./pages/Account'))
const Register = lazy(() => import('./pages/Register'))
const EnterSheet = lazy(() => import('./components/EnterSheet'))

const sheetFallback = <div className="h-48 animate-pulse rounded-2xl bg-surface" />

export default function App() {
  const route = useRoute()
  const { drops, flow, openFlow, closeFlow, setUser } = useApp()
  const flowDrop = drops.find((d) => d.id === flow?.dropId)

  return (
    <AppShell route={route}>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface" />}>
        {route.name === 'explore' && <Explore />}
        {route.name === 'event' && route.id && <Event id={route.id} />}
        {route.name === 'entries' && <Entries />}
        {route.name === 'tickets' && <Tickets />}
        {route.name === 'account' && <Account />}
      </Suspense>

      <Dialog open={flow?.kind === 'signin'} onOpenChange={(o) => !o && closeFlow()}>
        <DialogContent title="Sign in" description="No password. We email you a code.">
          <Suspense fallback={sheetFallback}>
            <Register
              onDone={(u) => {
                setUser(u)
                // Carry straight on into the entry step when the drop is still open.
                if (flowDrop?.state === 'OPEN') openFlow('enter', flowDrop.id)
                else closeFlow()
              }}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      <Dialog open={flow?.kind === 'enter' && !!flowDrop} onOpenChange={(o) => !o && closeFlow()}>
        <DialogContent title="Enter the draw" description="One entry per person, backed by a refundable hold.">
          <Suspense fallback={sheetFallback}>
            {flowDrop && <EnterSheet drop={flowDrop} onDone={() => { closeFlow(); go('event', flowDrop.id) }} />}
          </Suspense>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

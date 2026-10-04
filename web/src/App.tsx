import { lazy, Suspense, useEffect } from 'react'
import AppShell from '@/components/AppShell'
import ProtectionHost from '@/components/ProtectionHost'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useRoute, type RouteName } from '@/lib/router'
import { useApp } from '@/state'
import Explore from './pages/Explore'

// The drop list is in the first chunk. Everything else loads when it is needed,
// so the first paint under load is as small as it can be.
const Drop = lazy(() => import('./pages/Drop'))
const Status = lazy(() => import('./pages/Status'))
const Verify = lazy(() => import('./pages/Verify'))
const Tickets = lazy(() => import('./pages/Tickets'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Account = lazy(() => import('./pages/Account'))
const Register = lazy(() => import('./pages/Register'))
const ConfirmSheet = lazy(() => import('./components/ConfirmSheet'))

const titles: Record<RouteName, string> = {
  drops: 'Drops', drop: 'Drop', status: 'My status', verify: 'Verify the draw',
  tickets: 'Tickets', dashboard: 'Dashboard', account: 'Account',
}

const sheetFallback = <div className="h-48 animate-pulse rounded-2xl bg-fill" />

export default function App() {
  const route = useRoute()
  const { drops, flow, closeFlow, setUser } = useApp()
  const flowDrop = drops.find((d) => d.id === flow?.dropId)
  const dropName = route.name === 'drop' ? drops.find((d) => d.id === route.id)?.name : undefined

  useEffect(() => {
    document.title = `${dropName ?? titles[route.name]} | Fair Drop`
  }, [route.name, dropName])

  return (
    <AppShell route={route}>
      <Suspense fallback={<div className="surface h-64 animate-pulse rounded-card" />}>
        {route.name === 'drops' && <Explore />}
        {route.name === 'drop' && route.id && <Drop id={route.id} />}
        {route.name === 'status' && <Status />}
        {route.name === 'verify' && <Verify id={route.id} />}
        {route.name === 'tickets' && <Tickets />}
        {route.name === 'dashboard' && <Dashboard id={route.id} />}
        {route.name === 'account' && <Account />}
      </Suspense>

      <Dialog open={flow?.kind === 'login'} onOpenChange={(o) => !o && closeFlow()}>
        <DialogContent title="Log in" description="No password needed.">
          <Suspense fallback={sheetFallback}>
            <Register onDone={(u) => { setUser(u); closeFlow() }} />
          </Suspense>
        </DialogContent>
      </Dialog>

      <Dialog open={flow?.kind === 'confirm' && !!flowDrop} onOpenChange={(o) => !o && closeFlow()}>
        <DialogContent title="Confirm your seat" description={flowDrop?.name}>
          <Suspense fallback={sheetFallback}>
            {flowDrop && <ConfirmSheet drop={flowDrop} onDone={closeFlow} />}
          </Suspense>
        </DialogContent>
      </Dialog>

      <ProtectionHost />
    </AppShell>
  )
}

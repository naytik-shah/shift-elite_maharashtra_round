import { Compass, LayoutDashboard, ListChecks, Moon, ShieldCheck, Sun, Ticket } from 'lucide-react'
import type { ReactNode } from 'react'
import { greeting } from '@/lib/format'
import { href, type Route, type RouteName } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'
import ConnectionBanner from './ConnectionBanner'
import { Button } from './ui/button'

interface Item { route: RouteName; label: string; icon: typeof Compass }

const base: Item[] = [
  { route: 'drops', label: 'Drops', icon: Compass },
  { route: 'status', label: 'Status', icon: ListChecks },
  { route: 'verify', label: 'Verify', icon: ShieldCheck },
  { route: 'tickets', label: 'Tickets', icon: Ticket },
]
const organiser: Item = { route: 'dashboard', label: 'Admin', icon: LayoutDashboard }

function Logo() {
  return (
    <a href={href('drops')} className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" width={36} height={36} className="size-9 rounded-[0.625rem]" />
      <span className="type-headline">Fair Drop</span>
    </a>
  )
}

function ThemeButton() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="surface grid size-11 place-items-center rounded-full text-ink transition-opacity active:opacity-70"
    >
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}

export default function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const { user, loading, entries, openFlow, signOut } = useApp()
  const items = user?.role === 'organiser' ? [...base, organiser] : base
  // A dot on the nav tells the user a seat is waiting for them on another tab.
  const attention: Partial<Record<RouteName, boolean>> = {
    status: Object.values(entries).some((e) => e?.state === 'WON'),
  }
  // A drop page belongs under Drops.
  const active: RouteName = route.name === 'drop' ? 'drops' : route.name
  const name = user?.email.split('@')[0]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-12">
      <header className="mb-4 flex items-center justify-between gap-3 lg:mb-8 lg:pt-3">
        <div className="min-w-0 lg:hidden">
          {user ? (
            <a href={href('account')} className="flex items-center gap-3">
              <span className="type-headline grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg uppercase">{name?.[0]}</span>
              <span className="min-w-0">
                <span className="type-caption block">{greeting()}</span>
                <span className="type-headline block truncate leading-tight">{name}</span>
              </span>
            </a>
          ) : (
            <Logo />
          )}
        </div>
        <div className="hidden lg:block"><Logo /></div>

        <nav aria-label="Main" className="hidden gap-1 lg:flex">
          {items.map(({ route: r, label }) => (
            <a
              key={r}
              href={href(r)}
              aria-current={active === r ? 'page' : undefined}
              className={cn(
                'type-strong flex h-9 items-center gap-1.5 rounded-full border border-transparent px-4 text-muted transition-colors hover:text-ink',
                active === r && 'surface text-ink',
              )}
            >
              {r === 'dashboard' ? 'Dashboard' : r === 'status' ? 'My status' : label}
              {attention[r] && active !== r && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeButton />
          {user ? (
            <>
              <Button variant="gray" className="hidden lg:inline-flex" onClick={signOut}>Log out</Button>
              <a href={href('account')} aria-label="Account" className="type-headline hidden size-11 place-items-center rounded-full bg-ink text-bg uppercase lg:grid">
                {name?.[0]}
              </a>
            </>
          ) : !loading && (
            <Button onClick={() => openFlow('login')}>Log in</Button>
          )}
        </div>
      </header>

      <ConnectionBanner />
      <main className="flex-1">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit items-center gap-0.5 rounded-full bg-nav p-1.5 shadow-lg shadow-black/15 lg:hidden"
      >
        {items.map(({ route: r, label, icon: Icon }) => (
          <a
            key={r}
            href={href(r)}
            aria-current={active === r ? 'page' : undefined}
            className={cn(
              'relative flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-full text-nav-fg transition-colors duration-200',
              active === r && 'bg-primary text-white',
            )}
          >
            <Icon className="size-5" strokeWidth={2} aria-hidden />
            <span className="text-[0.6875rem] leading-none font-semibold">{label}</span>
            {attention[r] && active !== r && <span className="absolute top-2 right-3.5 size-2 rounded-full bg-primary ring-2 ring-nav" aria-hidden />}
          </a>
        ))}
      </nav>
    </div>
  )
}

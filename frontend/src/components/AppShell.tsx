import { Compass, ListChecks, Moon, Sun, Ticket, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { greeting } from '@/lib/format'
import { href, type Route, type RouteName } from '@/lib/router'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'
import ConnectionBanner from './ConnectionBanner'

const items: { route: RouteName; label: string; icon: typeof Compass }[] = [
  { route: 'explore', label: 'Explore', icon: Compass },
  { route: 'entries', label: 'Entries', icon: ListChecks },
  { route: 'tickets', label: 'Tickets', icon: Ticket },
  { route: 'account', label: 'Account', icon: User },
]

function Logo() {
  return (
    <a href={href('explore')} className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" width={36} height={36} className="size-9 rounded-[0.625rem]" />
      <span className="text-lg font-bold tracking-tight">Fair Drop</span>
    </a>
  )
}

function ThemeButton() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-11 place-items-center rounded-full bg-surface text-ink transition-opacity active:opacity-70"
    >
      {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}

function Avatar({ letter, className }: { letter?: string; className?: string }) {
  return (
    <span className={cn('grid size-11 place-items-center rounded-full bg-ink text-base font-semibold text-bg uppercase', className)}>
      {letter}
    </span>
  )
}

export default function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const { user, entries } = useApp()
  // A dot on the nav tells the user something is waiting for them on another tab.
  const attention: Partial<Record<RouteName, boolean>> = {
    entries: Object.values(entries).some((e) => e?.state === 'WON'),
  }
  // An event page belongs under Explore.
  const active: RouteName = route.name === 'event' ? 'explore' : route.name
  const name = user?.email.split('@')[0]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-12">
      <header className="mb-4 flex items-center justify-between gap-4 lg:mb-8 lg:pt-3">
        <div className="lg:hidden">
          {user ? (
            <a href={href('account')} className="flex items-center gap-3">
              <Avatar letter={name?.[0]} />
              <span>
                <span className="block text-xs text-muted">{greeting()}</span>
                <span className="block max-w-[11rem] truncate text-base leading-tight font-semibold">{name}</span>
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
                'flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-muted transition-colors hover:text-ink',
                active === r && 'bg-surface text-ink',
              )}
            >
              {label}
              {attention[r] && active !== r && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeButton />
          {user && (
            <a href={href('account')} aria-label="Account" className="hidden lg:block">
              <Avatar letter={name?.[0]} />
            </a>
          )}
        </div>
      </header>

      <ConnectionBanner />
      <main className="flex-1">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit items-center gap-1 rounded-full bg-nav p-1.5 shadow-lg shadow-black/15 lg:hidden"
      >
        {items.map(({ route: r, label, icon: Icon }) => (
          <a
            key={r}
            href={href(r)}
            aria-current={active === r ? 'page' : undefined}
            className={cn(
              'relative flex h-14 w-[4.25rem] flex-col items-center justify-center gap-1 rounded-full text-nav-fg transition-colors duration-200',
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

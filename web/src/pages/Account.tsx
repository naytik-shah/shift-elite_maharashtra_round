import { LayoutDashboard, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage, usingMock } from '@/api'
import { MOCK_ORGANISER, resetMock, skipToDraw } from '@/api/mock'
import InstallCard from '@/components/InstallCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { go } from '@/lib/router'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-fill p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'type-strong flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-muted transition-colors',
            value === o.value && 'bg-surface text-ink shadow-sm dark:bg-line',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function DemoControls() {
  // The mock keeps its state in localStorage, a reload is the simplest way to pick it all up again.
  const restart = () => { resetMock(); location.hash = '#/'; location.reload() }
  return (
    <section>
      <SectionTitle>Demo controls</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="gray" onClick={restart}>Restart demo</Button>
          <Button variant="gray" onClick={() => { skipToDraw(); location.hash = '#/drop/launch-night' }}>Skip to draw</Button>
        </div>
      </Card>
      <p className="type-caption mt-2 px-1">
        Mock backend only. Skip to draw applies to Launch Night. Log in as {MOCK_ORGANISER} to open the dashboard.
      </p>
    </section>
  )
}

// A shortcut to the organiser dashboard. For a demo build the dummy organiser can be signed in with one tap,
// because the account and its code are dummy values that only exist for the demo.
const DEMO = import.meta.env.VITE_DEMO_LOGIN === 'true'
const DEMO_EMAIL = import.meta.env.VITE_DEMO_ORGANISER_EMAIL || 'organiser@fairdrop.test'
const DEMO_CODE = import.meta.env.VITE_DEMO_CODE || ''

function OrganiserPanel() {
  const { user, setUser, openFlow } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isOrganiser = user?.role === 'organiser'

  const demoLogin = async () => {
    setBusy(true)
    setError('')
    try {
      setUser(await api.verifyOtp(DEMO_EMAIL, DEMO_CODE))
      go('dashboard')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionTitle>Organiser panel</SectionTitle>
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fill"><LayoutDashboard className="size-5" /></span>
          <div className="min-w-0">
            <p className="type-strong">Live counts, scoring, the draw and proof of every protection</p>
            <p className="type-body">Open it in a second window to show the organiser view next to the participant view.</p>
          </div>
        </div>
        {isOrganiser ? (
          <Button size="lg" className="mt-4 w-full" onClick={() => go('dashboard')}>Open organiser dashboard</Button>
        ) : DEMO && DEMO_CODE ? (
          <>
            <dl className="mt-4 space-y-1 rounded-lg bg-fill px-4 py-3">
              <div className="flex justify-between gap-3"><dt className="type-caption">Demo organiser</dt><dd className="type-strong break-all text-right">{DEMO_EMAIL}</dd></div>
              <div className="flex justify-between gap-3"><dt className="type-caption">Demo code</dt><dd className="type-strong font-mono tracking-widest">{DEMO_CODE}</dd></div>
            </dl>
            <Button size="lg" className="mt-3 w-full" busy={busy} onClick={demoLogin}>Sign in as demo organiser</Button>
            {error && <p role="alert" className="type-strong mt-3 rounded-lg bg-danger-soft px-4 py-3 text-danger">{error}</p>}
          </>
        ) : (
          <Button size="lg" variant="gray" className="mt-4 w-full" onClick={() => openFlow('login')}>Log in as organiser</Button>
        )}
      </Card>
    </section>
  )
}

export default function Account() {
  const { user, signOut, openFlow, entries } = useApp()
  const { theme, setTheme } = useTheme()
  const count = Object.values(entries).filter(Boolean).length

  return (
    <div className="mx-auto max-w-md space-y-7">
      <div>
        <h1 className="type-display mb-3 px-1">Account</h1>
        <Card>
          {user ? (
            <div className="flex items-center gap-4">
              <span className="type-title grid size-14 shrink-0 place-items-center rounded-full bg-ink text-bg uppercase">
                {user.email[0]}
              </span>
              <div className="min-w-0">
                <p className="type-headline truncate">{user.email}</p>
                <p className="type-body">
                  {user.role === 'organiser' ? 'Organiser' : count > 0 ? `Entered in ${count} ${count === 1 ? 'drop' : 'drops'}` : 'No entries yet'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="type-title">Not logged in</p>
              <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('login')}>Log in</Button>
            </>
          )}
        </Card>
      </div>

      <OrganiserPanel />

      <section>
        <SectionTitle>Appearance</SectionTitle>
        <Card>
          <Segmented<Theme>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: <><Sun className="size-4" /> Light</> },
              { value: 'dark', label: <><Moon className="size-4" /> Dark</> },
            ]}
          />
        </Card>
      </section>

      <section>
        <SectionTitle>App</SectionTitle>
        <Card><InstallCard /></Card>
      </section>

      {usingMock && <DemoControls />}

      {user && <Button variant="danger" size="lg" className="w-full" onClick={signOut}>Log out</Button>}
    </div>
  )
}

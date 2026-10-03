import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { usingMock } from '@/api'
import { mockOutcome, resetMock, skipToDraw, type MockOutcome } from '@/api/mock'
import InstallCard from '@/components/InstallCard'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useApp } from '@/state'

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-fill p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted transition-colors',
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
  const [outcome, setOutcome] = useState<MockOutcome | 'random'>(mockOutcome() ?? 'random')
  // The mock keeps its state in localStorage, a reload is the simplest way to pick it all up again.
  const restart = (o: MockOutcome | 'random') => {
    resetMock(o === 'random' ? null : o)
    location.hash = '#/'
    location.reload()
  }
  return (
    <section>
      <SectionTitle>Demo controls</SectionTitle>
      <Card>
        <p className="mb-2 text-sm font-semibold">Draw outcome</p>
        <Segmented
          label="Draw outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'random', label: 'Random' },
            { value: 'won', label: 'Win' },
            { value: 'waitlist', label: 'Waitlist' },
            { value: 'lost', label: 'Lose' },
          ]}
        />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="gray" onClick={() => restart(outcome)}>Restart drop</Button>
          <Button variant="gray" onClick={() => { skipToDraw(); location.hash = '#/entries' }}>Skip to draw</Button>
        </div>
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">Only shown on the local mock backend. The outcome and skip apply to the live demo event, Shift Elite Finals Night.</p>
    </section>
  )
}

export default function Account() {
  const { user, signOut, openFlow, entries } = useApp()
  const count = Object.values(entries).filter(Boolean).length
  const { theme, setTheme } = useTheme()

  return (
    <div className="mx-auto max-w-md space-y-7">
      <div>
        <h1 className="mb-3 px-1 text-2xl font-bold tracking-tight">Account</h1>
        <Card>
          {user ? (
            <div className="flex items-center gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-ink text-xl font-semibold text-bg uppercase">
                {user.email[0]}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{user.email}</p>
                <p className="text-sm text-muted">{count > 0 ? `Entered in ${count} ${count === 1 ? 'drop' : 'drops'}` : 'No entries yet'}</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-base font-semibold">You are not signed in</p>
              <p className="mt-1 text-sm text-muted">Sign in with your email to enter the drop and follow your status.</p>
              <Button size="lg" className="mt-5 w-full" onClick={() => openFlow('signin')}>Sign in</Button>
            </>
          )}
        </Card>
      </div>

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

      {user && <Button variant="danger" size="lg" className="w-full" onClick={signOut}>Sign out</Button>}
    </div>
  )
}

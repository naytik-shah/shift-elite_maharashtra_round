import { Moon, Sun } from 'lucide-react'
import { usingMock } from '@/api'
import { MOCK_ORGANISER, resetMock, skipToDraw } from '@/api/mock'
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
            'type-strong flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-muted transition-colors',
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

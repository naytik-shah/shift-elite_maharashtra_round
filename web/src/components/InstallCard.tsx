import { X } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { Button } from './ui/button'
import { Card } from './ui/card'

// compact is the dismissible banner on the home page, the full one lives on the account page.
export default function InstallCard({ compact }: { compact?: boolean }) {
  const { mode, install, dismiss, dismissed, installed } = useInstallPrompt()

  if (!mode) {
    return compact ? null : (
      <p className="type-body">
        {installed ? 'Installed on this device.' : 'Use the browser menu, then Add to Home Screen.'}
      </p>
    )
  }

  const body = (
    <div className="flex items-center gap-3">
      <img src="/icon.svg" alt="" width={44} height={44} className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="type-strong">Install Fair Drop</p>
        <p className="type-caption">{mode === 'ios' ? 'Tap Share, then Add to Home Screen' : 'Your status, one tap away'}</p>
      </div>
      {mode === 'native' && <Button size="sm" variant="tinted" onClick={install}>Install</Button>}
      {compact && (
        <button onClick={dismiss} aria-label="Dismiss" className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted">
          <X className="size-4" />
        </button>
      )}
    </div>
  )

  if (!compact) return body
  return dismissed ? null : <Card className="py-3.5 sm:py-3.5">{body}</Card>
}

import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '@/state'

const copy = {
  reconnecting: 'Reconnecting. Your place is safe.',
  polling: 'Updates are slow. Still checking.',
  offline: 'You are offline. Your place is safe.',
} as const

export default function ConnectionBanner() {
  const { conn } = useApp()
  const [show, setShow] = useState(false)

  // A short blip is normal on mobile networks, so only speak up if it lasts.
  useEffect(() => {
    if (conn === 'live') { setShow(false); return }
    const id = setTimeout(() => setShow(true), conn === 'offline' ? 0 : 2500)
    return () => clearTimeout(id)
  }, [conn])

  if (!show || conn === 'live') return null
  return (
    <p role="status" className="mb-4 flex animate-rise items-center gap-2.5 type-strong rounded-2xl bg-warn-soft px-4 py-3 text-warn">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      {copy[conn]}
    </p>
  )
}

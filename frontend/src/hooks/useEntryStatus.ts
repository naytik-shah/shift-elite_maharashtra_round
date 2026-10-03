import { useEffect, useState } from 'react'
import { api, type EntryStatus, type EventInfo, type Session } from '../api'

// Polls with jitter so a reconnect storm does not hit the server in lockstep.
// Swap for SSE later, the return shape stays the same.
export function useEntryStatus(session: Session | null) {
  const [status, setStatus] = useState<EntryStatus | null>(null)
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!session) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const [s, e] = await Promise.all([api.getStatus(session), api.getEvent()])
        if (stop) return
        setStatus(s)
        setEvent(e)
        setOffline(false)
      } catch {
        if (!stop) setOffline(true)
      }
      if (!stop) timer = setTimeout(tick, 1000 + Math.random() * 500)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [session])

  return { status, event, offline, setStatus }
}

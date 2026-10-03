import { useCallback, useState } from 'react'
import type { Session } from '../api'

const KEY = 'fd.session'

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(read)

  const set = useCallback((s: Session | null) => {
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s))
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
    setSession(s)
  }, [])

  return { session, setSession: set }
}

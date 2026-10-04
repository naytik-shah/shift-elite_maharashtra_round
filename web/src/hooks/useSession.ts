import { useCallback, useEffect, useState } from 'react'
import { api, type User } from '@/api'

// The session itself is an http only cookie. This just asks the server who we are.
export function useSession() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api.me()
      .then((u) => { if (alive) setUser(u) })
      .catch(() => { /* treated as signed out, the status view shows connection problems */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const signOut = useCallback(async () => {
    try { await api.logout() } finally { setUser(null) }
  }, [])

  return { user, setUser, loading, signOut }
}

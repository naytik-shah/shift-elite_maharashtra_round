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

  // Another window on the same address shares this cookie, so the account can change under us.
  // Ask again whenever this window comes back into view.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      api.me()
        .then((u) => setUser((cur) => (cur?.id === u?.id && cur?.role === u?.role ? cur : u)))
        .catch(() => { /* a network blip is not a sign out */ })
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [])

  const signOut = useCallback(async () => {
    try { await api.logout() } finally { setUser(null) }
  }, [])

  return { user, setUser, loading, signOut }
}

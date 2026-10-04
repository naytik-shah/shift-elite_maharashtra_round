import { useCallback, useEffect, useState } from 'react'
import { api, type User } from '@/api'

// The session itself is an http only cookie. This just asks the server who we are.
export function useSession() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // A 401 means signed out. A busy server (429, 503) or a dropped connection says nothing about
    // the login, so ask again a few times instead of showing a signed in person the login button.
    const ask = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const u = await api.me()
          if (alive) setUser(u)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
          if (!alive) return
        }
      }
    }
    ask().finally(() => { if (alive) setLoading(false) })
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

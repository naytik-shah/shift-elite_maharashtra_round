import { useEffect } from 'react'
import { api, type LiveEvent } from '@/api'
import { useApp } from '@/state'

// Keeps one drop page fresh. Loads the drop, the draw and this user's entry on mount,
// so a refresh always shows the right state, then follows the live stream.
export function useLive(dropId?: string) {
  const { user, patchDrop, setEntry, setDraw, setConn } = useApp()
  const userId = user?.id

  useEffect(() => {
    if (!dropId) return
    let alive = true
    const loadDraw = () => api.getDraw(dropId).then((x) => alive && setDraw(dropId, x)).catch(() => {})
    const loadEntry = () => { if (userId) api.getMyEntry(dropId).then((e) => alive && setEntry(dropId, e)).catch(() => {}) }

    api.getDrop(dropId).then((d) => alive && patchDrop(dropId, d)).catch(() => {})
    loadDraw()
    loadEntry()

    let lastState = ''
    const onEvent = (e: LiveEvent) => {
      if (!alive) return
      if (e.type === 'drop_state') {
        patchDrop(dropId, { state: e.state })
        // The draw reveals the seed and gives everyone a result.
        if (lastState && lastState !== e.state) { loadDraw(); loadEntry() }
        lastState = e.state
      } else {
        setEntry(dropId, (cur) => ({
          entryId: e.entryId ?? cur?.entryId ?? '',
          state: e.state,
          rank: e.rank ?? cur?.rank ?? null,
          waitlistPosition: e.waitlistPosition ?? null,
          confirmBy: e.confirmBy ?? null,
        }))
      }
    }
    // The stream is tied to the session cookie, so it is reopened when the user changes.
    const stop = api.subscribe(dropId, !!userId, onEvent, (c) => alive && setConn(c))
    return () => { alive = false; stop(); setConn('live') }
  }, [dropId, userId, patchDrop, setEntry, setDraw, setConn])
}

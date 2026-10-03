import { useEffect } from 'react'
import { api, type LiveEvent } from '@/api'
import { useApp } from '@/state'

// Keeps one event page fresh over the live stream. Only the open event page holds a stream,
// browsers allow a handful of connections per host and the server pays for every one.
export function useLive(dropId?: string) {
  const { user, patchDrop, setEntry, setDraw, setConn } = useApp()
  const userId = user?.id

  useEffect(() => {
    if (!dropId) return
    let alive = true
    api.getDraw(dropId).then((x) => alive && setDraw(dropId, x)).catch(() => {})
    if (userId) api.getMyEntry(dropId).then((e) => alive && setEntry(dropId, e)).catch(() => {})

    const onEvent = (e: LiveEvent) => {
      if (!alive) return
      switch (e.type) {
        case 'drop_state':
          patchDrop(dropId, { state: e.state })
          break
        case 'manifest_published':
          setDraw(dropId, (d) => (d ? { ...d, manifestHash: e.manifestHash } : d))
          break
        case 'draw_complete':
          api.getDraw(dropId).then((x) => alive && setDraw(dropId, x)).catch(() => {})
          break
        case 'your_status':
          setEntry(dropId, (cur) => ({
            entryId: cur?.entryId ?? '',
            rank: e.rank ?? cur?.rank ?? null,
            waitlistPosition: e.waitlistPosition ?? null,
            confirmBy: e.confirmBy ?? null,
            state: e.state,
          }))
          break
        case 'waitlist_moved':
          setEntry(dropId, (cur) => (cur ? { ...cur, waitlistPosition: e.waitlistPosition } : cur))
          break
      }
    }
    // The stream is tied to the session cookie, so it is reopened when the user changes.
    const stop = api.subscribe(dropId, onEvent, (c) => alive && setConn(c))
    return () => { alive = false; stop(); setConn('live') }
  }, [dropId, userId, patchDrop, setEntry, setDraw, setConn])
}

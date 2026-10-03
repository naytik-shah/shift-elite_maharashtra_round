import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type ConnState, type DrawInfo, type Drop, type Entry, type Ticket } from '@/api'
import { useSession } from '@/hooks/useSession'

type Flow = { kind: 'signin' | 'enter'; dropId?: string } | null
type Setter<T> = T | ((cur: T) => T)

type AppState = ReturnType<typeof useSession> & {
  drops: Drop[]
  dropsLoading: boolean
  dropsFailed: boolean
  retryDrops: () => void
  refreshDrops: () => Promise<void>
  patchDrop: (id: string, patch: Partial<Drop>) => void
  // Entry per drop. undefined means not loaded yet, null means no entry.
  entries: Record<string, Entry | null | undefined>
  setEntry: (id: string, v: Setter<Entry | null>) => void
  refreshEntries: () => Promise<void>
  tickets: Ticket[]
  setTicket: (t: Ticket) => void
  draws: Record<string, DrawInfo | undefined>
  setDraw: (id: string, v: Setter<DrawInfo | undefined>) => void
  conn: ConnState
  setConn: (c: ConnState) => void
  flow: Flow
  openFlow: (kind: 'signin' | 'enter', dropId?: string) => void
  closeFlow: () => void
}

const Ctx = createContext<AppState | null>(null)

const tokenKey = (dropId: string) => `fd.pm.${dropId}`

// Kept so the confirm step can reuse the payment method used to enter, without asking again.
export function getPaymentToken(dropId: string): string | null {
  try { return localStorage.getItem(tokenKey(dropId)) } catch { return null }
}
export function rememberPaymentToken(dropId: string, token: string) {
  try { localStorage.setItem(tokenKey(dropId), token) } catch { /* ignore */ }
}

const apply = <T,>(v: Setter<T>, cur: T): T => (typeof v === 'function' ? (v as (c: T) => T)(cur) : v)

export function AppProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const userId = session.user?.id

  const [drops, setDrops] = useState<Drop[]>([])
  const [dropsLoading, setDropsLoading] = useState(true)
  const [dropsFailed, setDropsFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const dropsRef = useRef(drops)
  dropsRef.current = drops

  useEffect(() => {
    let alive = true
    setDropsFailed(false)
    api.listDrops()
      .then((d) => { if (alive) setDrops(d) })
      .catch(() => { if (alive) setDropsFailed(true) })
      .finally(() => { if (alive) setDropsLoading(false) })
    return () => { alive = false }
  }, [attempt])

  const retryDrops = useCallback(() => { setDropsLoading(true); setAttempt((n) => n + 1) }, [])
  const refreshDrops = useCallback(async () => {
    try { setDrops(await api.listDrops()) } catch { /* keep what we have */ }
  }, [])
  const patchDrop = useCallback((id: string, patch: Partial<Drop>) => {
    setDrops((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  const [entries, setEntries] = useState<Record<string, Entry | null | undefined>>({})
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [draws, setDraws] = useState<Record<string, DrawInfo | undefined>>({})
  const [conn, setConn] = useState<ConnState>('live')
  const [flow, setFlow] = useState<Flow>(null)

  const setEntry = useCallback((id: string, v: Setter<Entry | null>) => {
    setEntries((m) => ({ ...m, [id]: apply(v, m[id] ?? null) }))
  }, [])
  const setDraw = useCallback((id: string, v: Setter<DrawInfo | undefined>) => {
    setDraws((m) => ({ ...m, [id]: apply(v, m[id]) }))
  }, [])
  const setTicket = useCallback((t: Ticket) => {
    setTickets((list) => [...list.filter((x) => x.id !== t.id), t])
  }, [])

  // One request per drop. A single "my entries" endpoint would be cheaper under load,
  // worth asking the backend for.
  const refreshEntries = useCallback(async () => {
    if (!userId) { setEntries({}); setTickets([]); return }
    const ids = dropsRef.current.map((d) => d.id)
    const [list, t] = await Promise.all([
      Promise.all(ids.map((id) => api.getMyEntry(id).catch(() => undefined))),
      api.getTickets().catch(() => undefined),
    ])
    setEntries((m) => {
      const next = { ...m }
      ids.forEach((id, i) => { if (list[i] !== undefined) next[id] = list[i] })
      return next
    })
    if (t) setTickets(t)
  }, [userId])

  useEffect(() => { refreshEntries() }, [refreshEntries, drops.length])

  const openFlow = useCallback((kind: 'signin' | 'enter', dropId?: string) => setFlow({ kind, dropId }), [])
  const closeFlow = useCallback(() => setFlow(null), [])

  const value = useMemo<AppState>(() => ({
    ...session, drops, dropsLoading, dropsFailed, retryDrops, refreshDrops, patchDrop,
    entries, setEntry, refreshEntries, tickets, setTicket, draws, setDraw, conn, setConn, flow, openFlow, closeFlow,
  }), [session, drops, dropsLoading, dropsFailed, retryDrops, refreshDrops, patchDrop, entries, setEntry, refreshEntries, tickets, setTicket, draws, setDraw, conn, flow, openFlow, closeFlow])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used inside AppProvider')
  return v
}

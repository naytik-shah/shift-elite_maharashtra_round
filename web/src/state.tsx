import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type ConnState, type DrawInfo, type Drop, type Entry, type Ticket } from '@/api'
import { useSession } from '@/hooks/useSession'

type Flow = { kind: 'login' | 'confirm'; dropId?: string } | null
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
  setDraw: (id: string, v: DrawInfo) => void
  conn: ConnState
  setConn: (c: ConnState) => void
  flow: Flow
  openFlow: (kind: 'login' | 'confirm', dropId?: string) => void
  closeFlow: () => void
}

const Ctx = createContext<AppState | null>(null)

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

  // The list call only has the summary fields, so details already loaded are kept.
  const merge = useCallback((list: Drop[]) => {
    setDrops((cur) => list.map((d) => ({ ...cur.find((c) => c.id === d.id), ...d })))
  }, [])

  useEffect(() => {
    let alive = true
    setDropsFailed(false)
    api.listDrops()
      .then((d) => { if (alive) merge(d) })
      .catch(() => { if (alive) setDropsFailed(true) })
      .finally(() => { if (alive) setDropsLoading(false) })
    return () => { alive = false }
  }, [attempt, merge])

  const retryDrops = useCallback(() => { setDropsLoading(true); setAttempt((n) => n + 1) }, [])
  const refreshDrops = useCallback(async () => {
    try { merge(await api.listDrops()) } catch { /* keep what we have */ }
  }, [merge])
  const patchDrop = useCallback((id: string, patch: Partial<Drop>) => {
    setDrops((list) => (list.some((d) => d.id === id)
      ? list.map((d) => (d.id === id ? { ...d, ...patch } : d))
      : 'name' in patch ? [...list, patch as Drop] : list))
  }, [])

  const [entries, setEntries] = useState<Record<string, Entry | null | undefined>>({})
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [draws, setDraws] = useState<Record<string, DrawInfo | undefined>>({})
  const [conn, setConn] = useState<ConnState>('live')
  const [flow, setFlow] = useState<Flow>(null)

  const setEntry = useCallback((id: string, v: Setter<Entry | null>) => {
    setEntries((m) => ({ ...m, [id]: apply(v, m[id] ?? null) }))
  }, [])
  const setDraw = useCallback((id: string, v: DrawInfo) => setDraws((m) => ({ ...m, [id]: v })), [])
  const setTicket = useCallback((t: Ticket) => {
    setTickets((list) => [...list.filter((x) => x.id !== t.id), t])
  }, [])

  // One status read per drop. The drop list is short, so this stays cheap.
  const refreshEntries = useCallback(async () => {
    if (!userId) { setEntries({}); setTickets([]); return }
    // A finished drop only needs a read if this person already had an entry in it. Everything else would
    // be one more request per page load for nothing, and each address has a request limit.
    const ids = dropsRef.current.filter((d) => d.state !== 'COMPLETE').map((d) => d.id)
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

  const openFlow = useCallback((kind: 'login' | 'confirm', dropId?: string) => setFlow({ kind, dropId }), [])
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

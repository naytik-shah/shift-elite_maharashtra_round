import { protection } from '@/lib/protection'
import { backoff, sleep } from '@/lib/utils'
import {
  ApiError, type AuditEvent, type ConnState, type DrawInfo, type DrawResults, type Drop, type Entry,
  type EntryState, type ErrorCode, type FairDropApi, type FlagDetail, type FlagPage, type LiveEvent,
  type LiveStats, type ManifestEntry, type PowChallenge, type RunResult, type RunSummary, type Slot,
  type Ticket, type User,
} from './types'

const BASE = '/api/v1'
const MAX_TRIES = 3
const POLL_MS = 5000
// Visitors who are not logged in only need the drop state, so they poll less often.
const GUEST_POLL_MS = 15000

interface Options {
  method?: 'GET' | 'POST'
  body?: unknown
  key?: string
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  // Safe to try again when the call is a read, or carries a key the server can dedupe on.
  const retryable = method === 'GET' || !!opts.key

  for (let attempt = 0; ; attempt++) {
    const last = attempt + 1 >= MAX_TRIES || !retryable
    let res: Response
    try {
      res = await fetch(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          // The server requires a json content type on every mutating route.
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.key ? { 'Idempotency-Key': opts.key } : {}),
        },
        body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
      })
    } catch {
      if (!last) { await sleep(backoff(attempt, 500, 4000)); continue }
      throw new ApiError('NETWORK', 'Network error')
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }

    const retryAfter = Number(res.headers.get('Retry-After')) || undefined
    if (res.status === 429) protection.rateLimited(retryAfter ?? 30)
    // A busy or failing server is retried. A 429 is surfaced so the screen can show the wait.
    if (res.status >= 500 && !last) {
      await sleep(retryAfter ? retryAfter * 1000 : backoff(attempt, 500, 4000))
      continue
    }

    let code: ErrorCode = res.status === 429 ? 'RATE_LIMITED' : res.status === 401 ? 'UNAUTHENTICATED' : res.status === 503 ? 'SERVICE_BUSY' : 'UNKNOWN'
    let message = res.statusText
    try {
      const data = await res.json()
      if (data?.error?.code) code = data.error.code
      if (data?.error?.message) message = data.error.message
    } catch { /* body was not json */ }
    throw new ApiError(code, message, res.status, retryAfter)
  }
}

const post = <T>(path: string, body?: unknown, key?: string) => request<T>(path, { method: 'POST', body, key })

async function getMyEntry(dropId: string): Promise<Entry | null> {
  try {
    return await request<Entry>(`/drops/${dropId}/entries/me`)
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 401)) return null
    throw err
  }
}

const getDrop = (dropId: string) => request<Drop>(`/drops/${dropId}`)

function subscribe(dropId: string, authed: boolean, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void) {
  let stopped = false
  let polling = false
  let es: EventSource | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let reopenTimer: ReturnType<typeof setTimeout> | undefined

  const poll = async () => {
    if (stopped) return
    try {
      const [drop, entry] = await Promise.all([getDrop(dropId), authed ? getMyEntry(dropId) : null])
      if (stopped) return
      onEvent({ type: 'drop_state', state: drop.state })
      if (entry) onEvent({ type: 'your_status', ...entry })
    } catch { /* try again on the next tick */ }
    if (!stopped && polling) pollTimer = setTimeout(poll, authed ? POLL_MS : GUEST_POLL_MS)
  }

  const startPolling = () => {
    clearTimeout(pollTimer)
    polling = true
    onConn(navigator.onLine ? 'polling' : 'offline')
    pollTimer = setTimeout(poll, authed ? 0 : GUEST_POLL_MS)
  }

  const open = () => {
    if (stopped || !authed) return
    clearTimeout(reopenTimer)
    es?.close()
    es = new EventSource(`${BASE}/drops/${dropId}/events`)
    // The server sends the current status first on every connect, so nothing is missed.
    es.onopen = () => { polling = false; clearTimeout(pollTimer); onConn('live') }
    es.onerror = () => {
      if (stopped) return
      startPolling()
      // The browser retries on its own unless the stream was closed for good.
      if (es?.readyState === EventSource.CLOSED) reopenTimer = setTimeout(open, 15_000)
    }
    const listen = (name: LiveEvent['type']) =>
      es!.addEventListener(name, (ev) => {
        try {
          onEvent({ type: name, ...JSON.parse((ev as MessageEvent).data) } as LiveEvent)
        } catch { /* skip a malformed event */ }
      })
    listen('your_status')
    listen('drop_state')
  }

  const onOnline = () => { if (authed) open(); else { startPolling(); onConn('live') } }
  const onOffline = () => onConn('offline')
  const onVisible = () => {
    // Phones suspend the stream in the background, so reopen as soon as the tab is back.
    if (document.visibilityState === 'visible' && authed && es?.readyState !== EventSource.OPEN) open()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)

  if (authed) open()
  else { polling = true; onConn('live'); pollTimer = setTimeout(poll, GUEST_POLL_MS) }

  return () => {
    stopped = true
    es?.close()
    clearTimeout(pollTimer)
    clearTimeout(reopenTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export const httpApi: FairDropApi = {
  async me() {
    try {
      return await request<User>('/me')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  },
  getPowChallenge: (purpose) => request<PowChallenge>(`/pow/challenge?purpose=${purpose}`),
  async requestOtp(email, pow) {
    return (await post<{ devCode?: string } | undefined>('/auth/otp/request', { email, pow })) ?? {}
  },
  async verifyOtp(email, code) {
    const res = await post<{ user?: User } | undefined>('/auth/otp/verify', { email, code })
    // The MVP answer may be empty, so fall back to asking who we are.
    return res?.user ?? (await request<User>('/me'))
  },
  logout: () => post<void>('/auth/logout'),

  async listDrops() {
    return (await request<{ drops: Drop[] }>('/drops')).drops
  },
  getDrop,
  enter: (dropId, body, key) => post<{ entryId: string; state: EntryState }>(`/drops/${dropId}/entries`, body, key),
  getMyEntry,
  async confirm(dropId, body, key) {
    return (await post<{ ticket: Ticket }>(`/drops/${dropId}/entries/me/confirm`, body, key)).ticket
  },
  async getTickets() {
    return (await request<{ tickets: Ticket[] }>('/tickets/me')).tickets ?? []
  },

  getDraw: (dropId) => request<DrawInfo>(`/drops/${dropId}/draw`),
  async getManifest(dropId) {
    return (await request<{ entries: ManifestEntry[] }>(`/drops/${dropId}/draw/manifest`)).entries
  },
  getResults: (dropId) => request<DrawResults>(`/drops/${dropId}/draw/results`),

  subscribe,

  admin: {
    close: (dropId, key) => post<void>(`/admin/drops/${dropId}/close`, {}, key),
    score: (dropId, key) => post(`/admin/drops/${dropId}/score`, {}, key),
    draw: (dropId, key) => post(`/admin/drops/${dropId}/draw`, {}, key),
    live: (dropId) => request<LiveStats>(`/admin/drops/${dropId}/live`),
    async slots(dropId) {
      return (await request<{ slots: Slot[] }>(`/admin/drops/${dropId}/slots`)).slots ?? []
    },
    flags: (dropId, minScore, page) => request<FlagPage>(`/admin/drops/${dropId}/flags?minScore=${minScore}&page=${page}`),
    flag: (dropId, entryId) => request<FlagDetail>(`/admin/drops/${dropId}/flags/${entryId}`),
    async audit(dropId) {
      return (await request<{ events: AuditEvent[] }>(`/admin/audit?dropId=${encodeURIComponent(dropId)}`)).events ?? []
    },
    async runs() {
      return (await request<{ runs: RunSummary[] }>('/admin/runs')).runs ?? []
    },
    run: (runId) => request<RunResult>(`/admin/runs/${encodeURIComponent(runId)}`),
  },
}

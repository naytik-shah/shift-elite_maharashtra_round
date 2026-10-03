import { backoff, sleep, uuid } from '@/lib/utils'
import {
  ApiError, type ConnState, type DrawInfo, type Drop, type Entry, type ErrorCode,
  type FairDropApi, type LiveEvent, type PowChallenge, type Ticket, type User,
} from './types'

const BASE = '/api/v1'
const MAX_TRIES = 3
// Heartbeats arrive every 20 s. Two missed beats means the stream is dead even if the socket looks open.
const STALE_MS = 45_000
// After this many failed reconnects we stop hammering SSE and read status with backoff instead.
const SSE_FAILS_BEFORE_POLLING = 3

interface Options {
  method?: string
  body?: unknown
  idempotencyKey?: string
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const mutating = method !== 'GET'
  // One key for all tries of this call, so the server returns the first result on a retry.
  const key = mutating ? opts.idempotencyKey ?? uuid() : undefined

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(BASE + path, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch {
      if (attempt + 1 < MAX_TRIES) { await sleep(backoff(attempt, 500, 4000)); continue }
      throw new ApiError('NETWORK', 'Network error')
    }

    if (res.ok) {
      if (res.status === 204 || res.status === 202) return undefined as T
      return (await res.json()) as T
    }

    const retryAfter = Number(res.headers.get('Retry-After')) || undefined
    // Only server faults are retried here. A 429 is surfaced so the UI can show the wait.
    if (res.status >= 500 && attempt + 1 < MAX_TRIES) { await sleep(backoff(attempt, 500, 4000)); continue }

    let code: ErrorCode = res.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN'
    let message = res.statusText
    try {
      const data = await res.json()
      if (data?.error?.code) code = data.error.code
      if (data?.error?.message) message = data.error.message
    } catch { /* body was not json */ }
    throw new ApiError(code, message, res.status, retryAfter)
  }
}

function subscribe(dropId: string, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void) {
  let stopped = false
  let es: EventSource | null = null
  let fails = 0
  let lastSeen = Date.now()
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let pollAttempt = 0

  const names: LiveEvent['type'][] = ['drop_state', 'manifest_published', 'draw_complete', 'your_status', 'waitlist_moved']

  const open = () => {
    if (stopped) return
    es?.close()
    // The browser resends Last-Event-ID on its own reconnects, the server replays what we missed.
    es = new EventSource(`${BASE}/drops/${dropId}/events`, { withCredentials: true })
    es.onopen = () => {
      fails = 0
      pollAttempt = 0
      lastSeen = Date.now()
      clearTimeout(pollTimer)
      onConn('live')
    }
    es.onerror = () => {
      if (stopped) return
      fails++
      if (!navigator.onLine) { onConn('offline'); return }
      if (fails >= SSE_FAILS_BEFORE_POLLING) { es?.close(); startPolling(); return }
      onConn('reconnecting')
    }
    es.addEventListener('heartbeat', () => { lastSeen = Date.now() })
    for (const name of names) {
      es.addEventListener(name, (ev) => {
        lastSeen = Date.now()
        try {
          onEvent({ type: name, ...JSON.parse((ev as MessageEvent).data) } as LiveEvent)
        } catch { /* skip a malformed event */ }
      })
    }
  }

  const poll = async () => {
    if (stopped) return
    try {
      const [drop, entry] = await Promise.all([httpApi.getDrop(dropId), httpApi.getMyEntry(dropId).catch(() => null)])
      if (stopped) return
      onEvent({ type: 'drop_state', state: drop.state })
      if (entry) onEvent({ type: 'your_status', ...entry })
      pollAttempt = 0
      // Every few good polls, try the stream again.
      if (++fails % 4 === 0) { open(); return }
    } catch (err) {
      pollAttempt++
      if (err instanceof ApiError && err.retryAfter) {
        pollTimer = setTimeout(poll, err.retryAfter * 1000)
        return
      }
    }
    pollTimer = setTimeout(poll, 2000 + backoff(pollAttempt, 2000, 30_000))
  }

  const startPolling = () => {
    clearTimeout(pollTimer)
    onConn(navigator.onLine ? 'polling' : 'offline')
    poll()
  }

  const watchdog = setInterval(() => {
    if (es?.readyState === EventSource.OPEN && Date.now() - lastSeen > STALE_MS) open()
  }, 10_000)

  const onOnline = () => { fails = 0; onConn('reconnecting'); open() }
  const onOffline = () => onConn('offline')
  const onVisible = () => {
    // Phones suspend the stream in the background, so reopen as soon as the tab is back.
    if (document.visibilityState === 'visible' && es?.readyState !== EventSource.OPEN) onOnline()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)

  onConn(navigator.onLine ? 'reconnecting' : 'offline')
  open()

  return () => {
    stopped = true
    es?.close()
    clearTimeout(pollTimer)
    clearInterval(watchdog)
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
  requestOtp: (email, pow) => request<void>('/auth/otp/request', { method: 'POST', body: { email, pow } }),
  async verifyOtp(email, code) {
    const res = await request<{ user: User }>('/auth/otp/verify', { method: 'POST', body: { email, code } })
    return res.user
  },
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  async listDrops() {
    return (await request<{ drops: Drop[] }>('/drops')).drops
  },
  getDrop: (dropId) => request<Drop>(`/drops/${dropId}`),
  getDraw: (dropId) => request<DrawInfo>(`/drops/${dropId}/draw`),

  // TODO confirm with backend how the browser gets a payment method token from the mock payment service
  createPaymentMethod: (upiId) => request<{ token: string }>('/payments/methods', { method: 'POST', body: { type: 'upi', upiId } }),
  enter: (dropId, body, idempotencyKey) =>
    request<Entry>(`/drops/${dropId}/entries`, { method: 'POST', body, idempotencyKey }),
  async getMyEntry(dropId) {
    try {
      return await request<Entry>(`/drops/${dropId}/entries/me`)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) return null
      throw err
    }
  },
  async confirm(dropId, paymentMethodToken, idempotencyKey) {
    const res = await request<{ ticket: Ticket }>(`/drops/${dropId}/entries/me/confirm`, {
      method: 'POST', body: { paymentMethodToken }, idempotencyKey,
    })
    return res.ticket
  },
  async getTickets() {
    return (await request<{ tickets: Ticket[] }>('/tickets/me')).tickets
  },

  subscribe,
}

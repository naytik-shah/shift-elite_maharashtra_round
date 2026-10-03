import type { EntryStatus, EventInfo, FairDropApi, Session } from './types'

// Local stand in for Naytik's backend so the UI can be built in parallel.
// State lives in localStorage, so refresh and reconnect behave like a real session.

const KEY = 'fd.mock.v1'
const SEATS = 500
const DRAW_DELAY_MS = 45_000
const HOLD_MS = 90_000

interface Store {
  drawAt: number
  entered: Record<string, number>
  confirmed: Record<string, boolean>
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const fresh: Store = { drawAt: Date.now() + DRAW_DELAY_MS, entered: {}, confirmed: {} }
  save(fresh)
  return fresh
}

function save(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function hash(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms))

function statusFor(userId: string): EntryStatus {
  const s = load()
  const enteredAt = s.entered[userId]
  if (!enteredAt) return { state: 'not_entered' }
  if (s.confirmed[userId]) return { state: 'confirmed' }
  const now = Date.now()
  if (now < s.drawAt) return { state: 'entered' }

  // Pretend rank from the draw, then admit people in order every 2 seconds.
  const rank = (hash(userId + s.drawAt) % 1200) + 1
  if (rank > SEATS + 400) return { state: 'lost' }
  const admittedAt = s.drawAt + rank * 100
  if (now < admittedAt) {
    return { state: 'queued', position: Math.ceil((admittedAt - now) / 100) }
  }
  const holdExpiresAt = admittedAt + HOLD_MS
  if (now > holdExpiresAt) return { state: 'expired' }
  return { state: 'holding', holdExpiresAt }
}

export const mockApi: FairDropApi = {
  async register(name, email) {
    await wait()
    const userId = 'u_' + hash(email.toLowerCase()).toString(36)
    return { token: 'mock.' + userId, userId, name }
  },
  async getEvent(): Promise<EventInfo> {
    await wait(80)
    const s = load()
    const entrants = 48_000 + Object.keys(s.entered).length
    return {
      id: 'drop-1',
      name: 'Shift Elite Finals Night',
      seats: SEATS,
      entrants,
      drawAt: s.drawAt,
      status: Date.now() >= s.drawAt ? 'drawn' : 'open',
    }
  },
  async enter(session: Session) {
    await wait()
    const s = load()
    // The window closes at the draw, late entries are turned away.
    if (Date.now() >= s.drawAt) return statusFor(session.userId)
    // One entry per identity, repeat calls are harmless.
    if (!s.entered[session.userId]) s.entered[session.userId] = Date.now()
    save(s)
    return statusFor(session.userId)
  },
  async getStatus(session: Session) {
    await wait(60)
    return statusFor(session.userId)
  },
  async confirm(session: Session) {
    await wait(300)
    const cur = statusFor(session.userId)
    if (cur.state !== 'holding') return cur
    const s = load()
    s.confirmed[session.userId] = true
    save(s)
    return { state: 'confirmed' }
  },
}

export function resetMock() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

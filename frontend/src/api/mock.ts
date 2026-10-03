import { leadingZeroBits, sha256, toHex } from '@/lib/sha256'
import { sleep } from '@/lib/utils'
import {
  ApiError, type ConnState, type Drop, type DropState, type Entry, type EventCategory,
  type FairDropApi, type LiveEvent, type Ticket, type User,
} from './types'

// Local stand in for Naytik's backend so the UI can be built in parallel.
// State lives in localStorage, so refresh and reconnect behave like a real session.
// The first event runs the whole lottery in about two minutes so it can be demoed.
// The others sit in a fixed phase (open for days, opening soon, ended).

const KEY = 'fd.mock.v3'
const DAY = 86_400_000
const DEMO_ID = 'd_1'
const CLOSED_MS = 4_000
const SCORING_MS = 5_000
const WAITLIST_START = 9
const WAITLIST_STEP_MS = 2_500
const DIFFICULTY = 18

export type MockOutcome = 'won' | 'waitlist' | 'lost'

interface Seed {
  id: string
  name: string
  seats: number
  category: EventCategory
  venue: string
  city: string
  description: string
  holdAmount: number
  confirmMs: number
  opens: number
  closes: number
  event: number
  done?: boolean
}

const SEEDS: Seed[] = [
  {
    id: DEMO_ID, name: 'Shift Elite Finals Night', seats: 500, category: 'Tech', venue: 'Bayfront Convention Hall', city: 'Mumbai',
    description: 'The finals of the Shift Elite hackathon: live demos, a panel and the awards. This one runs the full draw in about two minutes so you can see every step.',
    holdAmount: 100, confirmMs: 120_000, opens: -60_000, closes: 75_000, event: 20 * DAY,
  },
  {
    id: 'd_2', name: 'Neon Nights Live', seats: 800, category: 'Music', venue: 'Riverside Arena', city: 'Pune',
    description: 'A full night of electronic sets across two stages, with a light show built around the river. Standing floor only.',
    holdAmount: 300, confirmMs: 600_000, opens: -DAY, closes: 3 * DAY, event: 30 * DAY,
  },
  {
    id: 'd_3', name: 'Comedy Night Finals', seats: 250, category: 'Comedy', venue: 'Canvas Laugh Club', city: 'Mumbai',
    description: 'Eight finalists, one trophy, and a room small enough that nobody hides. Seated, doors at 7 pm.',
    holdAmount: 150, confirmMs: 600_000, opens: -2 * DAY, closes: 20 * 3_600_000, event: 9 * DAY,
  },
  {
    id: 'd_4', name: 'City Run Expo Pass', seats: 300, category: 'Sports', venue: 'Marine Drive Promenade', city: 'Mumbai',
    description: 'Early entry to the run expo: bib pickup, gear fitting and the pacer briefing, without the queue.',
    holdAmount: 100, confirmMs: 600_000, opens: 2 * DAY, closes: 6 * DAY, event: 40 * DAY,
  },
  {
    id: 'd_5', name: 'Jazz at the Gateway', seats: 200, category: 'Music', venue: 'Gateway Courtyard', city: 'Mumbai',
    description: 'An open air evening of live jazz by the water. Small crowd, seated, one hundred percent acoustic.',
    holdAmount: 250, confirmMs: 600_000, opens: 5 * DAY, closes: 9 * DAY, event: 45 * DAY,
  },
  {
    id: 'd_6', name: 'Startup Summit Maharashtra', seats: 400, category: 'Tech', venue: 'Orbit Conference Centre', city: 'Nagpur',
    description: 'A day of talks and founder meetups. Entries closed and the draw is complete.',
    holdAmount: 100, confirmMs: 600_000, opens: -9 * DAY, closes: -3 * DAY, event: 5 * DAY, done: true,
  },
]

interface DropRec {
  opensAt: number
  closesAt: number
  seed: string
  entry: { entryId: string; token: string; at: number } | null
  ticket: Ticket | null
}

interface Store {
  outcome: MockOutcome | null
  user: User | null
  drops: Record<string, DropRec>
  anchors: Record<string, string>
  challenges: Record<string, { prefix: string; expiresAt: number }>
  created: number
}

const hex = (n: number) => toHex(crypto.getRandomValues(new Uint8Array(n)))

function fresh(): Store {
  const now = Date.now()
  const drops: Record<string, DropRec> = {}
  for (const s of SEEDS) {
    drops[s.id] = { opensAt: now + s.opens, closesAt: now + s.closes, seed: hex(32), entry: null, ticket: null }
  }
  return { outcome: null, user: null, drops, anchors: {}, challenges: {}, created: now }
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  const s = fresh()
  save(s)
  return s
}

function save(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

const drawAt = (r: DropRec) => r.closesAt + CLOSED_MS + SCORING_MS

function find(s: Store, id: string): { seed: Seed; rec: DropRec } {
  const seed = SEEDS.find((x) => x.id === id)
  const rec = s.drops[id]
  if (!seed || !rec) throw new ApiError('NOT_FOUND', 'No such drop', 404)
  return { seed, rec }
}

function stateOf(seed: Seed, r: DropRec, now = Date.now()): DropState {
  if (seed.done) return 'COMPLETE'
  if (now < r.opensAt) return 'ANNOUNCED'
  if (now < r.closesAt) return 'OPEN'
  if (now < r.closesAt + CLOSED_MS) return 'CLOSED'
  if (now < drawAt(r)) return 'SCORING'
  return r.ticket ? 'COMPLETE' : 'CONFIRMING'
}

// Events start at 7 pm on their day, whatever time of day the mock was created.
function eventTime(s: Store, seed: Seed) {
  const d = new Date(s.created + seed.event)
  d.setHours(19, 0, 0, 0)
  return d.toISOString()
}

function toDrop(s: Store, seed: Seed): Drop {
  const r = s.drops[seed.id]
  return {
    id: seed.id,
    name: seed.name,
    seats: seed.seats,
    state: stateOf(seed, r),
    windowOpensAt: new Date(r.opensAt).toISOString(),
    windowClosesAt: new Date(r.closesAt).toISOString(),
    confirmWindowMinutes: seed.confirmMs / 60_000,
    holdAmount: seed.holdAmount,
    currency: 'INR',
    seedCommit: toHex(sha256(r.seed)),
    category: seed.category,
    venue: seed.venue,
    city: seed.city,
    description: seed.description,
    eventAt: eventTime(s, seed),
  }
}

function toEntry(s: Store, seed: Seed, r: DropRec, now = Date.now()): Entry | null {
  if (!r.entry) return null
  const base: Entry = { entryId: r.entry.entryId, state: 'ENTERED', rank: null, waitlistPosition: null, confirmBy: null }
  if (now < drawAt(r)) return base
  const outcome = s.outcome ?? (() => {
    const roll = sha256(r.seed + r.entry!.entryId)[0]
    return roll < 128 ? 'won' : roll < 210 ? 'waitlist' : 'lost'
  })()
  const idRoll = sha256(r.entry.entryId)[1]

  if (outcome === 'lost') return { ...base, state: 'NOT_SELECTED', rank: 2000 + idRoll * 150 }

  let rank = 1 + idRoll
  let wonAt = drawAt(r)
  if (outcome === 'waitlist') {
    rank = seed.seats + WAITLIST_START
    const moved = Math.floor((now - drawAt(r)) / WAITLIST_STEP_MS)
    if (moved < WAITLIST_START) {
      return { ...base, state: 'WAITLISTED', rank, waitlistPosition: WAITLIST_START - moved }
    }
    wonAt = drawAt(r) + WAITLIST_START * WAITLIST_STEP_MS
  }
  if (r.ticket) return { ...base, state: 'CONFIRMED', rank }
  const confirmBy = wonAt + seed.confirmMs
  if (now > confirmBy) return { ...base, state: 'EXPIRED', rank }
  return { ...base, state: 'WON', rank, confirmBy: new Date(confirmBy).toISOString() }
}

function needUser(s: Store): User {
  if (!s.user) throw new ApiError('UNAUTHENTICATED', 'Sign in first', 401)
  return s.user
}

function checkPow(s: Store, pow: { challengeId: string; nonce: string }) {
  const ch = s.challenges[pow.challengeId]
  if (!ch) throw new ApiError('POW_INVALID', 'Unknown challenge', 400)
  delete s.challenges[pow.challengeId]
  save(s)
  if (Date.now() > ch.expiresAt) throw new ApiError('POW_EXPIRED', 'Challenge expired', 400)
  if (leadingZeroBits(sha256(ch.prefix + pow.nonce)) < DIFFICULTY) throw new ApiError('POW_INVALID', 'Bad nonce', 400)
}

const DISPOSABLE = ['mailinator.com', 'tempmail.com', '10minutemail.com']

export const mockApi: FairDropApi = {
  async me() {
    await sleep(60)
    return load().user
  },
  async getPowChallenge() {
    await sleep(80)
    const s = load()
    const challengeId = 'c_' + hex(4)
    const prefix = hex(16)
    const expiresAt = Date.now() + 120_000
    s.challenges[challengeId] = { prefix, expiresAt }
    save(s)
    return { challengeId, prefix, difficulty: DIFFICULTY, expiresAt: new Date(expiresAt).toISOString() }
  },
  async requestOtp(email, pow) {
    await sleep(250)
    checkPow(load(), pow)
    if (DISPOSABLE.includes(email.split('@')[1]?.toLowerCase())) {
      throw new ApiError('FORBIDDEN', 'Disposable email addresses are not accepted.', 403)
    }
  },
  async verifyOtp(email, code) {
    await sleep(300)
    // Any six digits work here except this one, kept so the error state can be seen.
    if (!/^\d{6}$/.test(code) || code === '000000') throw new ApiError('OTP_INVALID', 'Wrong code', 400)
    const s = load()
    const clean = email.trim().toLowerCase()
    s.user = { id: 'u_' + toHex(sha256(clean)).slice(0, 8), email: clean, role: 'participant' }
    save(s)
    return s.user
  },
  async logout() {
    await sleep(80)
    const s = load()
    s.user = null
    save(s)
  },

  async listDrops() {
    await sleep(120)
    const s = load()
    return SEEDS.map((seed) => toDrop(s, seed))
  },
  async getDrop(dropId) {
    await sleep(80)
    const s = load()
    return toDrop(s, find(s, dropId).seed)
  },
  async getDraw(dropId) {
    await sleep(80)
    const s = load()
    const { seed, rec } = find(s, dropId)
    const now = Date.now()
    const closed = seed.done || now >= rec.closesAt + CLOSED_MS
    return {
      seedCommit: toHex(sha256(rec.seed)),
      seed: seed.done || now >= drawAt(rec) ? rec.seed : null,
      manifestHash: closed ? toHex(sha256('manifest' + rec.seed)) : null,
      algorithm: 'es-weighted-v1',
    }
  },

  async createPaymentMethod(upiId) {
    await sleep(200)
    return { token: 'pm_test_' + toHex(sha256(upiId.trim().toLowerCase())).slice(0, 12) + (upiId.startsWith('fail') ? '_fail' : '') }
  },
  async enter(dropId, body) {
    await sleep(350)
    const s = load()
    const user = needUser(s)
    const { seed, rec } = find(s, dropId)
    checkPow(s, body.pow)
    if (stateOf(seed, rec) !== 'OPEN') throw new ApiError('DROP_NOT_OPEN', 'Entries are closed', 409)
    if (rec.entry) return toEntry(s, seed, rec)!
    if (body.paymentMethodToken.endsWith('_fail')) throw new ApiError('PAYMENT_FAILED', 'Declined', 402)
    const anchor = `${dropId}:${body.paymentMethodToken}`
    const owner = s.anchors[anchor]
    if (owner && owner !== user.id) throw new ApiError('ANCHOR_ALREADY_USED', 'Already used', 409)
    s.anchors[anchor] = user.id
    rec.entry = { entryId: 'e_' + hex(4), token: body.paymentMethodToken, at: Date.now() }
    save(s)
    return toEntry(s, seed, rec)!
  },
  async getMyEntry(dropId) {
    await sleep(60)
    const s = load()
    if (!s.user) return null
    const { seed, rec } = find(s, dropId)
    return toEntry(s, seed, rec)
  },
  async confirm(dropId, paymentMethodToken) {
    await sleep(500)
    const s = load()
    needUser(s)
    const { seed, rec } = find(s, dropId)
    if (rec.ticket) return rec.ticket
    const entry = toEntry(s, seed, rec)
    if (!entry || entry.state === 'EXPIRED') throw new ApiError('CONFIRM_WINDOW_EXPIRED', 'Too late', 410)
    if (entry.state !== 'WON') throw new ApiError('FORBIDDEN', 'No seat to confirm', 403)
    if (paymentMethodToken !== rec.entry!.token) throw new ApiError('FORBIDDEN', 'Anchor mismatch', 403)
    rec.ticket = { id: 't_' + dropId.slice(2) + '_' + entry.rank, dropId, seatNo: Math.min(entry.rank ?? 1, seed.seats), holderName: 'As on account' }
    save(s)
    return rec.ticket
  },
  async getTickets() {
    await sleep(60)
    const s = load()
    if (!s.user) return []
    return Object.values(s.drops).flatMap((r) => (r.ticket ? [r.ticket] : []))
  },

  subscribe(dropId, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void) {
    let lastDrop = ''
    let lastEntry = ''
    let lastSeed = false
    const tick = () => {
      if (!navigator.onLine) { onConn('offline'); return }
      onConn('live')
      const s = load()
      const { seed, rec } = find(s, dropId)
      const now = Date.now()
      const state = stateOf(seed, rec, now)
      if (state !== lastDrop) { lastDrop = state; onEvent({ type: 'drop_state', state }) }
      if (now >= drawAt(rec) && !lastSeed) { lastSeed = true; onEvent({ type: 'draw_complete', seed: rec.seed }) }
      const entry = s.user ? toEntry(s, seed, rec, now) : null
      const sig = JSON.stringify(entry)
      if (entry && sig !== lastEntry) { lastEntry = sig; onEvent({ type: 'your_status', ...entry }) }
    }
    const id = setInterval(tick, 500)
    tick()
    window.addEventListener('online', tick)
    window.addEventListener('offline', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', tick)
      window.removeEventListener('offline', tick)
    }
  },
}

// Demo helpers, only reachable from the account page when the mock is active.
export function resetMock(outcome: MockOutcome | null = null) {
  const prev = load()
  const s = fresh()
  s.user = prev.user
  s.outcome = outcome
  save(s)
}

export function mockOutcome(): MockOutcome | null {
  return load().outcome
}

export function skipToDraw() {
  const s = load()
  const r = s.drops[DEMO_ID]
  if (Date.now() < r.closesAt) { r.closesAt = Date.now() + 3_000; save(s) }
}

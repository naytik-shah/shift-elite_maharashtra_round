import { sha256 } from 'js-sha256'
import { leadingZeroBits } from '@/lib/bits'
import { manifestHash, rankEntries } from '@/lib/draw'
import { sleep, uuid } from '@/lib/utils'
import {
  ApiError, type AuditEvent, type ConnState, type Drop, type DropState, type Entry, type EntryState,
  type FairDropApi, type Flag, type LiveEvent, type RunResult, type Slot, type SlotState, type Ticket, type User,
} from './types'

// In browser stand in for the backend, following the same contract and the same rules
// (one entry per user, one card per seat, real draw maths, waitlist promotion, chained
// audit log). State lives in localStorage so refresh and reconnect behave like a session.
// Other entrants are simulated. launch-night closes and draws on its own a couple of
// minutes after it is created, the other drops wait for the organiser.

const KEY = 'fd.mock.v4'
const DAY = 86_400_000
const MIN = 60_000
const DIFFICULTY = 16
const ORGANISER = 'organiser@fairdrop.test'
const PAGE = 25
// A card number the mock treats as already used, so that error can be seen.
const USED_CARD = '4000000000000002'

interface MEntry {
  id: string
  userId: string | null
  state: EntryState
  weight: number
  rank: number | null
  risk: number | null
  // Simulated winners confirm at this time, or never when null.
  confirmAt: number | null
}

interface MSlot { slotNo: number; entryId: string | null; state: SlotState; confirmBy: number; anchor: string | null }

interface MDrop {
  id: string
  name: string
  seats: number
  state: DropState
  opensAt: number
  closesAt: number
  drawAt: number
  confirmMin: number
  ticketPrice: number
  seed: string
  manifestHash: string | null
  scored: boolean
  // Closes and draws by the clock, as if the organiser pressed the buttons on time.
  auto: boolean
  // While open, simulated entrants keep arriving, from base up to target.
  base: number
  target: number
  createdAt: number
  entries: MEntry[]
  slots: MSlot[]
  ranking: string[]
  tickets: (Ticket & { userId: string })[]
}

interface Store {
  user: User | null
  otp: Record<string, { code: string; attempts: number }>
  challenges: Record<string, { prefix: string; expiresAt: number }>
  drops: Record<string, MDrop>
  audit: (AuditEvent & { dropId: string })[]
}

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')
const simEntry = (): MEntry => ({ id: uuid(), userId: null, state: 'ENTERED', weight: 1, rank: null, risk: null, confirmAt: null })

function newDrop(d: Pick<MDrop, 'id' | 'name' | 'seats' | 'opensAt' | 'closesAt' | 'drawAt' | 'confirmMin' | 'auto'>, entrants: number, target = entrants): MDrop {
  return {
    ...d, state: 'OPEN', ticketPrice: 500, seed: hex(32), manifestHash: null, scored: false, base: entrants, target, createdAt: Date.now(),
    entries: Array.from({ length: entrants }, simEntry), slots: [], ranking: [], tickets: [],
  }
}

function audit(s: Store, dropId: string, type: string, payload: object) {
  const prevHash = s.audit.length ? s.audit[s.audit.length - 1].hash : '0'.repeat(64)
  const seq = s.audit.length + 1
  const text = JSON.stringify(payload)
  s.audit.push({ seq, dropId, type, payload: text, at: new Date().toISOString(), prevHash, hash: sha256(`${prevHash}|${seq}|${type}|${text}`) })
}

function close(s: Store, d: MDrop) {
  d.state = 'CLOSED'
  audit(s, d.id, 'CLOSED', { dropId: d.id, entries: d.entries.length })
}

// Risk for simulated entrants, spread so every tier has some rows. The signed in user stays clean.
function score(s: Store, d: MDrop) {
  let flagged = 0
  for (const e of d.entries) {
    const roll = parseInt(sha256(e.id).slice(0, 4), 16) / 0xffff
    e.risk = e.userId ? 4 : roll < 0.06 ? 85 + Math.round(roll * 200) : roll < 0.12 ? 60 + Math.round((roll - 0.06) * 400) : roll < 0.2 ? 30 + Math.round((roll - 0.12) * 360) : Math.round(roll * 30)
    e.weight = e.risk >= 85 ? 0.05 : e.risk >= 60 ? 0.2 : e.risk >= 30 ? 0.5 : 1
    if (e.risk >= 60) flagged++
  }
  d.scored = true
  audit(s, d.id, 'SCORED', { scored: d.entries.length, flagged })
  return { scored: d.entries.length, flagged }
}

const confirmDelay = () => (Math.random() < 0.65 ? Date.now() + 3000 + Math.random() * 22_000 : null)

function draw(s: Store, d: MDrop) {
  const manifest = d.entries
    .map((e) => ({ entryId: e.id, weight: e.weight }))
    .sort((a, b) => (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0))
  d.manifestHash = manifestHash(manifest)
  d.ranking = rankEntries(d.seed, manifest)
  const byId = new Map(d.entries.map((e) => [e.id, e]))
  const now = Date.now()
  d.ranking.forEach((id, i) => {
    const e = byId.get(id)!
    e.rank = i + 1
    e.state = i < d.seats ? 'WON' : 'WAITLISTED'
    if (i < d.seats) {
      if (!e.userId) e.confirmAt = confirmDelay()
      d.slots.push({ slotNo: i + 1, entryId: id, state: 'PENDING', confirmBy: now + d.confirmMin * MIN, anchor: null })
    }
  })
  d.state = 'DRAWN'
  audit(s, d.id, 'DRAWN', { dropId: d.id, entries: d.entries.length, seats: d.seats, manifestHash: d.manifestHash })
}

// What the worker does on the server: confirm, expire, promote, complete.
function work(s: Store, d: MDrop, now: number): boolean {
  let changed = false
  const byId = new Map(d.entries.map((e) => [e.id, e]))
  for (const slot of d.slots) {
    if (slot.state !== 'PENDING' || !slot.entryId) continue
    const e = byId.get(slot.entryId)!
    if (!e.userId && e.confirmAt && now >= e.confirmAt && now < slot.confirmBy) {
      slot.state = 'CONFIRMED'
      slot.anchor = sha256('sim' + e.id)
      e.state = 'CONFIRMED'
      audit(s, d.id, 'CONFIRMED', { slotNo: slot.slotNo, entryId: e.id })
      changed = true
    } else if (now >= slot.confirmBy) {
      e.state = 'EXPIRED'
      const nextId = d.ranking.find((id) => byId.get(id)!.state === 'WAITLISTED')
      if (nextId) {
        const next = byId.get(nextId)!
        next.state = 'WON'
        if (!next.userId) next.confirmAt = confirmDelay()
        slot.entryId = nextId
        slot.confirmBy = now + d.confirmMin * MIN
        audit(s, d.id, 'PROMOTED', { slotNo: slot.slotNo, expired: e.id, entryId: nextId })
      } else {
        slot.state = 'UNFILLED'
        audit(s, d.id, 'UNFILLED', { slotNo: slot.slotNo, expired: e.id })
      }
      changed = true
    }
  }
  if (!d.slots.some((x) => x.state === 'PENDING')) {
    for (const e of d.entries) if (e.state === 'WAITLISTED') e.state = 'NOT_SELECTED'
    d.state = 'COMPLETE'
    audit(s, d.id, 'COMPLETE', { dropId: d.id, confirmed: d.slots.filter((x) => x.state === 'CONFIRMED').length })
    changed = true
  }
  return changed
}

// Moves every drop forward to the current time. Called before any read or write.
function advance(s: Store): boolean {
  const now = Date.now()
  let changed = false
  for (const d of Object.values(s.drops)) {
    if (d.state === 'OPEN' && now >= d.opensAt && now < d.closesAt && d.base < d.target) {
      const sims = d.entries.reduce((n, e) => n + (e.userId ? 0 : 1), 0)
      const want = Math.min(d.target, d.base + Math.floor((now - d.createdAt) / 700))
      for (let i = sims; i < want; i++) { d.entries.push(simEntry()); changed = true }
    }
    if (d.auto && d.state === 'OPEN' && now >= d.closesAt) { close(s, d); changed = true }
    if (d.auto && d.state === 'CLOSED' && now >= d.drawAt) { draw(s, d); changed = true }
    if (d.state === 'DRAWN' && work(s, d, now)) changed = true
  }
  return changed
}

function fresh(): Store {
  const now = Date.now()
  const s: Store = { user: null, otp: {}, challenges: {}, drops: {}, audit: [] }
  const add = (d: MDrop) => { s.drops[d.id] = d }

  add(newDrop({ id: 'launch-night', name: 'Launch Night', seats: 500, opensAt: now - 60 * MIN, closesAt: now + 90_000, drawAt: now + 110_000, confirmMin: 2, auto: true }, 640, 700))
  add(newDrop({ id: 'smoke-test', name: 'Smoke Test Drop', seats: 10, opensAt: now - DAY, closesAt: now + DAY, drawAt: now + DAY + 30 * MIN, confirmMin: 1, auto: false }, 100))
  add(newDrop({ id: 'campus-fest', name: 'Campus Fest Night', seats: 300, opensAt: now + 2 * DAY, closesAt: now + 5 * DAY, drawAt: now + 5 * DAY + 60 * MIN, confirmMin: 10, auto: false }, 0))

  // A finished drop, so the verify page has something to check straight away.
  const done = newDrop({ id: 'winter-gala', name: 'Winter Gala', seats: 20, opensAt: now - 9 * DAY, closesAt: now - 3 * DAY, drawAt: now - 3 * DAY + 60 * MIN, confirmMin: 10, auto: false }, 200)
  add(done)
  close(s, done)
  score(s, done)
  draw(s, done)
  for (const slot of done.slots) {
    slot.state = 'CONFIRMED'
    slot.anchor = sha256('sim' + slot.entryId)
    done.entries.find((e) => e.id === slot.entryId)!.state = 'CONFIRMED'
  }
  work(s, done, now)
  return s
}

function load(): Store {
  let s: Store | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) s = JSON.parse(raw)
  } catch { /* ignore */ }
  if (!s) { s = fresh(); save(s) }
  else if (advance(s)) save(s)
  return s
}

function save(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function find(s: Store, id: string): MDrop {
  const d = s.drops[id]
  if (!d) throw new ApiError('NOT_FOUND', 'No such drop', 404)
  return d
}

function needUser(s: Store): User {
  if (!s.user) throw new ApiError('UNAUTHENTICATED', 'Log in first', 401)
  return s.user
}

function needOrganiser(s: Store) {
  if (needUser(s).role !== 'organiser') throw new ApiError('FORBIDDEN', 'Organisers only', 403)
}

const iso = (t: number) => new Date(t).toISOString()

function toDrop(d: MDrop, full: boolean): Drop {
  const base: Drop = { id: d.id, name: d.name, seats: d.seats, state: d.state, windowOpensAt: iso(d.opensAt), windowClosesAt: iso(d.closesAt), drawAt: iso(d.drawAt) }
  return full ? { ...base, confirmWindowMinutes: d.confirmMin, ticketPrice: d.ticketPrice, seedCommit: sha256(d.seed) } : base
}

function toEntry(d: MDrop, userId: string): Entry | null {
  const e = d.entries.find((x) => x.userId === userId)
  if (!e) return null
  const slot = d.slots.find((x) => x.entryId === e.id && x.state === 'PENDING')
  return {
    entryId: e.id,
    state: e.state,
    rank: e.rank,
    waitlistPosition: e.state === 'WAITLISTED' ? d.entries.filter((w) => w.state === 'WAITLISTED' && w.rank! < e.rank!).length + 1 : null,
    confirmBy: e.state === 'WON' && slot ? iso(slot.confirmBy) : null,
  }
}

function checkPow(s: Store, pow: { challengeId: string; nonce: string }) {
  const ch = s.challenges[pow?.challengeId]
  if (!ch) throw new ApiError('POW_INVALID', 'Unknown puzzle', 400)
  delete s.challenges[pow.challengeId]
  save(s)
  if (Date.now() > ch.expiresAt || leadingZeroBits(sha256.array(ch.prefix + pow.nonce)) < DIFFICULTY) {
    throw new ApiError('POW_INVALID', 'Puzzle not solved', 400)
  }
}

const normalise = (email: string) => email.trim().toLowerCase()

const runs: RunResult[] = [
  { runId: 's0-baseline', scenario: 'S0', botSharePercent: 0, entries: { honest: 50000, bot: 0 }, winners: { honest: 500, bot: 0 }, confirmed: { honest: 498, bot: 0 }, botAdvantageRatio: 0, botSeatConversion: 0, honestFairShareDeviation: 0.01, falsePositiveRate: 0.008, latencyMs: { entryP95: 180, statusP95: 70 }, errors5xx: 0, rateLimited: 12 },
  { runId: 's1-30pct', scenario: 'S1', botSharePercent: 30, entries: { honest: 35000, bot: 15000 }, winners: { honest: 492, bot: 8 }, confirmed: { honest: 492, bot: 3 }, botAdvantageRatio: 0.05, botSeatConversion: 0.38, honestFairShareDeviation: 0.03, falsePositiveRate: 0.011, latencyMs: { entryP95: 205, statusP95: 82 }, errors5xx: 0, rateLimited: 9210 },
  { runId: 's2-30pct', scenario: 'S2', botSharePercent: 30, entries: { honest: 35000, bot: 15000 }, winners: { honest: 446, bot: 54 }, confirmed: { honest: 446, bot: 31 }, botAdvantageRatio: 0.36, botSeatConversion: 0.57, honestFairShareDeviation: 0.06, falsePositiveRate: 0.024, latencyMs: { entryP95: 230, statusP95: 91 }, errors5xx: 2, rateLimited: 3140 },
  { runId: 's6-50pct', scenario: 'S6', botSharePercent: 50, entries: { honest: 25000, bot: 25000 }, winners: { honest: 431, bot: 69 }, confirmed: { honest: 431, bot: 28 }, botAdvantageRatio: 0.28, botSeatConversion: 0.41, honestFairShareDeviation: 0.08, falsePositiveRate: 0.031, latencyMs: { entryP95: 310, statusP95: 120 }, errors5xx: 5, rateLimited: 48200 },
].map((r) => ({
  ...r,
  defences: { pow: true, rateLimits: true, scoring: true },
  hardGuarantees: { oversoldSeats: 0, cardsWithTwoSeats: 0, usersWithTwoEntries: 0, drawReproducible: true },
}))

export const mockApi: FairDropApi = {
  async me() {
    await sleep(60)
    return load().user
  },
  async getPowChallenge() {
    await sleep(60)
    const s = load()
    const challengeId = 'c_' + hex(4)
    const prefix = hex(16)
    s.challenges[challengeId] = { prefix, expiresAt: Date.now() + 2 * MIN }
    save(s)
    return { challengeId, prefix, difficulty: DIFFICULTY }
  },
  async requestOtp(email, pow) {
    await sleep(200)
    const s = load()
    checkPow(s, pow)
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError('VALIDATION_FAILED', 'Bad email', 400)
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
    s.otp[normalise(email)] = { code, attempts: 0 }
    save(s)
    // The mock behaves like test mode and hands the code back.
    return { devCode: code }
  },
  async verifyOtp(email, code) {
    await sleep(250)
    const s = load()
    const key = normalise(email)
    const otp = s.otp[key]
    if (!otp) throw new ApiError('OTP_INVALID', 'No code for this email', 400)
    if (otp.code !== code) {
      otp.attempts++
      const locked = otp.attempts >= 5
      if (locked) delete s.otp[key]
      save(s)
      throw locked ? new ApiError('OTP_LOCKED', 'Too many tries', 429) : new ApiError('OTP_INVALID', 'Wrong code', 400)
    }
    delete s.otp[key]
    s.user = { id: 'u_' + sha256(key).slice(0, 12), email: key, role: key === ORGANISER ? 'organiser' : 'participant' }
    save(s)
    return s.user
  },
  async logout() {
    await sleep(60)
    const s = load()
    s.user = null
    save(s)
  },

  async listDrops() {
    await sleep(120)
    return Object.values(load().drops).map((d) => toDrop(d, false))
  },
  async getDrop(dropId) {
    await sleep(80)
    return toDrop(find(load(), dropId), true)
  },
  async enter(dropId, body) {
    await sleep(250)
    const s = load()
    const user = needUser(s)
    const d = find(s, dropId)
    checkPow(s, body.pow)
    const now = Date.now()
    if (d.state !== 'OPEN' || now < d.opensAt || now > d.closesAt) throw new ApiError('DROP_NOT_OPEN', 'Entries are not open', 409)
    if (d.entries.some((e) => e.userId === user.id)) throw new ApiError('ALREADY_ENTERED', 'Already entered', 409)
    const e: MEntry = { ...simEntry(), userId: user.id }
    d.entries.push(e)
    save(s)
    return { entryId: e.id, state: e.state }
  },
  async getMyEntry(dropId) {
    await sleep(60)
    const s = load()
    return s.user ? toEntry(find(s, dropId), s.user.id) : null
  },
  async confirm(dropId, body) {
    await sleep(450)
    const s = load()
    const user = needUser(s)
    const d = find(s, dropId)
    const card = (body.testCard ?? '').trim().toLowerCase()
    const name = (body.payerName ?? '').trim()
    if (!card || !name) throw new ApiError('VALIDATION_FAILED', 'Card and name are needed', 400)
    const e = d.entries.find((x) => x.userId === user.id)
    if (!e) throw new ApiError('NOT_A_WINNER', 'No entry', 403)
    if (e.state === 'CONFIRMED') throw new ApiError('ALREADY_CONFIRMED', 'Already confirmed', 409)
    if (e.state === 'EXPIRED') throw new ApiError('CONFIRM_WINDOW_EXPIRED', 'Too late', 410)
    const slot = d.slots.find((x) => x.entryId === e.id && x.state === 'PENDING')
    if (e.state !== 'WON' || !slot) throw new ApiError('NOT_A_WINNER', 'No seat to confirm', 403)
    if (Date.now() >= slot.confirmBy) throw new ApiError('CONFIRM_WINDOW_EXPIRED', 'Too late', 410)
    const anchor = sha256(card)
    if (card.replace(/\D/g, '') === USED_CARD || d.slots.some((x) => x.anchor === anchor)) {
      throw new ApiError('ANCHOR_ALREADY_USED', 'Card already used', 409)
    }
    slot.state = 'CONFIRMED'
    slot.anchor = anchor
    e.state = 'CONFIRMED'
    const ticket = { id: uuid(), dropId, slotNo: slot.slotNo, holderName: name, holderEmail: user.email, cardRef: String(anchor).slice(0, 12).toUpperCase(), userId: user.id }
    d.tickets.push(ticket)
    audit(s, d.id, 'CONFIRMED', { slotNo: slot.slotNo, entryId: e.id })
    save(s)
    return { id: ticket.id, dropId, slotNo: ticket.slotNo, holderName: name, holderEmail: ticket.holderEmail, cardRef: ticket.cardRef }
  },
  async getTickets() {
    await sleep(60)
    const s = load()
    if (!s.user) return []
    const uid = s.user.id
    return Object.values(s.drops).flatMap((d) => d.tickets.filter((t) => t.userId === uid).map(({ id, dropId, slotNo, holderName, holderEmail, cardRef }) => ({ id, dropId, slotNo, holderName, holderEmail, cardRef })))
  },

  async getDraw(dropId) {
    await sleep(80)
    const d = find(load(), dropId)
    const drawn = d.state === 'DRAWN' || d.state === 'COMPLETE'
    return { seedCommit: sha256(d.seed), seed: drawn ? d.seed : null, manifestHash: drawn ? d.manifestHash : null, algorithm: 'es-weighted-v1' }
  },
  async getManifest(dropId) {
    await sleep(150)
    const d = find(load(), dropId)
    if (!d.ranking.length) throw new ApiError('NOT_FOUND', 'Not drawn yet', 404)
    return d.entries.map((e) => ({ entryId: e.id, weight: e.weight })).sort((a, b) => (a.entryId < b.entryId ? -1 : 1))
  },
  async getResults(dropId) {
    await sleep(150)
    const d = find(load(), dropId)
    if (!d.ranking.length) throw new ApiError('NOT_FOUND', 'Not drawn yet', 404)
    return { ranking: d.ranking, seats: d.seats }
  },

  subscribe(dropId, _authed, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void) {
    let lastDrop = ''
    let lastEntry = ''
    const tick = () => {
      if (!navigator.onLine) { onConn('offline'); return }
      onConn('live')
      const s = load()
      const d = s.drops[dropId]
      if (!d) return
      if (d.state !== lastDrop) { lastDrop = d.state; onEvent({ type: 'drop_state', state: d.state }) }
      const entry = s.user ? toEntry(d, s.user.id) : null
      const sig = JSON.stringify(entry)
      if (entry && sig !== lastEntry) { lastEntry = sig; onEvent({ type: 'your_status', ...entry }) }
    }
    const id = setInterval(tick, 1000)
    tick()
    window.addEventListener('online', tick)
    window.addEventListener('offline', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', tick)
      window.removeEventListener('offline', tick)
    }
  },

  admin: {
    async close(dropId) {
      await sleep(300)
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      if (d.state !== 'OPEN') throw new ApiError('INVALID_STATE', 'Already closed', 409)
      close(s, d)
      save(s)
    },
    async score(dropId) {
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      if (d.state !== 'CLOSED' || d.scored) throw new ApiError('INVALID_STATE', 'Scoring cannot run now', 409)
      await sleep(1800)
      const res = score(s, d)
      save(s)
      return { ...res, durationMs: 1800 }
    },
    async draw(dropId) {
      await sleep(500)
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      if (d.state !== 'CLOSED') throw new ApiError('INVALID_STATE', 'Draw cannot run now', 409)
      draw(s, d)
      save(s)
      return { seed: d.seed, manifestHash: d.manifestHash! }
    },
    async live(dropId) {
      await sleep(80)
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      const now = Date.now()
      const filling = d.state === 'OPEN' && now >= d.opensAt && now < d.closesAt && d.base < d.target && d.entries.length < d.target
      const count = (st: SlotState) => d.slots.filter((x) => x.state === st).length
      return {
        state: d.state, seats: d.seats, entries: d.entries.length, scored: d.scored,
        slotsPending: count('PENDING'), slotsConfirmed: count('CONFIRMED'), slotsUnfilled: count('UNFILLED'),
        waitlistLeft: d.entries.filter((e) => e.state === 'WAITLISTED').length,
        entriesPerMin: filling ? 80 + Math.round(Math.random() * 12) : 0,
        rateLimitedPerMin: filling ? Math.round(Math.random() * 6) : 0,
      }
    },
    async slots(dropId) {
      await sleep(100)
      const s = load()
      needOrganiser(s)
      return find(s, dropId).slots.map((x): Slot => ({ slotNo: x.slotNo, state: x.state, entryId: x.state === 'UNFILLED' ? null : x.entryId, confirmBy: x.state === 'PENDING' ? iso(x.confirmBy) : null }))
    },
    async flags(dropId, minScore, page) {
      await sleep(150)
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      const all = d.entries.filter((e) => e.risk !== null && e.risk >= minScore).sort((a, b) => b.risk! - a.risk!)
      const clusterSize = d.entries.filter((e) => (e.risk ?? 0) >= 85).length
      const flags = all.slice((page - 1) * PAGE, page * PAGE).map((e): Flag => ({
        entryId: e.id, risk: e.risk!, weight: e.weight,
        clusterId: e.risk! >= 85 ? 'cl_1' : null, clusterSize: e.risk! >= 85 ? clusterSize : null,
      }))
      return { flags, page, total: all.length }
    },
    async flag(dropId, entryId) {
      await sleep(150)
      const s = load()
      needOrganiser(s)
      const d = find(s, dropId)
      const e = d.entries.find((x) => x.id === entryId)
      if (!e || e.risk === null) throw new ApiError('NOT_FOUND', 'No such entry', 404)
      const r = e.risk / 100
      const b = (n: number) => parseInt(sha256(e.id + n).slice(0, 2), 16) / 255
      const signals = { device: Math.min(1, r * (0.7 + b(1) * 0.5)), ip: Math.min(1, r * (0.5 + b(2) * 0.6)), timing: Math.min(1, r * (0.6 + b(3) * 0.5)), email: Math.min(1, r * (0.4 + b(4) * 0.7)) }
      const reasons: string[] = []
      if (signals.device > 0.5) reasons.push('Shares a device fingerprint with several other entries')
      if (signals.ip > 0.5) reasons.push('Many entries came from the same network')
      if (signals.timing > 0.5) reasons.push('Entered at very regular intervals with other entries')
      if (signals.email > 0.5) reasons.push('Email follows a numbered pattern seen in other entries')
      const linked = e.risk >= 85 ? d.entries.filter((x) => x.id !== e.id && (x.risk ?? 0) >= 85).slice(0, 8).map((x) => x.id) : []
      return { entryId: e.id, risk: e.risk, weight: e.weight, signals, reasons, linkedEntries: linked }
    },
    async audit(dropId) {
      await sleep(100)
      const s = load()
      needOrganiser(s)
      return s.audit.filter((a) => a.dropId === dropId).map(({ seq, type, payload, at, prevHash, hash }) => ({ seq, type, payload, at, prevHash, hash }))
    },
    async runs() {
      await sleep(120)
      needOrganiser(load())
      return runs.map((r, i) => ({ runId: r.runId, scenario: r.scenario, botSharePercent: r.botSharePercent ?? 0, createdAt: iso(Date.now() - (runs.length - i) * 20 * MIN) }))
    },
    async run(runId) {
      await sleep(100)
      needOrganiser(load())
      const r = runs.find((x) => x.runId === runId)
      if (!r) throw new ApiError('NOT_FOUND', 'No such run', 404)
      return r
    },
  },
}

// Demo helpers, only reachable from the account page when the mock is active.
export const MOCK_ORGANISER = ORGANISER
export const MOCK_USED_CARD = '4000 0000 0000 0002'

export function resetMock() {
  const user = load().user
  const s = fresh()
  s.user = user
  save(s)
}

// Brings the launch-night close and draw forward so the result shows in a few seconds.
export function skipToDraw() {
  const s = load()
  const d = s.drops['launch-night']
  const now = Date.now()
  if (d.state === 'OPEN') d.closesAt = Math.min(d.closesAt, now + 2000)
  if (d.state === 'OPEN' || d.state === 'CLOSED') d.drawAt = Math.min(d.drawAt, now + 5000)
  save(s)
}

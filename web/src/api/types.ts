// Mirrors section 10 of docs/PRD.md. Keep this in sync with the backend contract.

export type DropState = 'OPEN' | 'CLOSED' | 'DRAWN' | 'COMPLETE'

// GET /drops returns the first seven fields, GET /drops/:id adds the rest.
export interface Drop {
  id: string
  name: string
  seats: number
  state: DropState
  windowOpensAt: string
  windowClosesAt: string
  drawAt: string
  confirmWindowMinutes?: number
  ticketPrice?: number
  seedCommit?: string
  // Optional details the backend sends when a drop has them.
  category?: string
  venue?: string
  city?: string
  description?: string
  eventAt?: string
  // Not in the contract. Shown only if the backend ever sends it.
  posterUrl?: string
}

export interface User {
  id: string
  email: string
  role: 'participant' | 'organiser'
}

export type EntryState = 'ENTERED' | 'WON' | 'WAITLISTED' | 'CONFIRMED' | 'EXPIRED' | 'NOT_SELECTED'

export interface Entry {
  entryId: string
  state: EntryState
  rank: number | null
  waitlistPosition: number | null
  confirmBy: string | null
}

export interface Ticket {
  id: string
  dropId: string
  slotNo: number
  holderName: string
  // The account the ticket was issued to and a short reference of the one payment method behind it.
  holderEmail?: string | null
  cardRef?: string | null
}

export interface DrawInfo {
  seedCommit: string
  seed: string | null
  manifestHash: string | null
  algorithm?: string
}

export interface ManifestEntry { entryId: string; weight: number }
export interface DrawResults { ranking: string[]; seats: number }

export type PowPurpose = 'otp' | 'entry'
export interface PowChallenge { challengeId: string; prefix: string; difficulty: number }
export interface PowSolution { challengeId: string; nonce: string }

export type LiveEvent =
  | { type: 'drop_state'; state: DropState }
  | { type: 'your_status'; state: EntryState; entryId?: string; rank?: number | null; waitlistPosition?: number | null; confirmBy?: string | null }

// live: stream is healthy. polling: stream dropped, reading status every 5 s. offline: no network.
export type ConnState = 'live' | 'polling' | 'offline'

// Organiser

export interface LiveStats {
  state: DropState
  seats: number
  entries: number
  // The contract does not pin the type, so both a flag and a word are handled.
  scored?: boolean | string | null
  slotsPending: number
  slotsConfirmed: number
  slotsUnfilled: number
  waitlistLeft: number
  entriesPerMin?: number
  rateLimitedPerMin?: number
}

export type SlotState = 'PENDING' | 'CONFIRMED' | 'UNFILLED'
export interface Slot { slotNo: number; state: SlotState; entryId: string | null; confirmBy: string | null }

export interface AuditEvent { seq: number; type: string; payload: string; at: string; prevHash: string; hash: string }

export interface Flag { entryId: string; risk: number; weight: number; clusterId: string | null; clusterSize: number | null }
export interface FlagPage { flags: Flag[]; page: number; total: number }
export interface FlagDetail {
  entryId: string
  risk: number
  weight: number
  signals: { device: number; ip: number; timing: number; email: number }
  reasons: string[]
  linkedEntries: string[]
}

export interface DemoTemplate { index: number; name: string; category: string; venue: string; city: string; seats: number; price: number }
export interface DemoStatus { enabled: boolean; templates: DemoTemplate[]; crowd: { attempts: number } }
export interface CrowdGroup { total: number; lowered: number; high: number }
export interface CrowdReport {
  state: 'none' | 'running' | 'done' | 'interrupted' | 'error'
  wave?: number
  waves?: number
  attempts?: number
  refused?: number
  entered?: number
  honest?: number
  naive?: number
  stealth?: number
  scored?: boolean
  groups?: Record<'honest' | 'naive' | 'stealth' | 'real', CrowdGroup>
}

export interface RunSummary { runId: string; scenario: string; botSharePercent: number; createdAt: string }

// The results file from PRD 11.3. Everything is optional so a partial upload still renders.
export interface RunResult {
  runId: string
  scenario: string
  botSharePercent?: number
  defences?: { pow?: boolean; rateLimits?: boolean; scoring?: boolean }
  entries?: { honest: number; bot: number }
  winners?: { honest: number; bot: number }
  confirmed?: { honest: number; bot: number }
  botAdvantageRatio?: number
  botSeatConversion?: number
  honestFairShareDeviation?: number
  falsePositiveRate?: number
  latencyMs?: { entryP95?: number; statusP95?: number }
  errors5xx?: number
  rateLimited?: number
  hardGuarantees?: { oversoldSeats?: number; cardsWithTwoSeats?: number; usersWithTwoEntries?: number; drawReproducible?: boolean }
}

export type ErrorCode =
  | 'RATE_LIMITED' | 'POW_INVALID' | 'OTP_INVALID' | 'OTP_LOCKED' | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'DROP_NOT_OPEN' | 'ALREADY_ENTERED' | 'INVALID_STATE'
  | 'NOT_A_WINNER' | 'ALREADY_CONFIRMED' | 'ANCHOR_ALREADY_USED' | 'CONFIRM_WINDOW_EXPIRED'
  | 'IDEMPOTENCY_MISMATCH' | 'SERVICE_BUSY' | 'NETWORK' | 'HUMAN_CHECK' | 'UNKNOWN'

export class ApiError extends Error {
  code: ErrorCode
  status: number
  retryAfter?: number
  constructor(code: ErrorCode, message: string, status = 0, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

// Everything the UI needs from the backend. The mock and the http client both implement
// this, so switching is one env setting. Mutating calls take the idempotency key from the
// caller so a retry of the same click reuses it.
export interface FairDropApi {
  me(): Promise<User | null>
  getPowChallenge(purpose: PowPurpose): Promise<PowChallenge>
  requestOtp(email: string, pow: PowSolution): Promise<{ devCode?: string }>
  verifyOtp(email: string, code: string): Promise<User>
  logout(): Promise<void>

  listDrops(): Promise<Drop[]>
  getDrop(dropId: string): Promise<Drop>
  enter(dropId: string, body: { pow: PowSolution; deviceFingerprint: string }, key: string): Promise<{ entryId: string; state: EntryState }>
  getMyEntry(dropId: string): Promise<Entry | null>
  confirm(dropId: string, body: { testCard: string; payerName: string }, key: string): Promise<Ticket>
  // The winner gives the seat up, and the next person on the waitlist is offered it right away.
  decline(dropId: string, key: string): Promise<{ promoted: boolean }>
  getTickets(): Promise<Ticket[]>

  getDraw(dropId: string): Promise<DrawInfo>
  getManifest(dropId: string): Promise<ManifestEntry[]>
  getResults(dropId: string): Promise<DrawResults>

  // authed says whether to open the per user stream. Signed out visitors only poll the drop.
  subscribe(dropId: string, authed: boolean, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void): () => void

  admin: {
    close(dropId: string, key: string): Promise<void>
    score(dropId: string, key: string): Promise<{ scored: number; flagged: number; durationMs: number }>
    draw(dropId: string, key: string): Promise<{ seed: string; manifestHash: string }>
    live(dropId: string): Promise<LiveStats>
    slots(dropId: string): Promise<Slot[]>
    flags(dropId: string, minScore: number, page: number, maxScore?: number): Promise<FlagPage>
    flag(dropId: string, entryId: string): Promise<FlagDetail>
    audit(dropId: string): Promise<AuditEvent[]>
    // Demo tools. status() fails with NOT_FOUND unless the server was started with them on.
    demo: {
      status(): Promise<DemoStatus>
      addEvent(index: number): Promise<Drop>
      reset(): Promise<{ reset: number }>
      startCrowd(dropId: string): Promise<CrowdReport>
      crowd(dropId: string): Promise<CrowdReport>
    }
    runs(): Promise<RunSummary[]>
    run(runId: string): Promise<RunResult>
  }
}

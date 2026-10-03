// Mirrors section 10 of the PRD (API v1). Keep this in sync with the backend contract.

export type DropState =
  | 'ANNOUNCED' | 'OPEN' | 'CLOSED' | 'SCORING' | 'DRAWN' | 'CONFIRMING' | 'COMPLETE'

export type EventCategory = 'Music' | 'Comedy' | 'Sports' | 'Tech'
export const CATEGORIES: EventCategory[] = ['Music', 'Comedy', 'Sports', 'Tech']

export interface Drop {
  id: string
  name: string
  seats: number
  state: DropState
  windowOpensAt: string
  windowClosesAt: string
  confirmWindowMinutes: number
  holdAmount: number
  currency: string
  seedCommit: string
  // Not in the PRD yet. The event pages need them, so the backend has to add them to
  // the drop payload (drops.yaml) or the UI falls back to the entry window only.
  category?: EventCategory
  venue?: string
  city?: string
  description?: string
  eventAt?: string
}

export interface User {
  id: string
  email: string
  role: 'participant' | 'organiser'
}

export type EntryState =
  | 'ENTERED' | 'WON' | 'WAITLISTED' | 'NOT_SELECTED' | 'CONFIRMED' | 'EXPIRED'

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
  seatNo: number
  holderName?: string
}

export interface DrawInfo {
  seedCommit: string
  seed: string | null
  manifestHash: string | null
  algorithm: string
}

export type PowPurpose = 'otp' | 'entry'

export interface PowChallenge {
  challengeId: string
  prefix: string
  difficulty: number
  expiresAt: string
}

export interface PowSolution {
  challengeId: string
  nonce: string
}

export interface EntryRequest {
  pow: PowSolution
  paymentMethodToken: string
  deviceFingerprint: string
}

export type LiveEvent =
  | { type: 'drop_state'; state: DropState }
  | { type: 'manifest_published'; manifestHash: string }
  | { type: 'draw_complete'; seed: string }
  | { type: 'your_status'; state: EntryState; rank?: number | null; waitlistPosition?: number | null; confirmBy?: string | null }
  | { type: 'waitlist_moved'; waitlistPosition: number }

// live: SSE stream is healthy. reconnecting: stream dropped, retrying.
// polling: gave up on SSE for now and reading status with backoff. offline: no network.
export type ConnState = 'live' | 'reconnecting' | 'polling' | 'offline'

export type ErrorCode =
  | 'RATE_LIMITED' | 'POW_INVALID' | 'POW_EXPIRED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'DROP_NOT_OPEN' | 'ALREADY_ENTERED' | 'ANCHOR_ALREADY_USED' | 'PAYMENT_FAILED'
  | 'CONFIRM_WINDOW_EXPIRED' | 'OTP_INVALID' | 'NETWORK' | 'UNKNOWN'

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

// Everything the UI needs from the backend. The mock and the http client
// both implement this, so swapping is a one line change in api/index.ts.
export interface FairDropApi {
  me(): Promise<User | null>
  getPowChallenge(purpose: PowPurpose): Promise<PowChallenge>
  requestOtp(email: string, pow: PowSolution): Promise<void>
  verifyOtp(email: string, code: string): Promise<User>
  logout(): Promise<void>

  listDrops(): Promise<Drop[]>
  getDrop(dropId: string): Promise<Drop>
  getDraw(dropId: string): Promise<DrawInfo>

  createPaymentMethod(upiId: string): Promise<{ token: string }>
  // idempotencyKey is supplied by the caller so a retry of the same attempt reuses it.
  enter(dropId: string, body: EntryRequest, idempotencyKey: string): Promise<Entry>
  getMyEntry(dropId: string): Promise<Entry | null>
  confirm(dropId: string, paymentMethodToken: string, idempotencyKey: string): Promise<Ticket>
  getTickets(): Promise<Ticket[]>

  subscribe(dropId: string, onEvent: (e: LiveEvent) => void, onConn: (c: ConnState) => void): () => void
}

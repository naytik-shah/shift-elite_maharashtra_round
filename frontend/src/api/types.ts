export type DrawStatus = 'open' | 'drawn'

export interface EventInfo {
  id: string
  name: string
  seats: number
  entrants: number
  drawAt: number // epoch ms
  status: DrawStatus
}

export interface Session {
  token: string
  userId: string
  name: string
}

export type EntryState =
  | 'not_entered'
  | 'entered'
  | 'queued'
  | 'holding'
  | 'confirmed'
  | 'expired'
  | 'lost'

export interface EntryStatus {
  state: EntryState
  position?: number
  holdExpiresAt?: number
}

// Everything the UI needs from the backend. The mock and the real client
// both implement this, so swapping is a one line change in api/index.ts.
export interface FairDropApi {
  register(name: string, email: string): Promise<Session>
  getEvent(): Promise<EventInfo>
  enter(session: Session): Promise<EntryStatus>
  getStatus(session: Session): Promise<EntryStatus>
  confirm(session: Session): Promise<EntryStatus>
}

import { mockApi } from './mock'
import type { FairDropApi } from './types'

// Swap this for the real http client once the backend contract is published.
export const api: FairDropApi = mockApi
export * from './types'

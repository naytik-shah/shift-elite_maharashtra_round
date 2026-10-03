import { httpApi } from './http'
import { mockApi } from './mock'
import type { FairDropApi } from './types'

// Set VITE_API=http to talk to the real backend. Anything else keeps the local mock.
export const usingMock = import.meta.env.VITE_API !== 'http'
export const api: FairDropApi = usingMock ? mockApi : httpApi
export const configuredDropId: string | undefined = import.meta.env.VITE_DROP_ID || undefined
export * from './types'
export { errorMessage, errorCode } from './errors'

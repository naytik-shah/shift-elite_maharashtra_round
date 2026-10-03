import { httpApi } from './http'
import { mockApi } from './mock'
import type { FairDropApi } from './types'

// VITE_API=http talks to the real backend. Anything else keeps the in browser mock.
export const usingMock = import.meta.env.VITE_API !== 'http'
export const api: FairDropApi = usingMock ? mockApi : httpApi
export * from './types'
export { errorMessage, errorCode } from './errors'

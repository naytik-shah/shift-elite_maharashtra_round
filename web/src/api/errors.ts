import { ApiError, type ErrorCode } from './types'

const messages: Record<ErrorCode, string> = {
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  POW_INVALID: 'The security check did not pass. Please try again.',
  OTP_INVALID: 'That code is not right. Check it and try again.',
  OTP_LOCKED: 'Too many wrong codes. Request a new code.',
  UNAUTHENTICATED: 'Your session ended. Please log in again.',
  FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'We could not find that.',
  VALIDATION_FAILED: 'Some details are missing or not valid.',
  DROP_NOT_OPEN: 'Entries are not open right now.',
  ALREADY_ENTERED: 'You have already entered this drop.',
  INVALID_STATE: 'This step has already run or cannot run yet.',
  NOT_A_WINNER: 'There is no seat waiting for you in this drop.',
  ALREADY_CONFIRMED: 'This seat is already confirmed.',
  ANCHOR_ALREADY_USED: 'This card has already confirmed a seat in this drop. Use a different card.',
  CONFIRM_WINDOW_EXPIRED: 'Your confirm window ended.',
  IDEMPOTENCY_MISMATCH: 'That request changed while it was being sent. Please try again.',
  SERVICE_BUSY: 'The server is busy. Please try again in a moment.',
  NETWORK: 'No connection. Check your network and try again.',
  HUMAN_CHECK: 'The human check was not completed.',
  UNKNOWN: 'Something went wrong. Please try again.',
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RATE_LIMITED' && err.retryAfter) {
      return `Too many requests. Try again in ${err.retryAfter} seconds.`
    }
    return messages[err.code] ?? err.message ?? messages.UNKNOWN
  }
  return messages.UNKNOWN
}

export const errorCode = (err: unknown): ErrorCode => (err instanceof ApiError ? err.code : 'UNKNOWN')

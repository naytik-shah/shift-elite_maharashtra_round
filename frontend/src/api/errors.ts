import { ApiError, type ErrorCode } from './types'

const messages: Record<ErrorCode, string> = {
  RATE_LIMITED: 'Too many requests from here. Give it a moment and try again.',
  POW_INVALID: 'The security check did not pass. Please try again.',
  POW_EXPIRED: 'The security check timed out. Please try again.',
  UNAUTHENTICATED: 'Your session ended. Please sign in again.',
  FORBIDDEN: 'That payment method does not match the one you entered with.',
  NOT_FOUND: 'We could not find that.',
  DROP_NOT_OPEN: 'Entries are not open right now.',
  ALREADY_ENTERED: 'You have already entered this drop.',
  ANCHOR_ALREADY_USED: 'This payment method has already entered this drop.',
  PAYMENT_FAILED: 'The payment method was declined. Try a different one.',
  CONFIRM_WINDOW_EXPIRED: 'The confirm window has passed and the seat moved to the waitlist.',
  OTP_INVALID: 'That code is not right. Check it and try again.',
  NETWORK: 'No connection. Check your network and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RATE_LIMITED' && err.retryAfter) {
      return `Too many requests from here. Try again in ${err.retryAfter} seconds.`
    }
    return messages[err.code] ?? err.message
  }
  return messages.UNKNOWN
}

export const errorCode = (err: unknown): ErrorCode => (err instanceof ApiError ? err.code : 'UNKNOWN')

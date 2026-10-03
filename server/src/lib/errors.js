export class AppError extends Error {
  constructor(code, status, message, extra = {}) {
    super(message || code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const mk = (code, status, defMsg) => (message, extra) => new AppError(code, status, message || defMsg, extra);

export const Errors = {
  rateLimited: (retryAfterSec = 1) =>
    new AppError('RATE_LIMITED', 429, 'Too many requests. Try again shortly.', { retryAfter: Math.max(1, Math.ceil(retryAfterSec)) }),
  powInvalid: mk('POW_INVALID', 400, 'The security check did not pass.'),
  otpInvalid: mk('OTP_INVALID', 400, 'That code is not right or has expired.'),
  otpLocked: mk('OTP_LOCKED', 429, 'Too many wrong codes. Ask for a new one.'),
  unauthenticated: mk('UNAUTHENTICATED', 401, 'Please sign in.'),
  forbidden: mk('FORBIDDEN', 403, 'You are not allowed to do that.'),
  notFound: mk('NOT_FOUND', 404, 'Not found.'),
  validation: mk('VALIDATION_FAILED', 400, 'The request is not valid.'),
  dropNotOpen: mk('DROP_NOT_OPEN', 409, 'Entries are not open for this drop.'),
  alreadyEntered: mk('ALREADY_ENTERED', 409, 'You have already entered this drop.'),
  invalidState: mk('INVALID_STATE', 409, 'This action is not allowed in the current state.'),
  notAWinner: mk('NOT_A_WINNER', 403, 'You do not hold a seat to confirm.'),
  alreadyConfirmed: mk('ALREADY_CONFIRMED', 409, 'This seat is already confirmed.'),
  anchorUsed: mk('ANCHOR_ALREADY_USED', 409, 'This card has already confirmed a seat for this drop.'),
  confirmExpired: mk('CONFIRM_WINDOW_EXPIRED', 410, 'The confirm window has passed.'),
  idempotencyMismatch: mk('IDEMPOTENCY_MISMATCH', 422, 'This Idempotency-Key was used with a different request.'),
  busy: (retryAfter = 2) => new AppError('SERVICE_BUSY', 503, 'The service is busy. Try again in a moment.', { retryAfter }),
  scoringFailed: mk('SCORING_FAILED', 502, 'The scoring service failed.'),
};

import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { isDbBusy } from '../db.js';
import logger from '../logger.js';

const isRedisBusy = (err) =>
  err && (err.name === 'MaxRetriesPerRequestError'
    || /Command timed out|Connection is closed|ECONNREFUSED|READONLY|LOADING|Stream isn't writeable/.test(err.message || ''));

export function notFoundHandler(_req, _res, next) {
  next(new AppError('NOT_FOUND', 404, 'Not found.'));
}

// One place that turns any error into the documented { error: { code, message } } shape.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    // Nothing safe to send any more; drop the connection so the client retries.
    res.destroy();
    return;
  }

  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong on our side.';
  let retryAfter;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    retryAfter = err.extra?.retryAfter;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_FAILED';
    const first = err.issues?.[0];
    message = first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'The request is not valid.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'VALIDATION_FAILED';
    message = 'Request body is too large.';
  } else if (err?.type === 'entity.parse.failed' || err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
    status = 400;
    code = 'VALIDATION_FAILED';
    message = 'Request body must be valid JSON.';
  } else if (isDbBusy(err) || isRedisBusy(err)) {
    status = 503;
    code = 'SERVICE_BUSY';
    message = 'The service is busy. Try again in a moment.';
    retryAfter = 2;
    logger.warn({ err: err.message, reqId: req.id }, 'dependency busy');
  } else if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    status = err.status;
    code = 'VALIDATION_FAILED';
    message = err.message || message;
  } else {
    logger.error({ err, reqId: req.id, path: req.path }, 'unhandled error');
  }

  if (retryAfter) res.set('Retry-After', String(retryAfter));
  res.status(status).json({ error: { code, message } });
}

import { Errors } from '../lib/errors.js';
import { requireSession } from './session.js';

export function requireAuth(req, _res, next) {
  try {
    requireSession(req);
    next();
  } catch (err) {
    next(err);
  }
}

// The role is stored in the session at login, from the organiser list in the config file.
export function requireOrganiser(req, _res, next) {
  try {
    requireSession(req);
    if (req.session.role !== 'organiser') throw Errors.forbidden('Organisers only.');
    next();
  } catch (err) {
    next(err);
  }
}

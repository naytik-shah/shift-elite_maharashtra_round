import config from '../config.js';

// The few security headers that matter for a JSON API. (This replaces a general purpose package that
// sets a dozen headers aimed at HTML pages; fewer header writes on every response is measurably faster.)
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

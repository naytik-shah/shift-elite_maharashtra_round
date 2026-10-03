import { cleanIp, subnetOf } from '../lib/ip.js';

// The client address comes from our own nginx (it overwrites X-Forwarded-For with the real peer).
// If several addresses are present, the last one was added by the nearest proxy, so use that.
export function clientIp(req, _res, next) {
  const xff = req.headers['x-forwarded-for'];
  let ip = null;
  if (typeof xff === 'string' && xff) {
    const parts = xff.split(',');
    ip = cleanIp(parts[parts.length - 1]);
  }
  if (!ip) ip = cleanIp(req.socket.remoteAddress) || '0.0.0.0';
  req.clientIp = ip;
  req.subnet = subnetOf(ip);
  next();
}

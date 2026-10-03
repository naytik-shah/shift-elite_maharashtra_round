import net from 'node:net';

// Strips the IPv6 wrapper around IPv4 addresses, returns null for anything that is not an IP.
export function cleanIp(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  return net.isIP(s) ? s : null;
}

// /24 for IPv4, /64 for IPv6.
export function subnetOf(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.');
    return `${p[0]}.${p[1]}.${p[2]}.0/24`;
  }
  // Expand "::" so the first four groups are right.
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
